/**
 * Invoice Parsing V2 - Cintas Parser
 * Robust state-machine based parser for Cintas uniform invoices
 *
 * Cintas invoice structure:
 * - Header with vendor/customer info
 * - Table sections with columns: EMP#/LOCK# MATERIAL DESCRIPTION FREQ EXCH QTY UNIT PRICE LINE TOTAL TAX
 * - Employee subtotal rows (NOT line items, these sum items above)
 * - Program/fee rows (ARE line items: UNIFORM ADVANTAGE, INVENTORY MANAGEMENT, etc.)
 * - Department subtotals (NOT line items)
 * - Final totals block: SUBTOTAL, SALES TAX, TOTAL USD
 */

const {
  parseMoney,
  parseMoneyToDollars,
  calculateLineTotalCents,
  parseQty,
  scanFromBottom,
  isGroupSubtotal,
  isDeptSubtotal,
  isProgramFeeLine
} = require('../utils');
const { validateAndFixLineItems, isLikelyMisclassifiedItemCode } = require('../numberClassifier');
const { UNIVERSAL_SKU_PATTERN, extractSku, looksLikeSku, SKU_PATTERNS } = require('../skuPatterns');
const { validateParserTotals } = require('../coreExtractor');

/**
 * Process price string with 3 decimal precision
 * Returns both cents (rounded) and dollars (precise) for accurate calculations
 */
function processPrice(priceStr, qty = 1) {
  const dollars = parseMoneyToDollars(priceStr, 3);
  const cents = parseMoney(priceStr);
  const computedCents = calculateLineTotalCents(qty, dollars);
  return { dollars, cents, computedCents };
}

/**
 * Parse Cintas invoice header (vendor, customer, invoice number, etc.)
 */
function parseHeader(text, lines) {
  const header = {
    vendorName: 'Cintas Corporation',
    invoiceNumber: null,
    invoiceDate: null,
    accountNumber: null,
    customerName: null,
    soldTo: null,
    billTo: null,
    shipTo: null
  };

  // Invoice number patterns
  const invoicePatterns = [
    /Invoice\s*(?:#|No\.?|Number)?[:\s]*(\d{8,12})/i,
    /Invoice[:\s]+(\d{8,12})/i,
    /(?:^|\s)(\d{10})(?:\s|$)/m  // 10-digit number often is invoice #
  ];

  for (const pattern of invoicePatterns) {
    const match = text.match(pattern);
    if (match) {
      header.invoiceNumber = match[1];
      break;
    }
  }

  // Invoice date
  const datePatterns = [
    /Invoice\s+Date[:\s]*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i,
    /Date[:\s]*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i,
    /(\d{1,2}[-\/]\d{1,2}[-\/]\d{4})/  // Any date format
  ];

  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (match) {
      header.invoiceDate = match[1];
      break;
    }
  }

  // Account/customer - look for common patterns
  const accountPatterns = [
    /Account[:\s#]*(\d{6,10})/i,
    /Customer[:\s#]*(\d{6,10})/i,
    /Acct[:\s#]*(\d{6,10})/i
  ];

  for (const pattern of accountPatterns) {
    const match = text.match(pattern);
    if (match) {
      header.accountNumber = match[1];
      break;
    }
  }

  // Customer name - usually appears after "SOLD TO" or "BILL TO" or near top
  const soldToMatch = text.match(/SOLD\s*TO[:\s]*\n?([A-Z][A-Z0-9\s\.,&'-]+?)(?:\n|$)/im);
  if (soldToMatch) {
    header.customerName = soldToMatch[1].trim();
    header.soldTo = soldToMatch[1].trim();
  }

  const billToMatch = text.match(/BILL\s*TO[:\s]*\n?([A-Z][A-Z0-9\s\.,&'-]+?)(?:\n|$)/im);
  if (billToMatch) {
    header.billTo = billToMatch[1].trim();
    if (!header.customerName) header.customerName = header.billTo;
  }

  const shipToMatch = text.match(/SHIP\s*TO[:\s]*\n?([A-Z][A-Z0-9\s\.,&'-]+?)(?:\n|$)/im);
  if (shipToMatch) {
    header.shipTo = shipToMatch[1].trim();
  }

  // If no customer found, look for company name pattern near top
  if (!header.customerName) {
    // Look in first 20 lines for a company name
    for (let i = 0; i < Math.min(20, lines.length); i++) {
      const line = lines[i].trim();
      // Company patterns: ends with INC, LLC, CORP, etc.
      if (/\b(INC\.?|LLC|CORP\.?|COMPANY|CO\.?)$/i.test(line) && line.length < 60) {
        header.customerName = line;
        break;
      }
    }
  }

  return header;
}

/**
 * Find table regions in the text
 * Cintas tables have header: EMP#/LOCK# MATERIAL DESCRIPTION FREQ EXCH QTY UNIT PRICE LINE TOTAL TAX
 */
function findTableRegions(lines) {
  const regions = [];
  let currentRegion = null;

  const headerPatterns = [
    /EMP#.*MATERIAL.*DESCRIPTION/i,
    /MATERIAL.*DESCRIPTION.*FREQ.*QTY/i,
    /DESCRIPTION.*QTY.*UNIT\s*PRICE/i,
    /ITEM.*QTY.*PRICE.*TOTAL/i
  ];

  const terminatorPatterns = [
    /^FOR ALL NON-?PAYMENT/i,
    /^SPECIAL PROGRAMS BREAKDOWN/i,
    /^TERMS AND CONDITIONS/i,
    /^SUBTOTAL\s+TAX\s+TOTAL/i,  // Totals block header
    /^SUBTOTAL\s+[\d,]+\.\d{2}\s*$/i,  // Final subtotal line
    /^Please detach/i,
    /^REMIT TO/i
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for table header
    if (!currentRegion) {
      for (const pattern of headerPatterns) {
        if (pattern.test(line)) {
          currentRegion = {
            startLine: i,
            headerLine: i,
            endLine: null,
            lines: []
          };
          break;
        }
      }
    }

    // If in a region, check for terminator
    if (currentRegion && i > currentRegion.startLine) {
      let terminated = false;

      for (const pattern of terminatorPatterns) {
        if (pattern.test(line)) {
          currentRegion.endLine = i - 1;
          terminated = true;
          break;
        }
      }

      if (terminated) {
        // Collect lines in region
        for (let j = currentRegion.startLine + 1; j <= currentRegion.endLine; j++) {
          currentRegion.lines.push({ index: j, text: lines[j] });
        }
        regions.push(currentRegion);
        currentRegion = null;
      }
    }
  }

  // Close any open region at end
  if (currentRegion) {
    currentRegion.endLine = lines.length - 1;
    for (let j = currentRegion.startLine + 1; j <= currentRegion.endLine; j++) {
      currentRegion.lines.push({ index: j, text: lines[j] });
    }
    regions.push(currentRegion);
  }

  return regions;
}

/**
 * Parse a single line item row from Cintas table
 * Uses right-anchored parsing (extract numbers from end first)
 */
function parseItemRow(line) {
  // Skip empty lines
  if (!line.trim()) return null;

  // Skip if it's a group/dept subtotal
  if (isGroupSubtotal(line) || isDeptSubtotal(line)) return null;

  // Skip location/department header lines (e.g., "LOC 001 FR DEPT 1")
  if (/^LOC\s+\d+/i.test(line.trim()) || /^FR\s+DEPT\s+\d+/i.test(line.trim())) return null;

  // Skip lines that are just "Subtotal" with a number (department subtotals)
  if (/^Subtotal\s+[\d,]+\.?\d*\s*$/i.test(line.trim())) return null;

  // Check if it's a fee/program line (these ARE line items)
  const isFee = isProgramFeeLine(line);

  // Pattern for Cintas item row (simplified):
  // [EMP#] SKU DESCRIPTION FREQ EXCH QTY UNIT_PRICE LINE_TOTAL TAX
  // Example: "0001 X59294 PANTS INDUST HW 01 R 1 12.00 12.00 Y"
  // Example fee: "UNIFORM ADVANTAGE 104.48 Y"

  // Extract tax flag from end
  const taxMatch = line.match(/\s+([YN])\s*$/i);
  const taxFlag = taxMatch ? taxMatch[1].toUpperCase() : null;

  // Remove tax flag for number extraction
  let workLine = taxFlag ? line.slice(0, line.lastIndexOf(taxMatch[0])) : line;

  // Extract numbers from the line (from right to left: lineTotal, unitPrice, qty, ...)
  const numbers = [];
  const numPattern = /(\d[\d,]*\.?\d*)/g;
  let match;
  while ((match = numPattern.exec(workLine)) !== null) {
    const num = parseFloat(match[1].replace(/,/g, ''));
    if (Number.isFinite(num)) {
      numbers.push({
        value: num,
        index: match.index,
        raw: match[1]
      });
    }
  }

  if (numbers.length === 0) return null;

  // For fee lines, format is simpler: "DESCRIPTION AMOUNT TAX"
  if (isFee) {
    const lineTotalValue = numbers[numbers.length - 1].value;
    const descMatch = line.match(/^(.+?)\s+[\d,]+\.?\d*\s*[YN]?\s*$/i);
    const description = descMatch ? descMatch[1].trim() : line.trim();

    // Use precision processing
    const priceProc = processPrice(lineTotalValue, 1);

    return {
      type: 'fee',
      sku: null,
      description: description,
      qty: 1,
      unitPriceDollars: priceProc.dollars,
      unitPriceCents: priceProc.cents,
      lineTotalCents: priceProc.cents,
      computedTotalCents: priceProc.computedCents,
      taxFlag: taxFlag,
      employeeId: null,
      raw: line
    };
  }

  // For regular item rows, we need at least 3 numbers (qty, unitPrice, lineTotal)
  // Sometimes 4 if there's a freq code
  if (numbers.length < 2) return null;

  // Work backwards from the rightmost numbers
  const lineTotal = numbers[numbers.length - 1].value;
  const unitPrice = numbers.length >= 2 ? numbers[numbers.length - 2].value : lineTotal;

  // Qty might be right before unitPrice, or might be implied as 1
  let qty = 1;
  if (numbers.length >= 3) {
    const possibleQty = numbers[numbers.length - 3].value;
    // Qty is usually a small integer
    if (possibleQty >= 1 && possibleQty <= 999 && Number.isInteger(possibleQty)) {
      qty = possibleQty;
    }
  }

  // Extract SKU - try Cintas-specific X##### first, then universal patterns
  let sku = null;

  // Pattern 1: Cintas-specific X##### format (highest priority for Cintas invoices)
  const cintasSkuMatch = line.match(/\b(X\d{4,6})\b/i);
  if (cintasSkuMatch) {
    sku = cintasSkuMatch[1].toUpperCase();
  } else {
    // Pattern 2: Try universal SKU pattern (handles dashed, alphanumeric, pure digits)
    sku = extractSku(line);
  }

  // Extract employee ID if present (4-digit number at start)
  const empMatch = line.match(/^(\d{4})\s+/);
  const employeeId = empMatch ? empMatch[1] : null;

  // Description is everything between SKU (or start) and the first number we're using
  const lastUsedNumIdx = numbers.length >= 3 ? numbers[numbers.length - 3].index : numbers[numbers.length - 2].index;
  let descStart = skuMatch ? skuMatch.index + skuMatch[0].length : (empMatch ? empMatch[0].length : 0);
  const description = workLine.slice(descStart, lastUsedNumIdx).trim();

  // Use precision processing for accurate calculations
  const unitPriceDollars = parseMoneyToDollars(unitPrice, 3);
  const lineTotalCents = Math.round(lineTotal * 100);

  // Validate: lineTotal should roughly equal qty * unitPrice
  const expectedTotal = qty * unitPriceDollars;
  const tolerance = Math.max(0.01, expectedTotal * 0.05);  // 5% tolerance
  if (Math.abs(lineTotal - expectedTotal) > tolerance && qty !== 1) {
    // Qty might be wrong, recalculate
    qty = Math.round(lineTotal / unitPriceDollars);
    if (qty < 1) qty = 1;
  }

  const computedTotalCents = calculateLineTotalCents(qty, unitPriceDollars);

  return {
    type: 'item',
    sku: sku,
    description: description || 'Unknown Item',
    qty: qty,
    unitPriceDollars: unitPriceDollars,
    unitPriceCents: Math.round(unitPriceDollars * 100),
    lineTotalCents: lineTotalCents,
    computedTotalCents: computedTotalCents,
    taxFlag: taxFlag,
    employeeId: employeeId,
    raw: line
  };
}

/**
 * Extract final totals from bottom of invoice
 * Cintas format: SUBTOTAL / SALES TAX / TOTAL USD appearing near end
 *
 * BULLETPROOF IMPLEMENTATION: Handles ALL format variations including:
 * - Same-line: "TOTAL USD 1998.14"
 * - Split-line: "TOTAL USD" then "1998.14" on next line
 * - Stacked labels: "SUBTOTAL" / "TAX" / "TOTAL USD" then values below
 * - Horizontal header: "SUBTOTAL TAX TOTAL USD" then "1867.42 130.72 1998.14"
 * - Any combination with whitespace, $ signs, or extra characters
 */
function extractTotals(text, lines) {
  const totals = {
    subtotalCents: 0,
    taxCents: 0,
    totalCents: 0,
    currency: 'USD',
    debug: {
      subtotalLine: null,
      taxLine: null,
      totalLine: null,
      method: null
    }
  };

  console.log(`[CINTAS TOTALS] ========== BULLETPROOF EXTRACTION ==========`);
  console.log(`[CINTAS TOTALS] Scanning ${lines.length} lines for totals...`);

  // =====================================================================
  // COMPREHENSIVE DIAGNOSTIC DUMP - Track every extraction attempt
  // =====================================================================
  const diagnostics = {
    textLength: text.length,
    lineCount: lines.length,
    attempts: [],
    rawMatches: {
      subtotal: [],
      tax: [],
      totalUsd: [],
      genericTotal: []
    },
    formatFingerprint: {
      hasSubtotalKeyword: false,
      hasTaxKeyword: false,
      hasTotalUsdKeyword: false,
      hasStackedFormat: false,
      hasHorizontalFormat: false,
      hasSplitLineFormat: false,
      dollarSignsFound: 0,
      moneyValuesFound: 0
    },
    finalDecision: null
  };

  // FORMAT FINGERPRINTING - Identify invoice structure
  const textUpper = text.toUpperCase();
  diagnostics.formatFingerprint.hasSubtotalKeyword = /SUBTOTAL/i.test(text);
  diagnostics.formatFingerprint.hasTaxKeyword = /\bTAX\b/i.test(text);
  diagnostics.formatFingerprint.hasTotalUsdKeyword = /TOTAL\s+USD/i.test(text);
  diagnostics.formatFingerprint.dollarSignsFound = (text.match(/\$/g) || []).length;
  diagnostics.formatFingerprint.moneyValuesFound = (text.match(/\d+\.\d{2}/g) || []).length;

  // PRODUCTION DEBUG: Log last 50 lines so we can see actual PDF format
  console.log(`[CINTAS TOTALS] === LAST 50 LINES OF TEXT (for debugging) ===`);
  const last50 = lines.slice(-50);
  last50.forEach((line, idx) => {
    const lineNum = lines.length - 50 + idx;
    // Highlight lines with money values or total keywords
    const hasMoney = /\d+\.\d{2}/.test(line);
    const hasTotal = /TOTAL|SUBTOTAL|TAX/i.test(line);
    const marker = hasTotal ? '>>>' : (hasMoney ? '  $' : '   ');
    console.log(`[CINTAS L${lineNum}]${marker} "${line}"`);
  });
  console.log(`[CINTAS TOTALS] === END LAST 50 LINES ===`);

  // RAW TEXT SEARCH - Find ALL occurrences of key patterns
  console.log(`[CINTAS TOTALS] === RAW PATTERN SEARCH ===`);

  // Find ALL SUBTOTAL mentions
  const subtotalMatches = [...text.matchAll(/SUBTOTAL[\s:]*\$?([\d,]+\.?\d*)/gi)];
  subtotalMatches.forEach((m, i) => {
    const val = parseMoney(m[1]);
    diagnostics.rawMatches.subtotal.push({ raw: m[0], value: val, index: m.index });
    console.log(`[CINTAS RAW] SUBTOTAL #${i+1}: "${m[0]}" => $${(val/100).toFixed(2)} at pos ${m.index}`);
  });

  // Find ALL TAX mentions
  const taxMatches = [...text.matchAll(/(?:SALES\s+)?TAX[\s:]*\$?([\d,]+\.?\d*)/gi)];
  taxMatches.forEach((m, i) => {
    const val = parseMoney(m[1]);
    diagnostics.rawMatches.tax.push({ raw: m[0], value: val, index: m.index });
    console.log(`[CINTAS RAW] TAX #${i+1}: "${m[0]}" => $${(val/100).toFixed(2)} at pos ${m.index}`);
  });

  // Find ALL TOTAL USD mentions (THE KEY ONE) - Multiple patterns for robustness
  // Pattern 1: TOTAL USD followed by value on same line
  const totalUsdMatches = [...text.matchAll(/TOTAL\s+USD[\s:]*\$?([\d,]+\.?\d*)/gi)];
  totalUsdMatches.forEach((m, i) => {
    const val = parseMoney(m[1]);
    if (val > 0) {
      diagnostics.rawMatches.totalUsd.push({ raw: m[0], value: val, index: m.index });
      console.log(`[CINTAS RAW] TOTAL USD (pattern 1) #${i+1}: "${m[0]}" => $${(val/100).toFixed(2)} at pos ${m.index}`);
    }
  });

  // Pattern 2: TOTAL USD on one line, value on next line (stacked format)
  const totalUsdStackedPattern = /TOTAL\s+USD\s*\n\s*\$?([\d,]+\.?\d{2})/gi;
  const totalUsdStackedMatches = [...text.matchAll(totalUsdStackedPattern)];
  totalUsdStackedMatches.forEach((m, i) => {
    const val = parseMoney(m[1]);
    if (val > 0) {
      diagnostics.rawMatches.totalUsd.push({ raw: m[0].replace(/\n/g, ' '), value: val, index: m.index });
      console.log(`[CINTAS RAW] TOTAL USD (stacked) #${i+1}: "${m[0].replace(/\n/g, '\\n')}" => $${(val/100).toFixed(2)} at pos ${m.index}`);
    }
  });

  // Pattern 3: Line-by-line search - find "TOTAL USD" line, then look at next line for value
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^TOTAL\s+USD\s*$/i.test(line) || /TOTAL\s+USD\s*$/i.test(line)) {
      // Check same line for value first
      const sameLine = line.match(/TOTAL\s+USD\s+\$?([\d,]+\.?\d{2})/i);
      if (sameLine) {
        const val = parseMoney(sameLine[1]);
        if (val > 0 && !diagnostics.rawMatches.totalUsd.find(m => m.value === val)) {
          diagnostics.rawMatches.totalUsd.push({ raw: line, value: val, index: i, lineNum: i });
          console.log(`[CINTAS RAW] TOTAL USD (line ${i}) same line: "${line}" => $${(val/100).toFixed(2)}`);
        }
      }
      // Check next line for value
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        const nextVal = parseMoney(nextLine);
        if (nextVal > 100000) { // At least $1000 to be a total
          if (!diagnostics.rawMatches.totalUsd.find(m => m.value === nextVal)) {
            diagnostics.rawMatches.totalUsd.push({ raw: `${line} / ${nextLine}`, value: nextVal, index: i, lineNum: i });
            console.log(`[CINTAS RAW] TOTAL USD (line ${i}+${i+1}) next line: "${nextLine}" => $${(nextVal/100).toFixed(2)}`);
          }
        }
      }
    }
  }

  // Pattern 4: NUCLEAR - scan ALL lines for money values near "TOTAL USD" text
  const totalUsdLineIdx = lines.findIndex(l => /TOTAL\s+USD/i.test(l));
  if (totalUsdLineIdx >= 0) {
    console.log(`[CINTAS RAW] Found TOTAL USD at line ${totalUsdLineIdx}: "${lines[totalUsdLineIdx].trim()}"`);
    // Check for value on same line (right side)
    const lineText = lines[totalUsdLineIdx];
    const allNumbers = [...lineText.matchAll(/([\d,]+\.\d{2})/g)];
    allNumbers.forEach((m, i) => {
      const val = parseMoney(m[1]);
      if (val > 100000) { // At least $1000
        if (!diagnostics.rawMatches.totalUsd.find(match => match.value === val)) {
          diagnostics.rawMatches.totalUsd.push({ raw: lineText.trim(), value: val, index: totalUsdLineIdx, source: 'nuclear_same_line' });
          console.log(`[CINTAS RAW] TOTAL USD (NUCLEAR same line): "${m[1]}" => $${(val/100).toFixed(2)}`);
        }
      }
    });
  }

  // Find generic TOTAL (but not SUBTOTAL or TOTAL USD)
  const genericTotalMatches = [...text.matchAll(/(?<!SUB)TOTAL(?!\s+USD)[\s:]*\$?([\d,]+\.?\d*)/gi)];
  genericTotalMatches.forEach((m, i) => {
    const val = parseMoney(m[1]);
    if (val > 0) {
      diagnostics.rawMatches.genericTotal.push({ raw: m[0], value: val, index: m.index });
      console.log(`[CINTAS RAW] GENERIC TOTAL #${i+1}: "${m[0]}" => $${(val/100).toFixed(2)} at pos ${m.index}`);
    }
  });

  console.log(`[CINTAS TOTALS] === END RAW PATTERN SEARCH ===`);
  console.log(`[CINTAS TOTALS] Format fingerprint:`, JSON.stringify(diagnostics.formatFingerprint));

  // =====================================================================
  // UNIVERSAL TEXT NORMALIZATION
  // Handle ALL whitespace, unicode, and PDF extraction quirks
  // =====================================================================
  const normalizeText = (s) => {
    if (!s) return '';
    return String(s)
      .replace(/\r/g, '')
      // Unicode space normalization
      .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
      .replace(/\t/g, ' ')
      // Normalize dashes
      .replace(/[\u2010-\u2015\u2212]/g, '-')
      // Fix split numbers: "1 748" -> "1748"
      .replace(/(\d)\s+(?=\d)/g, '$1')
      // Fix split decimals: "1748 .85" -> "1748.85"
      .replace(/(\d)\s+\.(?=\d)/g, '$1.')
      .replace(/\.\s+(?=\d)/g, '.')
      .replace(/,\s+(?=\d)/g, ',')
      .replace(/\s{2,}/g, ' ')
      .trim();
  };

  // Helper: Extract money value from string (flexible)
  const extractMoney = (s) => {
    if (!s) return 0;
    const normalized = normalizeText(s);
    const match = normalized.match(/\$?\s*([\d,]+\.?\d*)/);
    return match ? parseMoney(match[1]) : 0;
  };

  // Helper: Check if string is just a money value
  const isMoneyOnly = (s) => {
    const n = normalizeText(s);
    return /^\$?\s*[\d,]+\.?\d*\s*$/.test(n);
  };

  // Helper: Check if string is a label (SUBTOTAL, TAX, TOTAL USD, etc.)
  const isSubtotalLabel = (s) => /^(?:SUB[\s-]?TOTAL)\s*$/i.test(normalizeText(s));
  const isTaxLabel = (s) => /^(?:(?:SALES\s+)?TAX)\s*$/i.test(normalizeText(s));
  const isTotalUsdLabel = (s) => /^TOTAL\s+USD\s*$/i.test(normalizeText(s));

  // Normalize all lines for consistent matching
  const normalizedLines = lines.map(l => normalizeText(l));
  const normalizedText = normalizeText(text);

  // =====================================================================
  // PRE-SCAN: Find TOTAL USD on SAME LINE (most reliable)
  // Handles: "TOTAL USD 1998.14", "TOTAL USD: $1,998.14", etc.
  // =====================================================================
  let preScannedTotalUsd = 0;
  const totalUsdPatterns = [
    /TOTAL\s+USD\s*:?\s*\$?\s*([\d,]+\.?\d*)/gi,
    /TOTAL\s+USD\s+([\d,]+\.?\d*)/gi,
  ];

  for (const pattern of totalUsdPatterns) {
    const matches = [...normalizedText.matchAll(pattern)];
    if (matches.length > 0) {
      const lastMatch = matches[matches.length - 1];
      const value = parseMoney(lastMatch[1]);
      if (value > 0 && value > preScannedTotalUsd) {
        preScannedTotalUsd = value;
        console.log(`[CINTAS TOTALS] PRE-SCAN found TOTAL USD: $${(value/100).toFixed(2)}`);
      }
    }
  }

  // CRITICAL: Prioritize TOTAL USD over generic TOTAL (to avoid picking up SUBTOTAL)
  // ENHANCED: Handle split-line formats where "TOTAL USD" and value are separated by whitespace/newline
  const totalPatterns = [
    /TOTAL\s+USD[\s\r\n:]*\$?([\d,]+\.?\d*)/i,   // Highest priority - Cintas with flexible whitespace
    /TOTAL\s+USD\s*([\d,]+\.?\d*)/i,             // Cintas specific (fallback)
    /INVOICE\s+TOTAL\s*([\d,]+\.?\d*)/i,         // High priority
    /AMOUNT\s+DUE\s*([\d,]+\.?\d*)/i,            // Medium priority
    /(?:^|\s)TOTAL\s*:?\s*\$?([\d,]+\.?\d*)/i    // Lowest priority - must not be SUBTOTAL
  ];

  const subtotalPatterns = [
    /^SUBTOTAL\s+([\d,]+\.?\d*)\s*$/im,
    /SUBTOTAL\s*:?\s*\$?([\d,]+\.?\d*)/i
  ];

  const taxPatterns = [
    /SALES\s+TAX\s*([\d,]+\.?\d*)/i,
    /TAX\s*:?\s*\$?([\d,]+\.?\d*)/i
  ];

  // Scan from bottom (last 100 lines)
  const scanLines = lines.slice(-100);
  const baseIdx = lines.length - scanLines.length;

  // =====================================================================
  // PRIORITY PASS 0: USE SHARED TOTALS.JS EXTRACTOR FIRST
  // This has the most comprehensive format handling (FORMAT 1-7)
  // =====================================================================
  try {
    const { extractTotalsByLineScan } = require('../totals');
    const sharedResult = extractTotalsByLineScan(text);
    if (sharedResult.totalCents > 0) {
      console.log(`[CINTAS TOTALS] Shared extractor found total: $${(sharedResult.totalCents/100).toFixed(2)} via ${sharedResult.evidence?.total?.source || 'unknown'}`);

      // CRITICAL SANITY CHECK: Reject absurdly high totals (likely misread numbers)
      const MAX_REASONABLE_TOTAL_CENTS = 10000000; // $100,000
      if (sharedResult.totalCents > MAX_REASONABLE_TOTAL_CENTS) {
        console.log(`[CINTAS TOTALS] REJECTED shared result - total $${(sharedResult.totalCents/100).toFixed(2)} exceeds $100k max`);
      } else {
        // Only use shared result if it found TOTAL USD or similar Cintas patterns
        const evidence = String(sharedResult.evidence?.total?.name || '').toUpperCase();
        if (evidence.includes('USD') || evidence.includes('STACKED') || evidence.includes('ALTERNATING') || evidence.includes('HORIZ')) {
          totals.totalCents = sharedResult.totalCents;
          totals.subtotalCents = sharedResult.subtotalCents || 0;
          totals.taxCents = sharedResult.taxCents || 0;
          totals.debug.method = 'shared_totals.js';
          console.log(`[CINTAS TOTALS] Using shared extractor result: $${(totals.totalCents/100).toFixed(2)}`);
          // Continue to verify with pre-scan
        }
      }
    }
  } catch (e) {
    console.log(`[CINTAS TOTALS] Shared extractor not available: ${e.message}`);
  }

  // ===== PRIORITY PASS: STACKED LABEL COLUMN FORMAT =====
  // This handles PDFs where labels and values are in separate columns:
  // SUBTOTAL       <- Label line
  // SALES TAX      <- Label line
  // TOTAL USD      <- Label line
  // 1867.42        <- Value for SUBTOTAL
  // 130.72         <- Value for TAX
  // 1998.14        <- Value for TOTAL USD (the one we want!)
  for (let i = 2; i < scanLines.length - 3; i++) {
    const line0 = normalizeText(scanLines[i - 2] || '');
    const line1 = normalizeText(scanLines[i - 1] || '');
    const line2 = normalizeText(scanLines[i] || '');
    const line3 = normalizeText(scanLines[i + 1] || '');
    const line4 = normalizeText(scanLines[i + 2] || '');
    const line5 = normalizeText(scanLines[i + 3] || '');

    // Check if we have the stacked label pattern (flexible matching)
    const hasSubtotalLabel = isSubtotalLabel(line0);
    const hasTaxLabel = isTaxLabel(line1);
    const hasTotalLabel = isTotalUsdLabel(line2);

    if (hasSubtotalLabel && hasTaxLabel && hasTotalLabel) {
      // Check if next 3 lines are money values (FLEXIBLE - allow $ signs, whitespace)
      if (isMoneyOnly(line3) && isMoneyOnly(line4) && isMoneyOnly(line5)) {
        const subtotalVal = extractMoney(line3);
        const taxVal = extractMoney(line4);
        const totalVal = extractMoney(line5);

        if (totalVal > 0 && totalVal >= subtotalVal) {
          totals.subtotalCents = subtotalVal;
          totals.taxCents = taxVal;
          totals.totalCents = totalVal;
          totals.debug.subtotalLine = baseIdx + i + 1;
          totals.debug.taxLine = baseIdx + i + 2;
          totals.debug.totalLine = baseIdx + i + 3;
          totals.debug.method = 'stacked_label_column';
          console.log(`[CINTAS TOTALS] ✓ STACKED LABEL COLUMN: Subtotal=$${(totals.subtotalCents/100).toFixed(2)}, Tax=$${(totals.taxCents/100).toFixed(2)}, Total=$${(totals.totalCents/100).toFixed(2)}`);
          return totals;
        }
      }
    }
  }

  // ===== ADDITIONAL FORMAT: ALTERNATING LABEL-VALUE PAIRS =====
  // SUBTOTAL
  // 1867.42
  // SALES TAX
  // 130.72
  // TOTAL USD
  // 1998.14
  for (let i = 0; i < scanLines.length - 5; i++) {
    const l0 = normalizeText(scanLines[i] || '');
    const l1 = normalizeText(scanLines[i + 1] || '');
    const l2 = normalizeText(scanLines[i + 2] || '');
    const l3 = normalizeText(scanLines[i + 3] || '');
    const l4 = normalizeText(scanLines[i + 4] || '');
    const l5 = normalizeText(scanLines[i + 5] || '');

    if (isSubtotalLabel(l0) && isMoneyOnly(l1) &&
        isTaxLabel(l2) && isMoneyOnly(l3) &&
        isTotalUsdLabel(l4) && isMoneyOnly(l5)) {
      const subtotalVal = extractMoney(l1);
      const taxVal = extractMoney(l3);
      const totalVal = extractMoney(l5);

      if (totalVal > 0 && totalVal >= subtotalVal) {
        totals.subtotalCents = subtotalVal;
        totals.taxCents = taxVal;
        totals.totalCents = totalVal;
        totals.debug.method = 'alternating_label_value';
        console.log(`[CINTAS TOTALS] ✓ ALTERNATING: Subtotal=$${(subtotalVal/100).toFixed(2)}, Tax=$${(taxVal/100).toFixed(2)}, Total=$${(totalVal/100).toFixed(2)}`);
        return totals;
      }
    }
  }

  // ===== ADDITIONAL FORMAT: HORIZONTAL HEADER THEN SEPARATE VALUE LINES =====
  // SUBTOTAL SALES TAX TOTAL USD
  // 1867.42
  // 130.72
  // 1998.14
  for (let i = 0; i < scanLines.length - 3; i++) {
    const header = normalizeText(scanLines[i] || '');
    const l1 = normalizeText(scanLines[i + 1] || '');
    const l2 = normalizeText(scanLines[i + 2] || '');
    const l3 = normalizeText(scanLines[i + 3] || '');

    if (/SUBTOTAL\s+(?:SALES\s+)?TAX\s+TOTAL\s+USD/i.test(header)) {
      if (isMoneyOnly(l1) && isMoneyOnly(l2) && isMoneyOnly(l3)) {
        const subtotalVal = extractMoney(l1);
        const taxVal = extractMoney(l2);
        const totalVal = extractMoney(l3);

        if (totalVal > 0 && totalVal >= subtotalVal) {
          totals.subtotalCents = subtotalVal;
          totals.taxCents = taxVal;
          totals.totalCents = totalVal;
          totals.debug.method = 'horiz_header_3lines';
          console.log(`[CINTAS TOTALS] ✓ HORIZ HEADER 3 LINES: Subtotal=$${(subtotalVal/100).toFixed(2)}, Tax=$${(taxVal/100).toFixed(2)}, Total=$${(totalVal/100).toFixed(2)}`);
          return totals;
        }
      }
    }
  }

  // ===== ADDITIONAL FORMAT: HORIZONTAL HEADER WITH VALUES ON SAME LINE =====
  // SUBTOTAL SALES TAX TOTAL USD
  // 1867.42 130.72 1998.14
  for (let i = 0; i < scanLines.length - 1; i++) {
    const header = normalizeText(scanLines[i] || '');
    const valueLine = normalizeText(scanLines[i + 1] || '');

    if (/SUBTOTAL\s+(?:SALES\s+)?TAX\s+TOTAL\s+USD/i.test(header)) {
      const numbers = valueLine.match(/([\d,]+\.?\d*)/g);
      if (numbers && numbers.length >= 3) {
        const subtotalVal = parseMoney(numbers[0]);
        const taxVal = parseMoney(numbers[1]);
        const totalVal = parseMoney(numbers[2]);

        if (totalVal > 0 && totalVal >= subtotalVal) {
          totals.subtotalCents = subtotalVal;
          totals.taxCents = taxVal;
          totals.totalCents = totalVal;
          totals.debug.method = 'horiz_header_sameline';
          console.log(`[CINTAS TOTALS] ✓ HORIZ HEADER SAME LINE: Subtotal=$${(subtotalVal/100).toFixed(2)}, Tax=$${(taxVal/100).toFixed(2)}, Total=$${(totalVal/100).toFixed(2)}`);
          return totals;
        }
      }
    }
  }

  // FIRST PASS: Look for TOTAL USD specifically (most reliable for Cintas)
  for (let i = scanLines.length - 1; i >= 0; i--) {
    const line = normalizeText(scanLines[i] || '');
    const nextLine = i + 1 < scanLines.length ? normalizeText(scanLines[i + 1] || '') : '';

    // Skip employee/dept subtotals
    if (isGroupSubtotal(scanLines[i]) || isDeptSubtotal(scanLines[i])) continue;

    // PATTERN 1: "TOTAL USD" with value on SAME line
    const totalUsdMatch = line.match(/TOTAL\s+USD\s*:?\s*\$?\s*([\d,]+\.?\d*)/i);
    if (totalUsdMatch && parseMoney(totalUsdMatch[1]) > 0) {
      totals.totalCents = parseMoney(totalUsdMatch[1]);
      totals.debug.totalLine = baseIdx + i;
      totals.debug.method = 'total_usd_same_line';
      console.log(`[CINTAS TOTALS] ✓ TOTAL USD (same line): $${(totals.totalCents/100).toFixed(2)} at line ${baseIdx + i}`);

      // Continue to find subtotal and tax, then return
      for (let j = i - 1; j >= Math.max(0, i - 20); j--) {
        const prevLine = scanLines[j];

        if (!totals.debug.taxLine) {
          for (const taxPat of taxPatterns) {
            const taxMatch = prevLine.match(taxPat);
            if (taxMatch) {
              totals.taxCents = parseMoney(taxMatch[1]);
              totals.debug.taxLine = baseIdx + j;
              console.log(`[CINTAS TOTALS] Found TAX: $${(totals.taxCents/100).toFixed(2)} at line ${baseIdx + j}`);
              break;
            }
          }
        }

        if (!totals.debug.subtotalLine) {
          if (!isGroupSubtotal(prevLine) && !isDeptSubtotal(prevLine)) {
            for (const subPat of subtotalPatterns) {
              const subMatch = prevLine.match(subPat);
              if (subMatch) {
                totals.subtotalCents = parseMoney(subMatch[1]);
                totals.debug.subtotalLine = baseIdx + j;
                console.log(`[CINTAS TOTALS] Found SUBTOTAL: $${(totals.subtotalCents/100).toFixed(2)} at line ${baseIdx + j}`);
                break;
              }
            }
          }
        }

        if (totals.debug.taxLine && totals.debug.subtotalLine) break;
      }

      return totals;
    }

    // PATTERN 2: "TOTAL USD" on this line, VALUE on NEXT line (split by PDF extraction)
    // CRITICAL: Skip if this is a HEADER row with multiple labels (e.g., "SUBTOTAL SALES TAX TOTAL USD")
    // Those need columnar parsing, not split-line parsing
    const isHeaderRow = /SUBTOTAL\s+.*TOTAL\s+USD/i.test(line) || /SUBTOTAL\s+(?:SALES\s+)?TAX/i.test(line);

    // ALSO check if this is part of a STACKED LABEL COLUMN format:
    // SUBTOTAL      <- Line i-2
    // SALES TAX     <- Line i-1
    // TOTAL USD     <- Line i (current)
    // 1867.42       <- Value for SUBTOTAL (NOT the total!)
    // 130.72        <- Value for TAX
    // 1998.14       <- Value for TOTAL USD (THIS is what we want)
    const prevLine1 = i >= 1 ? normalizeText(scanLines[i - 1] || '') : '';
    const prevLine2 = i >= 2 ? normalizeText(scanLines[i - 2] || '') : '';
    const isStackedLabelColumn = isTaxLabel(prevLine1) && isSubtotalLabel(prevLine2);

    if (!isHeaderRow && !isStackedLabelColumn && isTotalUsdLabel(line)) {
      // Value should be on next line - use flexible matching
      if (isMoneyOnly(nextLine)) {
        const totalVal = extractMoney(nextLine);
        if (totalVal > 0) {
          totals.totalCents = totalVal;
          totals.debug.totalLine = baseIdx + i;
          totals.debug.method = 'total_usd_split_line';
          console.log(`[CINTAS TOTALS] ✓ TOTAL USD (split-line): $${(totals.totalCents/100).toFixed(2)} at lines ${baseIdx + i}-${baseIdx + i + 1}`);

          // Find subtotal and tax
          for (let j = i - 1; j >= Math.max(0, i - 20); j--) {
            const prevLine = scanLines[j];
            if (!totals.debug.taxLine) {
              for (const taxPat of taxPatterns) {
                const taxMatch = prevLine.match(taxPat);
                if (taxMatch) {
                  totals.taxCents = parseMoney(taxMatch[1]);
                  totals.debug.taxLine = baseIdx + j;
                  break;
                }
              }
            }
            if (!totals.debug.subtotalLine && !isGroupSubtotal(prevLine) && !isDeptSubtotal(prevLine)) {
              for (const subPat of subtotalPatterns) {
                const subMatch = prevLine.match(subPat);
                if (subMatch) {
                  totals.subtotalCents = parseMoney(subMatch[1]);
                  totals.debug.subtotalLine = baseIdx + j;
                  break;
                }
              }
            }
            if (totals.debug.taxLine && totals.debug.subtotalLine) break;
          }
          return totals;
        }
      }
    }

    // LEGACY: Original TOTAL USD pattern (for compatibility)
    const totalUsdMatchLegacy = line.match(/TOTAL\s+USD\s*([\d,]+\.?\d*)/i);
    if (totalUsdMatchLegacy) {
      totals.totalCents = parseMoney(totalUsdMatchLegacy[1]);
      totals.debug.totalLine = baseIdx + i;
      console.log(`[CINTAS TOTALS] Found TOTAL USD (legacy): $${(totals.totalCents/100).toFixed(2)} at line ${baseIdx + i}`);

      // Now look backwards for subtotal and tax
      for (let j = i - 1; j >= Math.max(0, i - 20); j--) {
        const prevLine = scanLines[j];

        if (!totals.debug.taxLine) {
          for (const taxPat of taxPatterns) {
            const taxMatch = prevLine.match(taxPat);
            if (taxMatch) {
              totals.taxCents = parseMoney(taxMatch[1]);
              totals.debug.taxLine = baseIdx + j;
              console.log(`[CINTAS TOTALS] Found TAX: $${(totals.taxCents/100).toFixed(2)} at line ${baseIdx + j}`);
              break;
            }
          }
        }

        if (!totals.debug.subtotalLine) {
          // Make sure we're not picking up a group subtotal
          if (!isGroupSubtotal(prevLine) && !isDeptSubtotal(prevLine)) {
            for (const subPat of subtotalPatterns) {
              const subMatch = prevLine.match(subPat);
              if (subMatch) {
                totals.subtotalCents = parseMoney(subMatch[1]);
                totals.debug.subtotalLine = baseIdx + j;
                console.log(`[CINTAS TOTALS] Found SUBTOTAL: $${(totals.subtotalCents/100).toFixed(2)} at line ${baseIdx + j}`);
                break;
              }
            }
          }
        }

        if (totals.debug.taxLine && totals.debug.subtotalLine) break;
      }

      return totals;
    }
  }

  // SECOND PASS: Try other total patterns if TOTAL USD not found
  for (let i = scanLines.length - 1; i >= 0; i--) {
    const line = scanLines[i];

    // Skip employee/dept subtotals AND lines containing "SUBTOTAL"
    if (isGroupSubtotal(line) || isDeptSubtotal(line) || /SUBTOTAL/i.test(line)) continue;

    for (const pattern of totalPatterns) {
      const match = line.match(pattern);
      if (match) {
        totals.totalCents = parseMoney(match[1]);
        totals.debug.totalLine = baseIdx + i;
        console.log(`[CINTAS TOTALS] Found TOTAL (fallback): $${(totals.totalCents/100).toFixed(2)} at line ${baseIdx + i}`);

        // Now look backwards for subtotal and tax
        for (let j = i - 1; j >= Math.max(0, i - 20); j--) {
          const prevLine = scanLines[j];

          if (!totals.debug.taxLine) {
            for (const taxPat of taxPatterns) {
              const taxMatch = prevLine.match(taxPat);
              if (taxMatch) {
                totals.taxCents = parseMoney(taxMatch[1]);
                totals.debug.taxLine = baseIdx + j;
                break;
              }
            }
          }

          if (!totals.debug.subtotalLine) {
            // Make sure we're not picking up a group subtotal
            if (!isGroupSubtotal(prevLine) && !isDeptSubtotal(prevLine)) {
              for (const subPat of subtotalPatterns) {
                const subMatch = prevLine.match(subPat);
                if (subMatch) {
                  totals.subtotalCents = parseMoney(subMatch[1]);
                  totals.debug.subtotalLine = baseIdx + j;
                  break;
                }
              }
            }
          }

          if (totals.debug.taxLine && totals.debug.subtotalLine) break;
        }

        return totals;
      }
    }
  }

  // Fallback: Look for stacked format "SUBTOTAL TAX TOTAL USD" on one line
  // followed by numbers on next line (columnar format common in PDFs)
  for (let i = scanLines.length - 1; i >= 1; i--) {
    const line = scanLines[i];
    const prevLine = scanLines[i - 1];

    // Match variations: "SUBTOTAL TAX TOTAL", "SUBTOTAL TAX TOTAL USD", "SUBTOTAL SALES TAX TOTAL USD"
    if (/SUBTOTAL\s+(?:SALES\s+)?TAX\s+TOTAL(?:\s+USD)?/i.test(prevLine)) {
      // Next line should have the numbers (all on same line)
      const numbers = line.match(/([\d,]+\.?\d*)/g);
      if (numbers && numbers.length >= 3) {
        totals.subtotalCents = parseMoney(numbers[0]);
        totals.taxCents = parseMoney(numbers[1]);
        totals.totalCents = parseMoney(numbers[2]);
        totals.debug.subtotalLine = baseIdx + i;
        totals.debug.taxLine = baseIdx + i;
        totals.debug.totalLine = baseIdx + i;
        console.log(`[CINTAS TOTALS] Found stacked format - Subtotal: $${(totals.subtotalCents/100).toFixed(2)}, Tax: $${(totals.taxCents/100).toFixed(2)}, Total: $${(totals.totalCents/100).toFixed(2)}`);
        return totals;
      }

      // ALTERNATIVE: Values might be on separate lines (PDF extraction splits them)
      // Header: "SUBTOTAL SALES TAX TOTAL USD"
      // Line 1: "1867.42" (subtotal)
      // Line 2: "130.72" (tax)
      // Line 3: "1998.14" (total)
      if (i + 3 < scanLines.length) {
        const line1 = scanLines[i].trim();
        const line2 = scanLines[i + 1]?.trim() || '';
        const line3 = scanLines[i + 2]?.trim() || '';

        // Each line should be just a number
        const num1Match = line1.match(/^([\d,]+\.?\d*)$/);
        const num2Match = line2.match(/^([\d,]+\.?\d*)$/);
        const num3Match = line3.match(/^([\d,]+\.?\d*)$/);

        if (num1Match && num2Match && num3Match) {
          totals.subtotalCents = parseMoney(num1Match[1]);
          totals.taxCents = parseMoney(num2Match[1]);
          totals.totalCents = parseMoney(num3Match[1]);
          totals.debug.subtotalLine = baseIdx + i;
          totals.debug.taxLine = baseIdx + i + 1;
          totals.debug.totalLine = baseIdx + i + 2;
          console.log(`[CINTAS TOTALS] Found stacked multi-line format - Subtotal: $${(totals.subtotalCents/100).toFixed(2)}, Tax: $${(totals.taxCents/100).toFixed(2)}, Total: $${(totals.totalCents/100).toFixed(2)}`);
          return totals;
        }
      }
    }
  }

  // ADDITIONAL FALLBACK: Look for labeled rows near bottom
  // Format: "SUBTOTAL 1867.42" then "SALES TAX 130.72" then "TOTAL USD 1998.14" (each on its own line)
  for (let i = scanLines.length - 1; i >= 0; i--) {
    const line = scanLines[i];

    // Skip group/dept subtotals
    if (isGroupSubtotal(line) || isDeptSubtotal(line)) continue;

    // Look for "TOTAL USD" with value (may have been split by PDF extraction)
    const totalUsdSpaced = line.match(/TOTAL\s+USD[\s:]*\$?([\d,]+\.?\d*)/i);
    if (totalUsdSpaced && parseMoney(totalUsdSpaced[1]) > 0) {
      totals.totalCents = parseMoney(totalUsdSpaced[1]);
      totals.debug.totalLine = baseIdx + i;
      console.log(`[CINTAS TOTALS] Found TOTAL USD (labeled row): $${(totals.totalCents/100).toFixed(2)}`);

      // Search backwards for subtotal and tax on their own lines
      for (let j = i - 1; j >= Math.max(0, i - 15); j--) {
        const prevLine = scanLines[j];
        if (isGroupSubtotal(prevLine) || isDeptSubtotal(prevLine)) continue;

        // SALES TAX pattern
        if (!totals.debug.taxLine) {
          const taxMatch = prevLine.match(/(?:SALES\s+)?TAX[\s:]*\$?([\d,]+\.?\d*)/i);
          if (taxMatch && parseMoney(taxMatch[1]) >= 0) {
            totals.taxCents = parseMoney(taxMatch[1]);
            totals.debug.taxLine = baseIdx + j;
          }
        }

        // SUBTOTAL pattern (not group subtotal)
        if (!totals.debug.subtotalLine && /^SUBTOTAL/i.test(prevLine.trim())) {
          const subMatch = prevLine.match(/SUBTOTAL[\s:]*\$?([\d,]+\.?\d*)/i);
          if (subMatch && parseMoney(subMatch[1]) > 0) {
            totals.subtotalCents = parseMoney(subMatch[1]);
            totals.debug.subtotalLine = baseIdx + j;
          }
        }
      }

      return totals;
    }
  }

  // Last resort: find the LARGEST subtotal near the bottom (likely the final one)
  let maxSubtotal = 0;
  for (let i = scanLines.length - 1; i >= 0; i--) {
    const line = scanLines[i];
    if (isGroupSubtotal(line) || isDeptSubtotal(line)) continue;

    const subMatch = line.match(/SUBTOTAL\s*([\d,]+\.?\d*)/i);
    if (subMatch) {
      const value = parseMoney(subMatch[1]);
      if (value > maxSubtotal) {
        maxSubtotal = value;
        totals.subtotalCents = value;
        totals.debug.subtotalLine = baseIdx + i;
      }
    }
  }

  // ===== FINAL SANITY CHECK: Use pre-scanned TOTAL USD if available =====
  // This ensures we never accidentally use SUBTOTAL as the total
  if (preScannedTotalUsd > 0) {
    // If totalCents is 0, use pre-scanned value
    if (totals.totalCents === 0) {
      console.log(`[CINTAS TOTALS] Using pre-scanned TOTAL USD: $${(preScannedTotalUsd/100).toFixed(2)} (no total found otherwise)`);
      totals.totalCents = preScannedTotalUsd;
    }
    // If totalCents equals subtotalCents, we likely picked SUBTOTAL - use pre-scanned instead
    else if (totals.totalCents === totals.subtotalCents && preScannedTotalUsd > totals.subtotalCents) {
      console.log(`[CINTAS TOTALS] Correcting: total ($${(totals.totalCents/100).toFixed(2)}) equals subtotal - using pre-scanned TOTAL USD: $${(preScannedTotalUsd/100).toFixed(2)}`);
      totals.totalCents = preScannedTotalUsd;
    }
    // If pre-scanned is larger and more than subtotal, it's likely the correct total
    else if (preScannedTotalUsd > totals.totalCents && preScannedTotalUsd > totals.subtotalCents) {
      console.log(`[CINTAS TOTALS] Correcting: found larger TOTAL USD: $${(preScannedTotalUsd/100).toFixed(2)} (was $${(totals.totalCents/100).toFixed(2)})`);
      totals.totalCents = preScannedTotalUsd;
    }
  }

  // =====================================================================
  // FINAL DIAGNOSTIC SUMMARY - Why did we pick this total?
  // =====================================================================
  console.log(`[CINTAS TOTALS] ========== EXTRACTION DECISION SUMMARY ==========`);
  console.log(`[CINTAS TOTALS] FINAL VALUES:`);
  console.log(`[CINTAS TOTALS]   Subtotal: $${(totals.subtotalCents/100).toFixed(2)}`);
  console.log(`[CINTAS TOTALS]   Tax:      $${(totals.taxCents/100).toFixed(2)}`);
  console.log(`[CINTAS TOTALS]   TOTAL:    $${(totals.totalCents/100).toFixed(2)} <-- THIS IS WHAT WE'RE RETURNING`);
  console.log(`[CINTAS TOTALS]   Method:   ${totals.debug.method || 'unknown'}`);

  // CRITICAL CHECK: Did we pick SUBTOTAL as TOTAL?
  if (totals.totalCents > 0 && totals.subtotalCents > 0) {
    if (totals.totalCents === totals.subtotalCents) {
      console.log(`[CINTAS TOTALS] ⚠️  WARNING: TOTAL equals SUBTOTAL! This might be wrong.`);
      console.log(`[CINTAS TOTALS]     Raw TOTAL USD matches found: ${diagnostics.rawMatches.totalUsd.length}`);
      if (diagnostics.rawMatches.totalUsd.length > 0) {
        const largestTotalUsd = Math.max(...diagnostics.rawMatches.totalUsd.map(m => m.value));
        if (largestTotalUsd > totals.totalCents) {
          console.log(`[CINTAS TOTALS] ⚠️  FOUND LARGER TOTAL USD: $${(largestTotalUsd/100).toFixed(2)} - CORRECTING!`);
          totals.totalCents = largestTotalUsd;
          totals.debug.method = 'diagnostic_correction';
        }
      }
    }
  }

  // Check if total < subtotal (definitely wrong)
  if (totals.totalCents > 0 && totals.subtotalCents > 0 && totals.totalCents < totals.subtotalCents) {
    console.log(`[CINTAS TOTALS] ⚠️  WARNING: TOTAL < SUBTOTAL! This is definitely wrong.`);
    // Look for larger total
    if (diagnostics.rawMatches.totalUsd.length > 0) {
      const largestTotalUsd = Math.max(...diagnostics.rawMatches.totalUsd.map(m => m.value));
      if (largestTotalUsd > totals.subtotalCents) {
        console.log(`[CINTAS TOTALS] ⚠️  FOUND CORRECT TOTAL USD: $${(largestTotalUsd/100).toFixed(2)} - CORRECTING!`);
        totals.totalCents = largestTotalUsd;
        totals.debug.method = 'diagnostic_correction_lt_subtotal';
      }
    }
  }

  // Store diagnostics for debugging
  totals.debug.diagnostics = diagnostics;

  // =====================================================================
  // NUCLEAR FAILSAFE: If we have ANY TOTAL USD matches and they're larger
  // than what we're returning, USE THEM. This catches all edge cases.
  // =====================================================================
  if (diagnostics.rawMatches.totalUsd.length > 0) {
    const largestTotalUsd = Math.max(...diagnostics.rawMatches.totalUsd.map(m => m.value));
    console.log(`[CINTAS TOTALS] NUCLEAR CHECK: Largest TOTAL USD found = $${(largestTotalUsd/100).toFixed(2)}, current total = $${(totals.totalCents/100).toFixed(2)}`);

    if (largestTotalUsd > totals.totalCents) {
      console.log(`[CINTAS TOTALS] ⚠️  NUCLEAR OVERRIDE: Using TOTAL USD $${(largestTotalUsd/100).toFixed(2)} instead of $${(totals.totalCents/100).toFixed(2)}`);
      totals.totalCents = largestTotalUsd;
      totals.debug.method = 'nuclear_total_usd_override';
    }
  }

  // FINAL LOG: What are we actually returning?
  console.log(`[CINTAS TOTALS] ========== FINAL RETURN VALUES ==========`);
  console.log(`[CINTAS TOTALS] >>> RETURNING TOTAL: $${(totals.totalCents/100).toFixed(2)} <<<`);
  console.log(`[CINTAS TOTALS] ========== END EXTRACTION ==========`);

  return totals;
}

/**
 * Extract employee information (for grouping/display purposes)
 */
function extractEmployees(text, lines) {
  const employees = [];
  const seenNames = new Set();

  // Pattern: "0001 JOHN DOE SUBTOTAL - 34.79" or "JOHN DOE SUBTOTAL - 34.79"
  const empSubtotalPattern = /(?:^|\n)\s*(?:\d{4}\s+)?([A-Z][A-Z ,.'\-]+?)\s+SUBTOTAL\s*-?\s*([\d,\.]+)/gim;

  let match;
  while ((match = empSubtotalPattern.exec(text)) !== null) {
    const name = match[1].trim();
    const subtotal = parseMoney(match[2]);

    // Filter out non-employee patterns
    const nameUpper = name.toUpperCase();
    if (nameUpper.includes('INVOICE') ||
        nameUpper.includes('DEPT') ||
        nameUpper.includes('CORPORATION') ||
        nameUpper.includes('INC') ||
        nameUpper.includes('LLC') ||
        nameUpper.length < 5 ||
        seenNames.has(nameUpper)) {
      continue;
    }

    seenNames.add(nameUpper);
    employees.push({
      name: name,
      subtotalCents: subtotal
    });
  }

  return employees;
}

/**
 * Extract additional fees/adjustments from Cintas invoice
 * Note: Many Cintas fees are captured as line items already
 * This catches any additional fees/credits not in the main table
 */
function extractCintasAdjustments(text, lines) {
  const adjustments = [];

  // Cintas-specific fee patterns (fees that might be outside the main table)
  const feePatterns = [
    { regex: /FUEL\s+SURCHARGE[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Fuel Surcharge' },
    { regex: /ENERGY\s+SURCHARGE[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Energy Surcharge' },
    { regex: /ROUTE\s+SERVICE\s+(?:FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Route Service Fee' },
    { regex: /STOP\s+CHARGE[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Stop Charge' },
    { regex: /DELIVERY\s+(?:FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Delivery Fee' },
    { regex: /MINIMUM\s+BILLING?[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Minimum Billing' },
    { regex: /LOST\s+(?:GARMENT|ITEM)\s+(?:FEE|CHARGE)?[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Lost Item Fee' },
    { regex: /DAMAGE\s+(?:FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Damage Fee' },
    { regex: /ENVIRONMENTAL\s+(?:FEE|SURCHARGE)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Environmental Fee' },
    { regex: /ADMIN(?:ISTRATION)?\s+(?:FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Admin Fee' },
  ];

  // Credit/discount patterns
  const creditPatterns = [
    { regex: /(?:VOLUME|LOYALTY)\s+DISCOUNT[:\s]*\$?([\d,]+\.?\d*)/i, type: 'credit', desc: 'Volume Discount' },
    { regex: /(?:CUSTOMER\s+)?CREDIT[:\s]*\-?\$?([\d,]+\.?\d*)/i, type: 'credit', desc: 'Credit' },
    { regex: /CONTRACT\s+(?:DISCOUNT|CREDIT)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'credit', desc: 'Contract Discount' },
    { regex: /PROMOTIONAL\s+(?:DISCOUNT|CREDIT)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'credit', desc: 'Promotional Credit' },
    { regex: /REBATE[:\s]*\$?([\d,]+\.?\d*)/i, type: 'credit', desc: 'Rebate' },
  ];

  // Search for fees
  for (const pattern of feePatterns) {
    const match = text.match(pattern.regex);
    if (match) {
      const value = parseMoney(match[1]);
      if (value > 0 && value < 50000) {
        adjustments.push({
          type: pattern.type,
          description: pattern.desc,
          amountCents: value,
          raw: match[0]
        });
        console.log(`[CINTAS ADJ] Found ${pattern.desc}: $${(value/100).toFixed(2)}`);
      }
    }
  }

  // Search for credits
  for (const pattern of creditPatterns) {
    const match = text.match(pattern.regex);
    if (match) {
      const value = parseMoney(match[1]);
      if (value > 0 && value < 100000) {
        adjustments.push({
          type: pattern.type,
          description: pattern.desc,
          amountCents: -value,  // Credits are negative
          raw: match[0]
        });
        console.log(`[CINTAS ADJ] Found ${pattern.desc}: -$${(value/100).toFixed(2)} (credit)`);
      }
    }
  }

  // Calculate net adjustments
  const totalAdjustmentsCents = adjustments.reduce((sum, adj) => sum + adj.amountCents, 0);

  console.log(`[CINTAS ADJ] Total adjustments: ${adjustments.length} items, net: $${(totalAdjustmentsCents/100).toFixed(2)}`);

  return {
    adjustments,
    totalAdjustmentsCents
  };
}

/**
 * Main Cintas parser function
 */
function parseCintasInvoice(normalizedText, options = {}) {
  const lines = normalizedText.split('\n');

  // Extract totals and adjustments
  let totals = extractTotals(normalizedText, lines);
  const miscCharges = extractCintasAdjustments(normalizedText, lines);

  // Add adjustments to totals
  totals.adjustmentsCents = miscCharges.totalAdjustmentsCents;
  totals.adjustments = miscCharges.adjustments;

  // CRITICAL: Validate totals using core extraction
  // This ensures we get TOTAL USD instead of SUBTOTAL
  console.log(`[CINTAS PARSER] Validating totals with core extractor...`);
  totals = validateParserTotals(totals, normalizedText, 'cintas');

  const result = {
    vendorKey: 'cintas',
    parserVersion: '2.2.0',  // Bumped for adjustments support
    header: parseHeader(normalizedText, lines),
    totals: totals,
    lineItems: [],
    adjustments: miscCharges.adjustments,
    employees: extractEmployees(normalizedText, lines),
    departments: [],
    debug: {
      tableRegions: [],
      parseAttempts: [],
      rawLineCount: lines.length,
      adjustmentsFound: miscCharges.adjustments.length,
      netAdjustmentsCents: miscCharges.totalAdjustmentsCents
    }
  };

  // Find and parse table regions
  const tableRegions = findTableRegions(lines);
  result.debug.tableRegions = tableRegions.map(r => ({
    startLine: r.startLine,
    endLine: r.endLine,
    lineCount: r.lines.length
  }));

  // Parse line items from table regions
  const seenItems = new Set();  // Dedup by raw line

  for (const region of tableRegions) {
    let continuationBuffer = '';

    for (const { text: line, index } of region.lines) {
      // Skip empty lines
      if (!line.trim()) continue;

      // Skip group/dept subtotals (these are NOT line items)
      if (isGroupSubtotal(line) || isDeptSubtotal(line)) {
        continuationBuffer = '';
        continue;
      }

      // Check if this line is a continuation of previous (no tax flag at end)
      const hasTaxFlag = /\s+[YN]\s*$/i.test(line);
      const hasNumbers = /\d+\.?\d*\s*[YN]?\s*$/i.test(line);

      if (!hasTaxFlag && !hasNumbers && continuationBuffer) {
        // Continuation line - append to buffer
        continuationBuffer += ' ' + line.trim();
        continue;
      }

      // Try to parse the line (with any continuation buffer)
      const fullLine = continuationBuffer ? continuationBuffer + ' ' + line : line;
      const item = parseItemRow(fullLine);

      if (item && !seenItems.has(item.raw)) {
        seenItems.add(item.raw);
        result.lineItems.push({
          ...item,
          sourceLineIndex: index
        });
      }

      // Reset buffer if we successfully parsed or if line looks complete
      if (item || hasTaxFlag) {
        continuationBuffer = '';
      } else if (line.match(/^[A-Z]/)) {
        // New description starting - save as continuation buffer
        continuationBuffer = line;
      }
    }
  }

  // Also scan for fee/program lines that might be outside table regions
  const feePatterns = [
    /^\s*(UNIFORM\s+ADVANTAGE)\s+([\d,]+\.?\d*)\s*([YN])\s*$/gim,
    /^\s*(EMBLEM\s+ADVANTAGE)\s+([\d,]+\.?\d*)\s*([YN])\s*$/gim,
    /^\s*(PREP\s+ADVANTAGE)\s+([\d,]+\.?\d*)\s*([YN])\s*$/gim,
    /^\s*(INVENTORY\s+MANAGEMENT)\s+([\d,]+\.?\d*)\s*([YN])\s*$/gim,
    /^\s*(SERVICE\s+CHARGE)\s+([\d,]+\.?\d*)\s*([YN])\s*$/gim,
    /^\s*(ENERGY\s+SURCHARGE)\s+([\d,]+\.?\d*)\s*([YN])\s*$/gim
  ];

  for (const pattern of feePatterns) {
    let match;
    while ((match = pattern.exec(normalizedText)) !== null) {
      const description = match[1].trim();
      const amount = parseMoney(match[2]);
      const taxFlag = match[3].toUpperCase();

      // Check if already captured
      const exists = result.lineItems.some(item =>
        item.description.toUpperCase().includes(description.toUpperCase()) &&
        item.lineTotalCents === amount
      );

      if (!exists) {
        result.lineItems.push({
          type: 'fee',
          sku: null,
          description: description,
          qty: 1,
          unitPriceCents: amount,
          lineTotalCents: amount,
          taxFlag: taxFlag,
          employeeId: null,
          raw: match[0]
        });
      }
    }
  }

  // Post-processing: validate and fix line items
  result.lineItems = validateAndFixLineItems(result.lineItems);

  // Update parser version and add debug info
  result.parserVersion = '2.1.0';
  result.debug.mathCorrectedItems = result.lineItems.filter(i => i.mathCorrected).length;

  // Calculate confidence score
  result.confidence = calculateCintasConfidence(result.lineItems, result.totals);

  return result;
}

/**
 * Calculate confidence score for Cintas parse
 */
function calculateCintasConfidence(lineItems, totals) {
  let score = 50;
  const issues = [];
  const warnings = [];

  if (lineItems.length === 0) {
    score -= 30;
    issues.push('No line items extracted');
  } else {
    score += Math.min(20, lineItems.length * 2);
  }

  if (totals.totalCents > 0) {
    score += 15;
  } else {
    issues.push('No invoice total found');
  }

  if (lineItems.length > 0 && totals.totalCents > 0) {
    const itemsSum = lineItems.reduce((sum, item) => sum + (item.lineTotalCents || 0), 0);
    const diff = Math.abs(totals.totalCents - itemsSum);
    const pctDiff = totals.totalCents > 0 ? diff / totals.totalCents : 1;

    if (pctDiff <= 0.01) {
      score += 15;
    } else if (pctDiff <= 0.05) {
      score += 10;
    } else if (pctDiff <= 0.15) {
      score += 5;
      warnings.push(`Line items sum differs from total by ${(pctDiff * 100).toFixed(1)}%`);
    } else {
      warnings.push(`Significant difference: items sum $${(itemsSum/100).toFixed(2)} vs total $${(totals.totalCents/100).toFixed(2)}`);
    }
  }

  // Check math validation status
  const mathValidatedCount = lineItems.filter(item => item.mathValidated).length;
  const mathCorrectedCount = lineItems.filter(item => item.mathCorrected).length;

  if (lineItems.length > 0) {
    const validationRate = mathValidatedCount / lineItems.length;
    if (validationRate >= 0.9) {
      score += 10;
    } else if (validationRate < 0.5) {
      score -= 5;
      warnings.push(`Only ${Math.round(validationRate * 100)}% of items passed math validation`);
    }

    if (mathCorrectedCount > 0) {
      warnings.push(`${mathCorrectedCount} items had quantities auto-corrected`);
    }
  }

  return {
    score: Math.min(100, Math.max(0, score)),
    issues: issues,
    warnings: warnings
  };
}

module.exports = {
  parseCintasInvoice,
  parseHeader,
  findTableRegions,
  parseItemRow,
  extractTotals,
  extractCintasAdjustments,
  extractEmployees,
  calculateCintasConfidence
};
