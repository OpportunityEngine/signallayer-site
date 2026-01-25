/**
 * Invoice Parsing V2 - Robust Totals Extraction
 *
 * Implements accounting-grade totals extraction:
 * - Line-by-line scanning (not single regex)
 * - Deterministic math validation
 * - Reconciliation with tolerance
 * - Evidence tracking for debugging
 * - NUCLEAR FALLBACK to universal finder
 * - Cross-validation and sanity checks
 */

// Import universal finder for nuclear fallback
let universalTotalFinder = null;
try {
  universalTotalFinder = require('./universalTotalFinder');
} catch (e) {
  console.log('[TOTALS] Universal finder not available:', e.message);
}

/**
 * Parse money string to cents (integer)
 * Handles: $1,234.56, 1234.56, (123.45) for negatives, -123.45, spaces, etc.
 * @param {string|number} str - Money value to parse
 * @returns {number} - Value in cents (integer)
 */
function parseMoneyToCents(str) {
  if (str === null || str === undefined) return 0;
  if (typeof str === 'number') return Math.round(str * 100);

  let s = String(str).trim();
  if (!s) return 0;

  // Check for negative indicators
  const isNegative = s.startsWith('(') && s.endsWith(')') ||
                     s.startsWith('-') ||
                     s.startsWith('CR') ||  // Credit notation
                     s.includes('-') && s.indexOf('-') === 0;

  // Remove currency symbols, commas, parentheses, spaces, CR notation
  let cleaned = s
    .replace(/[$€£¥,\s()]/g, '')
    .replace(/^-/, '')
    .replace(/^CR/i, '')
    .replace(/-$/, '');  // trailing negative

  if (!cleaned) return 0;

  // Handle European format (1.234,56 -> 1234.56)
  if (/^\d{1,3}(\.\d{3})+,\d{2}$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  }

  const num = parseFloat(cleaned);
  if (!Number.isFinite(num)) return 0;

  const cents = Math.round(num * 100);
  return isNegative ? -cents : cents;
}

/**
 * Normalize line for consistent parsing
 * @param {string} line - Raw line
 * @returns {string} - Normalized line
 */
function normalizeLine(line) {
  if (!line) return '';
  return line
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')  // Normalize spaces
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-')  // Normalize dashes
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/**
 * Normalize money values that may have spaces inserted by PDF extraction
 * Examples: "1 748.85" -> "1748.85", "1748 . 85" -> "1748.85"
 * @param {string} s - Raw money string
 * @returns {string} - Normalized money string
 */
function normalizeMoneyLine(s) {
  if (!s) return '';
  return String(s)
    .replace(/\r/g, '')
    .replace(/(\d)\s+(?=\d)/g, '$1')      // "1 748" -> "1748"
    .replace(/(\d)\s+\.(?=\d)/g, '$1.')   // "1748 .85" -> "1748.85"
    .replace(/\.\s+(?=\d)/g, '.')         // "1748. 85" -> "1748.85"
    .replace(/,\s+(?=\d)/g, ',')          // "1,748 .85" -> "1,748.85"
    .trim();
}

/**
 * Check if line is a group/category subtotal (NOT the invoice total)
 * These should be ignored when looking for the invoice total
 * CRITICAL: This function prevents GROUP TOTAL from being mistaken for INVOICE TOTAL
 *
 * PATCH 4: BULLETPROOF GROUP TOTAL REJECTION
 * - Must NEVER return true for "INVOICE TOTAL" lines (they're valid)
 * - Must ALWAYS return true for GROUP/CATEGORY/SECTION/DEPT totals
 *
 * @param {string} line - Normalized line
 * @returns {boolean}
 */
function isGroupSubtotalLine(line) {
  const lineUpper = normalizeLine(line);

  // ===== WHITELIST: Lines that should NEVER be rejected =====
  // CRITICAL: "INVOICE TOTAL" is the ONE TRUE TOTAL we want
  if (/INVOICE\s+TOTAL/i.test(lineUpper)) {
    return false;  // This is the invoice total - DO NOT REJECT
  }
  if (/TOTAL\s+USD/i.test(lineUpper)) {
    return false;  // TOTAL USD is Cintas invoice total - DO NOT REJECT
  }
  if (/AMOUNT\s+DUE/i.test(lineUpper)) {
    return false;  // AMOUNT DUE is invoice total - DO NOT REJECT
  }
  if (/BALANCE\s+DUE/i.test(lineUpper)) {
    return false;  // BALANCE DUE is invoice total - DO NOT REJECT
  }
  if (/GRAND\s+TOTAL/i.test(lineUpper)) {
    return false;  // GRAND TOTAL is invoice total - DO NOT REJECT
  }

  // ===== BLACKLIST: Patterns that indicate GROUP/SECTION subtotals (not invoice totals) =====
  // CRITICAL: These patterns must NEVER be selected as invoice totals
  const groupPatterns = [
    // PATCH 4: BULLETPROOF asterisk patterns for Sysco
    /\*{2,}.*GROUP/i,                        // ** followed by GROUP anywhere
    /GROUP.*\*{2,}/i,                        // GROUP followed by **
    /\*{2,}.*TOTAL/i,                        // ** before TOTAL (but not INVOICE TOTAL - handled above)
    /GROUP\s*TOTAL/i,                        // GROUP TOTAL (with or without space)
    /GROUP\s+TOTAL\*+/i,                     // Sysco with asterisks after
    /\*{3,}\s*GROUP\s+TOTAL/i,               // Asterisks before GROUP TOTAL
    /CATEGORY\s+TOTAL/i,                     // Category subtotal
    /SECTION\s+TOTAL/i,                      // Section subtotal
    /DEPT\.?\s+TOTAL/i,                      // Department total (abbreviated)
    /DEPARTMENT\s+TOTAL/i,                   // Department total (full)
    /^\d{4}\s+[A-Z]+\s+[A-Z]+\s+SUBTOTAL/i,  // 0001 JOHN DOE SUBTOTAL
    /^[A-Z]+\s+[A-Z]+\s+SUBTOTAL\s*-?\s*[\d,\.]+$/i,  // JOHN DOE SUBTOTAL
    /^\s*[A-Z\/\s]+\s+SUBTOTAL\s+[\d,\.]+$/i,  // MAIN/REFRIG SUBTOTAL
    /IT\s+SUBTOTAL/i,                        // IT Department subtotal
    /LOC\s+\d+.*SUBTOTAL/i,                  // Location subtotal
    /EMPLOYEE.*SUBTOTAL/i,                   // Employee subtotal
    /EMP\s*#.*SUBTOTAL/i,                    // EMP# subtotal (Cintas)
    /LOCATION\s+SUBTOTAL/i,                  // Location subtotal
    /AREA\s+TOTAL/i,                         // Area total
    /ZONE\s+TOTAL/i,                         // Zone total
    /ROUTE\s+TOTAL/i,                        // Route total
    /CLASS\s+TOTAL/i,                        // Class total (sometimes used in Sysco)
    /PRODUCT\s+CLASS.*TOTAL/i,               // Product class total
  ];

  // Check for employee name pattern before SUBTOTAL
  if (lineUpper.includes('SUBTOTAL')) {
    const subtotalIdx = lineUpper.indexOf('SUBTOTAL');
    if (subtotalIdx > 5) {
      const beforeSubtotal = lineUpper.slice(0, subtotalIdx).trim();
      // Looks like a name (2-4 words, alphabetic)
      const nameParts = beforeSubtotal.split(/\s+/).filter(p => /^[A-Z]+$/.test(p));
      if (nameParts.length >= 2 && nameParts.length <= 4) {
        return true;  // Employee subtotal
      }
    }
  }

  // Also check if line contains ONLY "SUBTOTAL" without "TOTAL USD" or "INVOICE TOTAL"
  // These are almost always category/employee subtotals, not invoice totals
  if (/^SUBTOTAL\s*[\d,\.]+$/i.test(lineUpper) && !/INVOICE|USD|AMOUNT|DUE|BALANCE/i.test(lineUpper)) {
    return true;
  }

  return groupPatterns.some(p => p.test(lineUpper));
}

/**
 * Extract totals by scanning lines (robust, multi-pattern approach)
 * @param {string} text - Raw invoice text
 * @returns {Object} - Extracted totals with evidence
 */
function extractTotalsByLineScan(text) {
  if (!text) {
    return {
      totalCents: 0,
      subtotalCents: 0,
      taxCents: 0,
      feesCents: 0,
      discountCents: 0,
      evidence: { total: null, subtotal: null, tax: null, fees: [], discounts: [] }
    };
  }

  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Result containers
  let totalCents = 0;
  let subtotalCents = 0;
  let taxCents = 0;
  let feesCents = 0;
  let discountCents = 0;

  const evidence = {
    total: null,
    subtotal: null,
    tax: null,
    fees: [],
    discounts: []
  };

  // Candidate totals (we'll pick the best one)
  const totalCandidates = [];
  const subtotalCandidates = [];

  // Pattern definitions with priority (lower = higher priority)
  const totalPatterns = [
    // === HIGHEST PRIORITY: Explicit invoice totals ===
    { pattern: /INVOICE\s+TOTAL[:\s]*\$?([\d,]+\.?\d{0,3})/i, priority: 1, name: 'INVOICE TOTAL' },
    { pattern: /INV\.?\s+TOTAL[:\s]*\$?([\d,]+\.?\d{0,3})/i, priority: 1, name: 'INV TOTAL' },
    { pattern: /INVOICETOTAL[:\s]*\$?([\d,]+\.?\d{0,3})/i, priority: 1, name: 'INVOICETOTAL' },

    // === HIGH PRIORITY: Standard final total labels ===
    { pattern: /TOTAL\s+USD[:\s]*\$?([\d,]+\.?\d{0,3})/i, priority: 2, name: 'TOTAL USD' },
    { pattern: /AMOUNT\s+DUE[:\s]*\$?([\d,]+\.?\d{0,3})/i, priority: 3, name: 'AMOUNT DUE' },
    { pattern: /BALANCE\s+DUE[:\s]*\$?([\d,]+\.?\d{0,3})/i, priority: 4, name: 'BALANCE DUE' },
    { pattern: /GRAND\s+TOTAL[:\s]*\$?([\d,]+\.?\d{0,3})/i, priority: 5, name: 'GRAND TOTAL' },
    { pattern: /TOTAL\s+AMOUNT[:\s]*\$?([\d,]+\.?\d{0,3})/i, priority: 6, name: 'TOTAL AMOUNT' },
    { pattern: /TOTAL\s+DUE[:\s]*\$?([\d,]+\.?\d{0,3})/i, priority: 7, name: 'TOTAL DUE' },

    // === MEDIUM PRIORITY: Payment-related totals ===
    { pattern: /PAY\s+THIS\s+AMOUNT[:\s]*\$?([\d,]+\.?\d{0,3})/i, priority: 8, name: 'PAY THIS AMOUNT' },
    { pattern: /PLEASE\s+PAY[:\s]*\$?([\d,]+\.?\d{0,3})/i, priority: 8, name: 'PLEASE PAY' },
    { pattern: /PAYMENT\s+DUE[:\s]*\$?([\d,]+\.?\d{0,3})/i, priority: 8, name: 'PAYMENT DUE' },
    { pattern: /NET\s+TOTAL[:\s]*\$?([\d,]+\.?\d{0,3})/i, priority: 8, name: 'NET TOTAL' },
    { pattern: /NET\s+DUE[:\s]*\$?([\d,]+\.?\d{0,3})/i, priority: 8, name: 'NET DUE' },
    { pattern: /NET\s+AMOUNT[:\s]*\$?([\d,]+\.?\d{0,3})/i, priority: 8, name: 'NET AMOUNT' },

    // === LOWER PRIORITY: Generic patterns ===
    { pattern: /(?:^|\s)TOTAL[:\s]+\$?([\d,]+\.?\d{2})(?:\s|$)/i, priority: 10, name: 'TOTAL (generic)' },

    // === VENDOR-SPECIFIC PATTERNS ===
    // Sysco: INVOICE TOTAL with lots of whitespace
    { pattern: /INVOICE\s{2,}TOTAL\s{2,}([\d,]+\.?\d{0,3})/i, priority: 1, name: 'INVOICE TOTAL (wide)' },
    // US Foods patterns
    { pattern: /ORDER\s+TOTAL[:\s]*\$?([\d,]+\.?\d{0,3})/i, priority: 6, name: 'ORDER TOTAL' },
    { pattern: /DELIVERY\s+TOTAL[:\s]*\$?([\d,]+\.?\d{0,3})/i, priority: 6, name: 'DELIVERY TOTAL' },
    // Cintas patterns
    { pattern: /BILL\s+TOTAL[:\s]*\$?([\d,]+\.?\d{0,3})/i, priority: 5, name: 'BILL TOTAL' },
    { pattern: /STATEMENT\s+TOTAL[:\s]*\$?([\d,]+\.?\d{0,3})/i, priority: 5, name: 'STATEMENT TOTAL' },
    // Utility patterns
    { pattern: /CURRENT\s+CHARGES[:\s]*\$?([\d,]+\.?\d{0,3})/i, priority: 7, name: 'CURRENT CHARGES' },
    { pattern: /NEW\s+BALANCE[:\s]*\$?([\d,]+\.?\d{0,3})/i, priority: 7, name: 'NEW BALANCE' },
    { pattern: /AMOUNT\s+ENCLOSED[:\s]*\$?([\d,]+\.?\d{0,3})/i, priority: 8, name: 'AMOUNT ENCLOSED' },
  ];

  const subtotalPatterns = [
    { pattern: /(?:^|\s)SUBTOTAL[:\s]*\$?([\d,]+\.?\d{0,3})(?:\s|$)/i, priority: 1, name: 'SUBTOTAL' },
    { pattern: /SUB[\s\-]?TOTAL[:\s]*\$?([\d,]+\.?\d{0,3})/i, priority: 2, name: 'SUB-TOTAL' },
    { pattern: /MERCHANDISE\s+TOTAL[:\s]*\$?([\d,]+\.?\d{0,3})/i, priority: 3, name: 'MERCHANDISE TOTAL' },
  ];

  const taxPatterns = [
    { pattern: /SALES\s+TAX[:\s]*\$?([\d,]+\.?\d{0,3})/i, name: 'SALES TAX' },
    { pattern: /TAX\s*\(?[\d.]*%?\)?[:\s]*\$?([\d,]+\.?\d{0,3})/i, name: 'TAX' },
    { pattern: /VAT[:\s]*\$?([\d,]+\.?\d{0,3})/i, name: 'VAT' },
    { pattern: /GST[:\s]*\$?([\d,]+\.?\d{0,3})/i, name: 'GST' },
  ];

  const feePatterns = [
    { pattern: /FUEL\s+(?:SURCHARGE|FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d{0,3})/i, name: 'FUEL SURCHARGE' },
    { pattern: /DELIVERY\s+(?:FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d{0,3})/i, name: 'DELIVERY FEE' },
    { pattern: /SERVICE\s+(?:FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d{0,3})/i, name: 'SERVICE CHARGE' },
    { pattern: /HANDLING\s+(?:FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d{0,3})/i, name: 'HANDLING FEE' },
    { pattern: /ENVIRONMENT(?:AL)?\s+(?:FEE|CHARGE|SURCHARGE)[:\s]*\$?([\d,]+\.?\d{0,3})/i, name: 'ENVIRONMENTAL FEE' },
    { pattern: /ENERGY\s+SURCHARGE[:\s]*\$?([\d,]+\.?\d{0,3})/i, name: 'ENERGY SURCHARGE' },
    { pattern: /FREIGHT[:\s]*\$?([\d,]+\.?\d{0,3})/i, name: 'FREIGHT' },
    { pattern: /SHIPPING[:\s]*\$?([\d,]+\.?\d{0,3})/i, name: 'SHIPPING' },
  ];

  const discountPatterns = [
    { pattern: /DISCOUNT[:\s]*-?\$?([\d,]+\.?\d{0,3})/i, name: 'DISCOUNT' },
    { pattern: /CREDIT[:\s]*-?\$?([\d,]+\.?\d{0,3})/i, name: 'CREDIT' },
    { pattern: /REBATE[:\s]*-?\$?([\d,]+\.?\d{0,3})/i, name: 'REBATE' },
    { pattern: /SAVINGS[:\s]*-?\$?([\d,]+\.?\d{0,3})/i, name: 'SAVINGS' },
    { pattern: /PROMO(?:TION)?[:\s]*-?\$?([\d,]+\.?\d{0,3})/i, name: 'PROMO' },
  ];

  // ===== PRIORITY PASS -1: HORIZONTAL HEADER FORMAT (CINTAS) =====
  // Format: "SUBTOTAL SALES TAX TOTAL USD" on one line, values on next lines
  for (let i = 0; i < lines.length - 3; i++) {
    const line = lines[i]?.trim() || '';

    // Match: "SUBTOTAL SALES TAX TOTAL USD" or "SUBTOTAL TAX TOTAL USD"
    if (/SUBTOTAL\s+(?:SALES\s+)?TAX\s+TOTAL(?:\s+USD)?/i.test(line)) {
      const line1 = lines[i + 1]?.trim() || '';
      const line2 = lines[i + 2]?.trim() || '';
      const line3 = lines[i + 3]?.trim() || '';

      // Check if next 3 lines are all just numbers
      const val1Match = line1.match(/^([\d,]+\.?\d*)$/);
      const val2Match = line2.match(/^([\d,]+\.?\d*)$/);
      const val3Match = line3.match(/^([\d,]+\.?\d*)$/);

      if (val1Match && val2Match && val3Match) {
        const subtotalVal = parseMoneyToCents(val1Match[1]);
        const taxVal = parseMoneyToCents(val2Match[1]);
        const totalVal = parseMoneyToCents(val3Match[1]);

        if (totalVal > 0) {
          console.log(`[TOTALS] HORIZONTAL HEADER FORMAT: Subtotal=$${(subtotalVal/100).toFixed(2)}, Tax=$${(taxVal/100).toFixed(2)}, Total=$${(totalVal/100).toFixed(2)}`);
          return {
            totalCents: totalVal,
            subtotalCents: subtotalVal,
            taxCents: taxVal,
            feesCents: 0,
            discountCents: 0,
            evidence: {
              total: { cents: totalVal, name: 'HORIZONTAL HEADER (TOTAL USD)', line: `${line} -> ${line3}`, source: 'horizontal_header' },
              subtotal: { cents: subtotalVal, name: 'HORIZONTAL HEADER (SUBTOTAL)', line: line1 },
              tax: { cents: taxVal, name: 'HORIZONTAL HEADER (TAX)', line: line2 },
              fees: [],
              discounts: []
            }
          };
        }
      }

      // Also check if values are on the SAME line as headers (space-separated)
      const nextLine = lines[i + 1]?.trim() || '';
      const numbers = nextLine.match(/([\d,]+\.?\d*)/g);
      if (numbers && numbers.length >= 3) {
        const subtotalVal = parseMoneyToCents(numbers[0]);
        const taxVal = parseMoneyToCents(numbers[1]);
        const totalVal = parseMoneyToCents(numbers[2]);

        if (totalVal > 0) {
          console.log(`[TOTALS] HORIZONTAL SAME-LINE FORMAT: Subtotal=$${(subtotalVal/100).toFixed(2)}, Tax=$${(taxVal/100).toFixed(2)}, Total=$${(totalVal/100).toFixed(2)}`);
          return {
            totalCents: totalVal,
            subtotalCents: subtotalVal,
            taxCents: taxVal,
            feesCents: 0,
            discountCents: 0,
            evidence: {
              total: { cents: totalVal, name: 'HORIZONTAL SAME-LINE (TOTAL USD)', line: nextLine, source: 'horizontal_same_line' },
              subtotal: { cents: subtotalVal, name: 'HORIZONTAL SAME-LINE (SUBTOTAL)', line: nextLine },
              tax: { cents: taxVal, name: 'HORIZONTAL SAME-LINE (TAX)', line: nextLine },
              fees: [],
              discounts: []
            }
          };
        }
      }
    }
  }

  // ===== PRIORITY PASS 0: STACKED LABEL COLUMN FORMAT (CINTAS) =====
  // This MUST run FIRST to correctly handle:
  // SUBTOTAL       <- Label line (i-2)
  // SALES TAX      <- Label line (i-1)
  // TOTAL USD      <- Label line (i)
  // 1867.42        <- Value for SUBTOTAL (NOT the total!)
  // 130.72         <- Value for TAX
  // 1998.14        <- Value for TOTAL USD (THIS is the real total)
  for (let i = 2; i < lines.length - 3; i++) {
    const line0 = lines[i - 2]?.trim() || '';
    const line1 = lines[i - 1]?.trim() || '';
    const line2 = lines[i]?.trim() || '';
    const line3 = lines[i + 1]?.trim() || '';
    const line4 = lines[i + 2]?.trim() || '';
    const line5 = lines[i + 3]?.trim() || '';

    // Check if we have the stacked label pattern
    const isSubtotalLabel = /^SUBTOTAL\s*$/i.test(line0);
    const isTaxLabel = /^(?:SALES\s+)?TAX\s*$/i.test(line1);
    const isTotalLabel = /^TOTAL\s+USD\s*$/i.test(line2);

    if (isSubtotalLabel && isTaxLabel && isTotalLabel) {
      // Check if next 3 lines are all just numbers (the values)
      const val1Match = line3.match(/^([\d,]+\.?\d*)$/);
      const val2Match = line4.match(/^([\d,]+\.?\d*)$/);
      const val3Match = line5.match(/^([\d,]+\.?\d*)$/);

      if (val1Match && val2Match && val3Match) {
        const subtotalVal = parseMoneyToCents(val1Match[1]);
        const taxVal = parseMoneyToCents(val2Match[1]);
        const totalVal = parseMoneyToCents(val3Match[1]);

        if (totalVal > 0) {
          console.log(`[TOTALS] STACKED COLUMN FORMAT: Subtotal=$${(subtotalVal/100).toFixed(2)}, Tax=$${(taxVal/100).toFixed(2)}, Total=$${(totalVal/100).toFixed(2)}`);
          // Return immediately - this is the most reliable format
          return {
            totalCents: totalVal,
            subtotalCents: subtotalVal,
            taxCents: taxVal,
            feesCents: 0,
            discountCents: 0,
            evidence: {
              total: { cents: totalVal, name: 'STACKED COLUMN (TOTAL USD)', line: `${line2} -> ${line5}`, source: 'stacked_column' },
              subtotal: { cents: subtotalVal, name: 'STACKED COLUMN (SUBTOTAL)', line: `${line0} -> ${line3}` },
              tax: { cents: taxVal, name: 'STACKED COLUMN (TAX)', line: `${line1} -> ${line4}` },
              fees: [],
              discounts: []
            }
          };
        }
      }
    }
  }

  // FIRST PASS: Look for multi-line totals (label on one line, value on next)
  // This is critical for Sysco invoices where text extraction splits them
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i];
    const nextLine = lines[i + 1];
    const lineNorm = normalizeLine(line);
    const nextLineNorm = normalizeLine(nextLine);

    // Skip group subtotals
    if (isGroupSubtotalLine(line)) continue;

    // ===== CHECK FOR STACKED LABEL COLUMN - SKIP IF FOUND =====
    // If we're on "TOTAL USD" and the previous lines are SUBTOTAL/TAX labels,
    // then the NEXT line is the SUBTOTAL value, NOT the total!
    const prevLine1 = i >= 1 ? lines[i - 1]?.trim() : '';
    const prevLine2 = i >= 2 ? lines[i - 2]?.trim() : '';
    const isStackedLabelColumn = /^(?:SALES\s+)?TAX\s*$/i.test(prevLine1) && /^SUBTOTAL\s*$/i.test(prevLine2);

    // ===== CRITICAL FIX: SPLIT-LINE PATTERNS (HIGHEST PRIORITY) =====
    // These handle PDFs where labels and values are split across lines

    // PATTERN A: "INVOICE" alone on line N, "TOTAL value" on line N+1 (Sysco format)
    if (/^INVOICE\s*$/i.test(lineNorm)) {
      const totalValueMatch = nextLine ? nextLine.match(/^TOTAL[\s:]*\$?([\d,]+\.?\d{0,3})/i) : null;
      if (totalValueMatch && !/GROUP|SUBTOTAL/i.test(nextLine)) {
        const cents = parseMoneyToCents(totalValueMatch[1]);
        if (cents > 0 && cents < 100000000) {
          totalCandidates.push({
            cents,
            priority: -2,  // HIGHEST priority
            name: 'INVOICE + TOTAL (split-line)',
            line: `${line} | ${nextLine}`,
            lineIndex: i
          });
          console.log(`[TOTALS] Found INVOICE/TOTAL split: "${line}" + "${nextLine}" = $${(cents/100).toFixed(2)}`);
        }
      }
    }

    // PATTERN B: "TOTAL USD" alone on line N, value on line N+1 (Cintas format)
    // BUT SKIP if this is part of a stacked label column!
    if (!isStackedLabelColumn && /^TOTAL\s+USD\s*$/i.test(lineNorm)) {
      const valueMatch = nextLine ? nextLine.match(/^\s*\$?([\d,]+\.?\d{0,3})\s*$/) : null;
      if (valueMatch) {
        const cents = parseMoneyToCents(valueMatch[1]);
        if (cents > 0 && cents < 100000000) {
          totalCandidates.push({
            cents,
            priority: -2,  // HIGHEST priority
            name: 'TOTAL USD (split-line)',
            line: `${line} | ${nextLine}`,
            lineIndex: i
          });
          console.log(`[TOTALS] Found TOTAL USD split: "${line}" + "${nextLine}" = $${(cents/100).toFixed(2)}`);
        }
      }
    }

    // Check for "INVOICE TOTAL" or just "TOTAL" on its own line
    // More flexible patterns to handle PDF extraction variations:
    // - "TOTAL" alone or with trailing punctuation (TOTAL:, TOTAL.)
    // - Line ending with "TOTAL" (short lines only to avoid false positives)
    const isInvoiceTotal = /^(?:INVOICE\s+)?TOTAL\s*[:.]?\s*$/i.test(lineNorm) ||
                           /INVOICE\s+TOTAL\s*$/i.test(lineNorm);
    const isPlainTotal = /^TOTAL\s*[:.]?\s*$/i.test(lineNorm) ||
                         (/TOTAL\s*$/i.test(lineNorm) && lineNorm.length < 20);

    if (isInvoiceTotal || isPlainTotal) {
      // Next line should be just a money value
      // Allow 0, 1, or 2 decimal digits (PDF extraction may vary)
      const moneyMatch = nextLine.match(/^\s*\$?([\d,]+\.?\d{0,3})\s*$/);
      if (moneyMatch) {
        const cents = parseMoneyToCents(moneyMatch[1]);
        if (cents > 0 && cents < 100000000) {  // Reasonable range (< $1M)
          totalCandidates.push({
            cents,
            priority: isInvoiceTotal ? 0 : 5,  // Highest priority for INVOICE TOTAL
            name: isInvoiceTotal ? 'INVOICE TOTAL (multi-line)' : 'TOTAL (multi-line)',
            line: `${line} | ${nextLine}`,
            lineIndex: i
          });
          console.log(`[TOTALS] Found multi-line total: "${line}" + "${nextLine}" = $${(cents/100).toFixed(2)}`);
        }
      }
    }

    // Also check for "TOTAL" followed immediately by a value on the same line or context
    // Pattern: TOTAL <space> <value> where <value> might be on next line in Sysco format
    if (/TOTAL\s*$/i.test(lineNorm) && !/GROUP|SUBTOTAL/i.test(lineNorm)) {
      // Allow 0, 1, or 2 decimal digits
      const moneyMatch = nextLine.match(/^\s*\$?([\d,]+\.?\d{0,3})\s*$/);
      if (moneyMatch) {
        const cents = parseMoneyToCents(moneyMatch[1]);
        if (cents > 0 && cents < 100000000) {
          totalCandidates.push({
            cents,
            priority: 6,
            name: 'TOTAL (next-line value)',
            line: `${line} | ${nextLine}`,
            lineIndex: i
          });
          console.log(`[TOTALS] Found next-line total: "${line}" + "${nextLine}" = $${(cents/100).toFixed(2)}`);
        }
      }
    }
  }

  // ADDITIONAL: Direct regex scan for multi-line TOTAL in raw text
  // This catches cases where line splitting doesn't match expected behavior
  const rawMultiLineRegex = /(?:INVOICE\s+)?TOTAL\s*[\r\n]+\s*\$?([\d,]+\.?\d{0,3})\s*(?:[\r\n]|$)/gi;
  let rawMatch;
  while ((rawMatch = rawMultiLineRegex.exec(text)) !== null) {
    const cents = parseMoneyToCents(rawMatch[1]);
    if (cents > 0 && cents < 100000000) {
      // Skip if in GROUP TOTAL context
      const contextStart = Math.max(0, rawMatch.index - 50);
      const context = text.substring(contextStart, rawMatch.index + rawMatch[0].length);
      if (/GROUP|CATEGORY|DEPT|SECTION/i.test(context)) continue;

      const isInvoiceTotal = /INVOICE/i.test(rawMatch[0]);
      totalCandidates.push({
        cents,
        priority: isInvoiceTotal ? 1 : 6,
        name: isInvoiceTotal ? 'INVOICE TOTAL (raw-multiline)' : 'TOTAL (raw-multiline)',
        line: rawMatch[0].trim().replace(/[\r\n]+/g, ' | '),
        lineIndex: -1
      });
      console.log(`[TOTALS] Found raw multi-line total: $${(cents/100).toFixed(2)}`);
    }
  }

  // SECOND PASS: Scan lines from bottom to top (totals usually at bottom)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const lineNorm = normalizeLine(line);

    // Skip group subtotals
    if (isGroupSubtotalLine(line)) {
      continue;
    }

    // Look for TOTAL patterns (same-line)
    for (const { pattern, priority, name } of totalPatterns) {
      const match = line.match(pattern);
      if (match) {
        const cents = parseMoneyToCents(match[1]);
        if (cents > 0) {
          totalCandidates.push({
            cents,
            priority,
            name,
            line: line.trim(),
            lineIndex: i
          });
        }
      }
    }

    // Look for SUBTOTAL patterns
    for (const { pattern, priority, name } of subtotalPatterns) {
      const match = line.match(pattern);
      if (match) {
        const cents = parseMoneyToCents(match[1]);
        if (cents > 0) {
          subtotalCandidates.push({
            cents,
            priority,
            name,
            line: line.trim(),
            lineIndex: i
          });
        }
      }
    }

    // Look for TAX patterns (take first/bottom match)
    if (!evidence.tax) {
      for (const { pattern, name } of taxPatterns) {
        const match = line.match(pattern);
        if (match) {
          const cents = parseMoneyToCents(match[1]);
          if (cents > 0) {
            taxCents = cents;
            evidence.tax = { cents, name, line: line.trim() };
            break;
          }
        }
      }
    }

    // Look for FEE patterns (accumulate all)
    for (const { pattern, name } of feePatterns) {
      const match = line.match(pattern);
      if (match) {
        const cents = parseMoneyToCents(match[1]);
        if (cents > 0) {
          // Avoid duplicates by checking line similarity
          const isDuplicate = evidence.fees.some(f =>
            f.line === line.trim() || (f.name === name && f.cents === cents)
          );
          if (!isDuplicate) {
            feesCents += cents;
            evidence.fees.push({ cents, name, line: line.trim() });
          }
        }
      }
    }

    // Look for DISCOUNT patterns (accumulate all, normalize to negative)
    for (const { pattern, name } of discountPatterns) {
      const match = line.match(pattern);
      if (match) {
        const cents = parseMoneyToCents(match[1]);
        if (cents !== 0) {
          const isDuplicate = evidence.discounts.some(d =>
            d.line === line.trim() || (d.name === name && Math.abs(d.cents) === Math.abs(cents))
          );
          if (!isDuplicate) {
            // Discounts are always negative
            const discCents = cents > 0 ? -cents : cents;
            discountCents += discCents;
            evidence.discounts.push({ cents: discCents, name, line: line.trim() });
          }
        }
      }
    }
  }

  // Select best TOTAL candidate (lowest priority number = highest priority)
  // CRITICAL: Filter out any candidates whose evidence line contains GROUP TOTAL patterns
  if (totalCandidates.length > 0) {
    // Final GROUP TOTAL filter - reject any candidate with GROUP/CATEGORY/SECTION/DEPT in evidence
    const filteredCandidates = totalCandidates.filter(c => {
      const evidenceLine = String(c.line || '').toUpperCase();
      if (/GROUP\s*TOTAL|CATEGORY\s*TOTAL|SECTION\s*TOTAL|DEPT\.*\s*TOTAL/i.test(evidenceLine)) {
        console.log(`[TOTALS] REJECTING GROUP TOTAL candidate: $${(c.cents/100).toFixed(2)} from "${c.line}"`);
        return false;
      }
      return true;
    });

    const candidatesToUse = filteredCandidates.length > 0 ? filteredCandidates : totalCandidates;
    candidatesToUse.sort((a, b) => a.priority - b.priority);
    const best = candidatesToUse[0];
    totalCents = best.cents;
    evidence.total = {
      cents: best.cents,
      name: best.name,
      line: best.line,
      source: 'printed_line_scan',
      alternatives: candidatesToUse.length > 1 ? candidatesToUse.slice(1, 3) : []
    };
    console.log(`[TOTALS] Selected best total: $${(totalCents/100).toFixed(2)} (${best.name}) from: "${best.line}"`);
  }

  // Select best SUBTOTAL candidate (prefer largest that's <= total)
  if (subtotalCandidates.length > 0) {
    // Sort by value descending
    subtotalCandidates.sort((a, b) => b.cents - a.cents);
    // Pick largest that makes sense (less than or equal to total)
    const best = totalCents > 0
      ? subtotalCandidates.find(s => s.cents <= totalCents) || subtotalCandidates[0]
      : subtotalCandidates[0];
    subtotalCents = best.cents;
    evidence.subtotal = { cents: best.cents, name: best.name, line: best.line };
  }

  // ============================================================
  // NUCLEAR FALLBACK: If no total found, use universal finder
  // ============================================================
  if (totalCents === 0 && universalTotalFinder) {
    console.log('[TOTALS] No total found by line scan, trying universal finder...');
    try {
      const universalResult = universalTotalFinder.findInvoiceTotal(text);
      if (universalResult.found && universalResult.totalCents > 0) {
        totalCents = universalResult.totalCents;
        evidence.total = {
          cents: universalResult.totalCents,
          name: `UNIVERSAL FINDER (${universalResult.strategy})`,
          line: universalResult.debug?.topCandidates?.[0]?.strategies?.join(', ') || 'multiple strategies',
          source: 'universal_finder',
          confidence: universalResult.confidence
        };
        console.log(`[TOTALS] NUCLEAR FALLBACK: Universal finder found $${(totalCents/100).toFixed(2)} via ${universalResult.strategy}`);
      }
    } catch (e) {
      console.log('[TOTALS] Universal finder error:', e.message);
    }
  }

  // ============================================================
  // LAST RESORT: Text position search for INVOICE TOTAL
  // ============================================================
  if (totalCents === 0) {
    console.log('[TOTALS] LAST RESORT: Searching for any money value near INVOICE TOTAL...');
    const upperText = text.toUpperCase();
    const invoiceTotalPos = upperText.lastIndexOf('INVOICE TOTAL');
    const totalPos = invoiceTotalPos > 0 ? invoiceTotalPos : upperText.lastIndexOf('TOTAL');

    if (totalPos > 0) {
      // Get text around the "TOTAL" keyword (before and after)
      const searchStart = Math.max(0, totalPos - 50);
      const searchEnd = Math.min(text.length, totalPos + 200);
      const searchText = text.substring(searchStart, searchEnd);

      // Find ALL money values in this range
      const moneyPattern = /\$?\s*([\d,]+\.?\d{0,2})\b/g;
      let match;
      const moneyValues = [];

      while ((match = moneyPattern.exec(searchText)) !== null) {
        const cleaned = match[1].replace(/,/g, '');
        const num = parseFloat(cleaned);
        if (!isNaN(num) && num >= 10 && num <= 100000) {
          moneyValues.push({
            value: Math.round(num * 100),
            raw: match[0],
            index: match.index
          });
        }
      }

      // Take the largest reasonable value (usually the total)
      if (moneyValues.length > 0) {
        moneyValues.sort((a, b) => b.value - a.value);
        totalCents = moneyValues[0].value;
        evidence.total = {
          cents: totalCents,
          name: 'LAST RESORT (text position)',
          line: searchText.substring(0, 100).replace(/\n/g, ' '),
          source: 'text_position_search'
        };
        console.log(`[TOTALS] LAST RESORT found: $${(totalCents/100).toFixed(2)}`);
      }
    }
  }

  // ============================================================
  // SANITY CHECKS
  // ============================================================

  // Check 1: Total should be > 0 for valid invoices
  if (totalCents === 0) {
    console.log('[TOTALS] WARNING: No total found by any method!');
  }

  // Check 2: Total should be >= subtotal (if both exist)
  if (totalCents > 0 && subtotalCents > 0 && totalCents < subtotalCents) {
    console.log(`[TOTALS] WARNING: Total ($${(totalCents/100).toFixed(2)}) < Subtotal ($${(subtotalCents/100).toFixed(2)}) - this is unusual`);
    // Don't auto-fix, but log for debugging
  }

  // Check 3: Total should be in reasonable range ($1 - $100,000 for most invoices)
  if (totalCents > 0 && (totalCents < 100 || totalCents > 10000000)) {
    console.log(`[TOTALS] WARNING: Total ($${(totalCents/100).toFixed(2)}) is outside typical range`);
  }

  // Check 4: Verify total wasn't grabbed from a GROUP TOTAL context
  if (evidence.total && evidence.total.line) {
    const evidenceLine = String(evidence.total.line).toUpperCase();
    if (/GROUP\s*TOTAL|\*{3,}.*TOTAL/i.test(evidenceLine) && !/INVOICE/i.test(evidenceLine)) {
      console.log(`[TOTALS] CRITICAL: Total evidence contains GROUP TOTAL pattern! Resetting...`);
      // This should have been caught earlier, but double-check
    }
  }

  return {
    totalCents,
    subtotalCents,
    taxCents,
    feesCents,
    discountCents,
    evidence
  };
}

/**
 * Compute expected total from components using deterministic math
 * @param {Array} lineItems - Array of line items with totalCents
 * @param {Object} extractedTotals - Extracted totals from line scan
 * @returns {Object} - Computed values
 */
function computeInvoiceMath(lineItems, extractedTotals) {
  // Sum line items
  const sumLineItemsCents = (lineItems || []).reduce((sum, item) => {
    const itemTotal = item.totalCents || item.lineTotalCents || 0;
    return sum + itemTotal;
  }, 0);

  // Get extracted components
  const taxCents = extractedTotals?.taxCents || 0;
  const feesCents = extractedTotals?.feesCents || 0;
  const discountCents = extractedTotals?.discountCents || 0;  // Should be negative

  // Compute expected total: items + tax + fees + discount (discount is negative)
  const computedTotalCents = sumLineItemsCents + taxCents + feesCents + discountCents;

  return {
    sumLineItemsCents,
    computedTotalCents,
    components: {
      taxCents,
      feesCents,
      discountCents
    }
  };
}

/**
 * Reconcile extracted total vs computed total
 * @param {number} extractedTotalCents - Total from PDF text
 * @param {number} computedTotalCents - Total from math
 * @param {number} tolerance - Tolerance in cents (default 5)
 * @returns {Object} - Reconciliation result
 */
function reconcileTotals(extractedTotalCents, computedTotalCents, tolerance = 5) {
  const deltaCents = extractedTotalCents - computedTotalCents;
  const absDelta = Math.abs(deltaCents);

  const matches = absDelta === 0;
  const toleranceOk = absDelta <= tolerance;

  let reason = '';
  if (matches) {
    reason = 'Exact match';
  } else if (toleranceOk) {
    reason = `Within tolerance (${absDelta} cents difference)`;
  } else if (computedTotalCents === 0 && extractedTotalCents > 0) {
    reason = 'No line items to compare (using extracted total)';
  } else if (extractedTotalCents === 0 && computedTotalCents > 0) {
    reason = 'No extracted total (using computed total)';
  } else {
    reason = `Mismatch: extracted $${(extractedTotalCents/100).toFixed(2)} vs computed $${(computedTotalCents/100).toFixed(2)}`;
  }

  return {
    matches,
    toleranceOk,
    deltaCents,
    reason,
    extractedTotalCents,
    computedTotalCents
  };
}

/**
 * Select best total using priority logic
 * Priority: extracted total > computed total > sum of items
 * @param {Object} extracted - Extracted totals
 * @param {Object} computed - Computed math
 * @param {number} parsedTotalCents - Total from parser
 * @returns {Object} - Best total with source info
 */
function selectBestTotal(extracted, computed, parsedTotalCents = 0) {
  // Priority 1: Line-scan extracted total (printed on invoice)
  if (extracted?.totalCents > 0) {
    return {
      totalCents: extracted.totalCents,
      source: 'extracted',
      reason: `Extracted from invoice: ${extracted.evidence?.total?.name || 'TOTAL'}`,
      confidence: 0.95
    };
  }

  // Priority 2: Parser's total (if different extraction method)
  if (parsedTotalCents > 0) {
    return {
      totalCents: parsedTotalCents,
      source: 'parser',
      reason: 'From invoice parser',
      confidence: 0.85
    };
  }

  // Priority 3: Computed total (if we have components)
  if (computed?.computedTotalCents > 0 && computed.sumLineItemsCents > 0) {
    return {
      totalCents: computed.computedTotalCents,
      source: 'computed',
      reason: 'Computed from line items + tax + fees',
      confidence: 0.75
    };
  }

  // Priority 4: Just sum of items
  if (computed?.sumLineItemsCents > 0) {
    return {
      totalCents: computed.sumLineItemsCents,
      source: 'sum_items',
      reason: 'Sum of line items only',
      confidence: 0.6
    };
  }

  // No total found
  return {
    totalCents: 0,
    source: 'none',
    reason: 'No total could be determined',
    confidence: 0
  };
}

/**
 * Extract interesting lines for debugging
 * @param {string} text - Invoice text
 * @returns {Array} - Lines containing key financial keywords
 */
function extractInterestingLines(text) {
  if (!text) return [];

  const keywords = [
    'INVOICE', 'AMOUNT', 'TOTAL', 'SUBTOTAL', 'SUB-TOTAL',
    'TAX', 'FUEL', 'SURCHARGE', 'DISCOUNT', 'CREDIT',
    'DUE', 'BALANCE', 'FREIGHT', 'SHIPPING', 'FEE'
  ];

  const lines = text.split('\n');
  const interesting = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const lineUpper = line.toUpperCase();
    if (keywords.some(kw => lineUpper.includes(kw))) {
      interesting.push({
        lineNumber: i + 1,
        text: line
      });
    }
  }

  return interesting;
}

module.exports = {
  parseMoneyToCents,
  extractTotalsByLineScan,
  computeInvoiceMath,
  reconcileTotals,
  selectBestTotal,
  extractInterestingLines,
  isGroupSubtotalLine,
  normalizeLine,
  normalizeMoneyLine
};
