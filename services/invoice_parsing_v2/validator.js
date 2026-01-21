/**
 * Invoice Parsing V2 - Validation System
 * Validates parsed invoice data and calculates confidence scores
 */

const { nearlyEqual, parseMoney } = require('./utils');

/**
 * Validate parsed invoice result
 * @param {Object} result - Parsed invoice result
 * @returns {{ score: number, issues: string[], warnings: string[], isValid: boolean }}
 */
function validateInvoiceParse(result) {
  const issues = [];
  const warnings = [];
  let score = 100;

  // 1. Check totals exist
  if (!result.totals || result.totals.totalCents === 0) {
    issues.push('missing_total');
    score -= 30;
  }

  if (!result.totals || result.totals.subtotalCents === 0) {
    warnings.push('missing_subtotal');
    score -= 10;
  }

  // 2. Validate line items sum against subtotal
  if (result.lineItems && result.lineItems.length > 0 && result.totals?.subtotalCents > 0) {
    const sumLineTotals = result.lineItems.reduce((sum, item) => sum + (item.lineTotalCents || 0), 0);

    // Allow 1% tolerance or $1, whichever is greater
    const tolerance = Math.max(100, result.totals.subtotalCents * 0.01);

    if (Math.abs(sumLineTotals - result.totals.subtotalCents) > tolerance) {
      const diff = sumLineTotals - result.totals.subtotalCents;
      const diffDollars = (diff / 100).toFixed(2);

      if (sumLineTotals > result.totals.subtotalCents) {
        issues.push(`subtotal_mismatch_over: line items sum ($${(sumLineTotals/100).toFixed(2)}) exceeds subtotal ($${(result.totals.subtotalCents/100).toFixed(2)}) by $${diffDollars}`);
        // Likely included group subtotals as items
        warnings.push('possible_included_group_subtotals');
        score -= 25;
      } else {
        issues.push(`subtotal_mismatch_under: line items sum ($${(sumLineTotals/100).toFixed(2)}) is less than subtotal ($${(result.totals.subtotalCents/100).toFixed(2)}) by $${Math.abs(diffDollars)}`);
        // Likely missed some line items
        warnings.push('likely_missed_line_items');
        score -= 15;
      }
    }
  } else if (!result.lineItems || result.lineItems.length === 0) {
    warnings.push('no_line_items');
    score -= 20;
  }

  // 3. Validate subtotal + tax = total
  if (result.totals?.subtotalCents > 0 && result.totals?.totalCents > 0) {
    const expectedTotal = result.totals.subtotalCents + (result.totals.taxCents || 0);
    const tolerance = Math.max(100, result.totals.totalCents * 0.01);

    if (!nearlyEqual(expectedTotal, result.totals.totalCents, tolerance, 0.01)) {
      issues.push(`total_mismatch: subtotal ($${(result.totals.subtotalCents/100).toFixed(2)}) + tax ($${(result.totals.taxCents/100).toFixed(2)}) = $${(expectedTotal/100).toFixed(2)}, but total is $${(result.totals.totalCents/100).toFixed(2)}`);
      score -= 15;
    }
  }

  // 4. Check for header completeness
  if (!result.header?.invoiceNumber) {
    warnings.push('missing_invoice_number');
    score -= 5;
  }

  if (!result.header?.customerName) {
    warnings.push('missing_customer_name');
    score -= 5;
  }

  // 5. Check for employee subtotals mistakenly included as line items
  if (result.lineItems) {
    const possibleGroupSubtotals = result.lineItems.filter(item =>
      /SUBTOTAL/i.test(item.description) ||
      /^\d{4}\s+[A-Z]+\s+[A-Z]+$/i.test(item.description)
    );

    if (possibleGroupSubtotals.length > 0) {
      issues.push(`included_group_subtotals: ${possibleGroupSubtotals.length} items look like employee/dept subtotals`);
      score -= 20;
    }
  }

  // 6. Sanity checks
  if (result.totals?.totalCents > 0 && result.totals.totalCents < 100) {
    warnings.push('very_small_total');  // Total less than $1
  }

  if (result.totals?.totalCents > 10000000) {  // $100,000+
    warnings.push('very_large_total');
  }

  if (result.lineItems?.length > 500) {
    warnings.push('many_line_items');
  }

  // Ensure score stays in bounds
  score = Math.max(0, Math.min(100, score));

  return {
    score,
    issues,
    warnings,
    isValid: score >= 60 && issues.filter(i => !i.startsWith('subtotal_mismatch_under')).length === 0
  };
}

/**
 * Choose the best parse result from multiple attempts
 * @param {Object[]} candidates - Array of parse results
 * @returns {Object} - Best result with validation info
 */
function chooseBestParse(candidates) {
  if (!candidates || candidates.length === 0) {
    return null;
  }

  // Validate all candidates
  const validated = candidates.map(candidate => ({
    result: candidate,
    validation: validateInvoiceParse(candidate)
  }));

  // Sort by score descending
  validated.sort((a, b) => b.validation.score - a.validation.score);

  // Return best
  return {
    ...validated[0].result,
    confidence: validated[0].validation,
    alternatives: validated.slice(1).map(v => ({
      score: v.validation.score,
      issues: v.validation.issues
    }))
  };
}

/**
 * Calculate a simple checksum for the parsed data
 * Useful for detecting changes in reparsing
 */
function calculateParseChecksum(result) {
  const data = {
    totalCents: result.totals?.totalCents || 0,
    subtotalCents: result.totals?.subtotalCents || 0,
    lineItemCount: result.lineItems?.length || 0,
    lineItemSum: (result.lineItems || []).reduce((sum, item) => sum + (item.lineTotalCents || 0), 0)
  };

  return JSON.stringify(data);
}

module.exports = {
  validateInvoiceParse,
  chooseBestParse,
  calculateParseChecksum
};
