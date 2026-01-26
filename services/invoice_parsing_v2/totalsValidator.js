/**
 * Unified Totals Validator
 * This module ensures ALL parsers find the CORRECT invoice total
 * by applying consistent validation rules across Cintas, Sysco, and all vendors.
 *
 * RULES:
 * 1. INVOICE TOTAL always wins over SUBTOTAL
 * 2. TOTAL USD always wins over SUBTOTAL (Cintas)
 * 3. Never pick GROUP TOTAL over INVOICE TOTAL
 * 4. Total should be >= subtotal (basic math)
 */

const { parseMoney } = require('./utils');

/**
 * Find the TRUE invoice total from raw text
 * This is the SINGLE SOURCE OF TRUTH for totals
 *
 * @param {string} text - Raw invoice text
 * @returns {Object} - { totalCents, subtotalCents, taxCents, source }
 */
function findTrueInvoiceTotal(text) {
  if (!text) return { totalCents: 0, subtotalCents: 0, taxCents: 0, source: 'none' };

  const result = {
    totalCents: 0,
    subtotalCents: 0,
    taxCents: 0,
    source: null
  };

  // ============================================================
  // PRIORITY 1: EXPLICIT INVOICE TOTALS (highest priority)
  // These are the FINAL totals printed on invoices
  // ============================================================
  const invoiceTotalPatterns = [
    // Same-line patterns
    { regex: /INVOICE\s+TOTAL[\s:]*\$?([\d,]+\.?\d{0,2})/gi, name: 'INVOICE TOTAL', priority: 1 },
    { regex: /TOTAL\s+USD[\s:]*\$?([\d,]+\.?\d{0,2})/gi, name: 'TOTAL USD', priority: 1 },
    { regex: /GRAND\s+TOTAL[\s:]*\$?([\d,]+\.?\d{0,2})/gi, name: 'GRAND TOTAL', priority: 2 },
    { regex: /AMOUNT\s+DUE[\s:]*\$?([\d,]+\.?\d{0,2})/gi, name: 'AMOUNT DUE', priority: 2 },
    { regex: /BALANCE\s+DUE[\s:]*\$?([\d,]+\.?\d{0,2})/gi, name: 'BALANCE DUE', priority: 2 },
    { regex: /TOTAL\s+DUE[\s:]*\$?([\d,]+\.?\d{0,2})/gi, name: 'TOTAL DUE', priority: 3 },

    // Split-line patterns (label on one line, value on next)
    { regex: /INVOICE\s*\n\s*TOTAL[\s:]*\n?\s*\$?([\d,]+\.?\d{0,2})/gi, name: 'INVOICE TOTAL (split)', priority: 1 },
    { regex: /TOTAL\s+USD\s*\n\s*\$?([\d,]+\.?\d{0,2})/gi, name: 'TOTAL USD (split)', priority: 1 },
  ];

  // Track all candidates
  const candidates = [];

  for (const pattern of invoiceTotalPatterns) {
    const matches = [...text.matchAll(pattern.regex)];
    for (const match of matches) {
      const cents = parseMoney(match[1]);
      if (cents > 1000 && cents < 100000000) { // $10 to $1M range
        // Check context - reject if it's a GROUP TOTAL
        const contextStart = Math.max(0, match.index - 30);
        const context = text.substring(contextStart, match.index + match[0].length + 10).toUpperCase();
        if (/GROUP|CATEGORY|SECTION|DEPT|\*{3,}/.test(context) && !/INVOICE/.test(context)) {
          console.log(`[TOTALS VALIDATOR] Rejecting GROUP context: ${match[0].slice(0, 50)}`);
          continue;
        }

        candidates.push({
          cents,
          name: pattern.name,
          priority: pattern.priority,
          raw: match[0].trim()
        });
      }
    }
  }

  // Sort by priority (lower = better) then by value (higher = better for same priority)
  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.cents - a.cents; // Higher value wins for same priority
  });

  if (candidates.length > 0) {
    const best = candidates[0];
    result.totalCents = best.cents;
    result.source = best.name;
    console.log(`[TOTALS VALIDATOR] Found: $${(best.cents/100).toFixed(2)} via ${best.name}`);
  }

  // ============================================================
  // FIND SUBTOTAL (for validation)
  // ============================================================
  const subtotalPatterns = [
    /(?:^|\n)\s*SUBTOTAL[\s:]*\$?([\d,]+\.?\d{0,2})/gi,
    /(?:^|\n)\s*SUB[\s-]?TOTAL[\s:]*\$?([\d,]+\.?\d{0,2})/gi,
  ];

  for (const pattern of subtotalPatterns) {
    const matches = [...text.matchAll(pattern)];
    for (const match of matches) {
      const cents = parseMoney(match[1]);
      // Skip group subtotals
      const contextStart = Math.max(0, match.index - 30);
      const context = text.substring(contextStart, match.index).toUpperCase();
      if (/GROUP|CATEGORY|SECTION|DEPT|[A-Z]{2,}\s+[A-Z]{2,}\s+SUBTOTAL/.test(context)) {
        continue;
      }
      if (cents > result.subtotalCents && cents < 100000000) {
        result.subtotalCents = cents;
      }
    }
  }

  // ============================================================
  // FIND TAX
  // ============================================================
  const taxPatterns = [
    /SALES\s+TAX[\s:]*\$?([\d,]+\.?\d{0,2})/gi,
    /(?:^|\s)TAX[\s:]*\$?([\d,]+\.?\d{0,2})/gi,
  ];

  for (const pattern of taxPatterns) {
    const matches = [...text.matchAll(pattern)];
    for (const match of matches) {
      const cents = parseMoney(match[1]);
      if (cents > 0 && cents < 10000000) { // Tax shouldn't be more than $100k
        result.taxCents = cents;
        break;
      }
    }
  }

  return result;
}

/**
 * Validate and correct parser's totals against the true invoice total
 * This should be called by ALL parsers AFTER they extract totals
 *
 * @param {Object} parserTotals - Totals from the parser
 * @param {string} rawText - Raw invoice text
 * @param {string} vendorKey - Vendor key (cintas, sysco, etc.)
 * @returns {Object} - Validated/corrected totals
 */
function validateAndCorrectTotals(parserTotals, rawText, vendorKey = 'generic') {
  const corrected = { ...parserTotals };

  // Find the true invoice total from raw text
  const trueTotal = findTrueInvoiceTotal(rawText);

  console.log(`[TOTALS VALIDATOR] Parser total: $${((parserTotals.totalCents || 0)/100).toFixed(2)}, True total: $${(trueTotal.totalCents/100).toFixed(2)}`);

  // ============================================================
  // VALIDATION RULES
  // ============================================================

  // Rule 1: If parser found nothing but we found something, use ours
  if ((parserTotals.totalCents || 0) === 0 && trueTotal.totalCents > 0) {
    console.log(`[TOTALS VALIDATOR] Rule 1: Parser found nothing, using true total`);
    corrected.totalCents = trueTotal.totalCents;
    corrected.validatorCorrected = true;
    corrected.validatorSource = trueTotal.source;
  }

  // Rule 2: If parser's total equals subtotal and we found a different (larger) total, use ours
  else if (parserTotals.totalCents > 0 && parserTotals.subtotalCents > 0 &&
           parserTotals.totalCents === parserTotals.subtotalCents &&
           trueTotal.totalCents > parserTotals.totalCents) {
    console.log(`[TOTALS VALIDATOR] Rule 2: Parser total equals subtotal, using larger true total`);
    corrected.totalCents = trueTotal.totalCents;
    corrected.validatorCorrected = true;
    corrected.validatorSource = trueTotal.source;
    corrected.validatorReason = 'total_equals_subtotal';
  }

  // Rule 3: If parser's total is suspiciously low (less than subtotal), use ours
  else if (parserTotals.totalCents > 0 && parserTotals.subtotalCents > 0 &&
           parserTotals.totalCents < parserTotals.subtotalCents &&
           trueTotal.totalCents >= parserTotals.subtotalCents) {
    console.log(`[TOTALS VALIDATOR] Rule 3: Parser total < subtotal, using true total`);
    corrected.totalCents = trueTotal.totalCents;
    corrected.validatorCorrected = true;
    corrected.validatorSource = trueTotal.source;
    corrected.validatorReason = 'total_less_than_subtotal';
  }

  // Rule 4: For Cintas specifically - if we found TOTAL USD and it's larger, prefer it
  else if (vendorKey === 'cintas' &&
           trueTotal.source === 'TOTAL USD' &&
           trueTotal.totalCents > parserTotals.totalCents) {
    console.log(`[TOTALS VALIDATOR] Rule 4 (Cintas): Using TOTAL USD over parser total`);
    corrected.totalCents = trueTotal.totalCents;
    corrected.validatorCorrected = true;
    corrected.validatorSource = 'TOTAL USD';
    corrected.validatorReason = 'cintas_total_usd';
  }

  // Rule 5: For Sysco specifically - if we found INVOICE TOTAL and it's larger, prefer it
  else if (vendorKey === 'sysco' &&
           trueTotal.source && trueTotal.source.includes('INVOICE') &&
           trueTotal.totalCents > parserTotals.totalCents) {
    console.log(`[TOTALS VALIDATOR] Rule 5 (Sysco): Using INVOICE TOTAL over parser total`);
    corrected.totalCents = trueTotal.totalCents;
    corrected.validatorCorrected = true;
    corrected.validatorSource = 'INVOICE TOTAL';
    corrected.validatorReason = 'sysco_invoice_total';
  }

  // Update subtotal and tax if we found better values
  if (trueTotal.subtotalCents > 0 && (!corrected.subtotalCents || trueTotal.subtotalCents > corrected.subtotalCents)) {
    corrected.subtotalCents = trueTotal.subtotalCents;
  }
  if (trueTotal.taxCents > 0 && !corrected.taxCents) {
    corrected.taxCents = trueTotal.taxCents;
  }

  return corrected;
}

module.exports = {
  findTrueInvoiceTotal,
  validateAndCorrectTotals
};
