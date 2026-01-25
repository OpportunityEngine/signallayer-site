/**
 * Invoice Parsing V2 - Validation System
 * Validates parsed invoice data and calculates confidence scores
 *
 * Scoring weights (accounting-based):
 * - Printed total match: 35 points (highest weight)
 * - Line items sum reconciliation: 25 points
 * - Adjustments (tax/fees) validation: 15 points
 * - Header completeness: 10 points
 * - Line item quality: 15 points
 *
 * Penalties:
 * - Group subtotal contamination: -25 points
 * - Missing total: -30 points
 * - Large variance: -20 points
 * - Garbage items detected: -15 points
 */

const { nearlyEqual, parseMoney } = require('./utils');
const { extractTotalCandidates } = require('./totalsCandidates');
const { extractAdjustments } = require('./adjustmentsExtractor');

/**
 * Scoring weights for different validation aspects
 */
const SCORING_WEIGHTS = {
  printedTotalMatch: 35,      // Highest priority - does printed total make sense?
  itemsSumReconcile: 25,      // Do line items sum to subtotal/total?
  adjustmentsValid: 15,       // Are tax/fees extracted and valid?
  headerComplete: 10,         // Invoice number, date, vendor present?
  lineItemQuality: 15,        // Individual item math valid?
};

/**
 * Penalty values for issues
 */
const PENALTIES = {
  missingTotal: 30,
  missingSubtotal: 10,
  groupSubtotalContamination: 25,
  largeVariance: 20,
  garbageItemsDetected: 15,
  missingInvoiceNumber: 5,
  missingCustomerName: 5,
  mathErrorsInItems: 10,
  suspiciousValues: 5
};

/**
 * Validate parsed invoice result with accounting-based scoring
 * @param {Object} result - Parsed invoice result
 * @param {string} rawText - Optional raw text for additional validation
 * @returns {{ score: number, issues: string[], warnings: string[], isValid: boolean, breakdown: Object }}
 */
function validateInvoiceParse(result, rawText = null) {
  const issues = [];
  const warnings = [];
  const breakdown = {
    printedTotalScore: 0,
    itemsSumScore: 0,
    adjustmentsScore: 0,
    headerScore: 0,
    lineItemQualityScore: 0,
    totalPenalties: 0,
    details: {}
  };

  let score = 0;

  // === 1. PRINTED TOTAL VALIDATION (35 points max) ===
  const totalValidation = validatePrintedTotal(result, rawText);
  breakdown.printedTotalScore = totalValidation.score;
  breakdown.details.totalValidation = totalValidation;
  score += totalValidation.score;

  if (totalValidation.issues.length > 0) {
    issues.push(...totalValidation.issues);
  }
  if (totalValidation.warnings.length > 0) {
    warnings.push(...totalValidation.warnings);
  }

  // === 2. LINE ITEMS SUM RECONCILIATION (25 points max) ===
  const sumValidation = validateItemsSum(result);
  breakdown.itemsSumScore = sumValidation.score;
  breakdown.details.sumValidation = sumValidation;
  score += sumValidation.score;

  if (sumValidation.issues.length > 0) {
    issues.push(...sumValidation.issues);
  }
  if (sumValidation.warnings.length > 0) {
    warnings.push(...sumValidation.warnings);
  }

  // === 3. ADJUSTMENTS VALIDATION (15 points max) ===
  const adjustmentsValidation = validateAdjustments(result, rawText);
  breakdown.adjustmentsScore = adjustmentsValidation.score;
  breakdown.details.adjustmentsValidation = adjustmentsValidation;
  score += adjustmentsValidation.score;

  if (adjustmentsValidation.warnings.length > 0) {
    warnings.push(...adjustmentsValidation.warnings);
  }

  // === 4. HEADER COMPLETENESS (10 points max) ===
  const headerValidation = validateHeader(result);
  breakdown.headerScore = headerValidation.score;
  breakdown.details.headerValidation = headerValidation;
  score += headerValidation.score;

  if (headerValidation.warnings.length > 0) {
    warnings.push(...headerValidation.warnings);
  }

  // === 5. LINE ITEM QUALITY (15 points max) ===
  const itemQuality = validateLineItemQuality(result);
  breakdown.lineItemQualityScore = itemQuality.score;
  breakdown.details.itemQuality = itemQuality;
  score += itemQuality.score;

  if (itemQuality.issues.length > 0) {
    issues.push(...itemQuality.issues);
  }
  if (itemQuality.warnings.length > 0) {
    warnings.push(...itemQuality.warnings);
  }

  // === PENALTY: Group subtotal contamination ===
  const contamination = checkGroupSubtotalContamination(result);
  if (contamination.detected) {
    const penalty = Math.min(PENALTIES.groupSubtotalContamination, contamination.count * 8);
    breakdown.totalPenalties += penalty;
    score -= penalty;
    issues.push(`group_subtotal_contamination: ${contamination.count} items appear to be group subtotals`);
    breakdown.details.contamination = contamination;
  }

  // === PENALTY: Garbage items ===
  const garbageCheck = checkGarbageItems(result);
  if (garbageCheck.detected) {
    breakdown.totalPenalties += PENALTIES.garbageItemsDetected;
    score -= PENALTIES.garbageItemsDetected;
    warnings.push(`garbage_items_detected: ${garbageCheck.count} items may be garbage/headers`);
    breakdown.details.garbageCheck = garbageCheck;
  }

  // Ensure score stays in bounds
  score = Math.max(0, Math.min(100, score));

  return {
    score,
    issues,
    warnings,
    isValid: score >= 60 && issues.filter(i =>
      !i.startsWith('subtotal_mismatch_under') &&
      !i.includes('small_variance')
    ).length === 0,
    breakdown
  };
}

/**
 * Validate printed total makes sense
 */
function validatePrintedTotal(result, rawText) {
  const validation = {
    score: 0,
    issues: [],
    warnings: [],
    printedTotal: result.totals?.totalCents || 0,
    alternativeTotals: []
  };

  const maxScore = SCORING_WEIGHTS.printedTotalMatch;

  // No total at all
  if (!result.totals || result.totals.totalCents === 0) {
    validation.issues.push('missing_total: No invoice total found');
    return validation;
  }

  const total = result.totals.totalCents;
  const subtotal = result.totals.subtotalCents || 0;
  const tax = result.totals.taxCents || 0;

  // Check if total = subtotal + tax (basic accounting equation)
  if (subtotal > 0) {
    const computed = subtotal + tax;
    const diff = Math.abs(computed - total);
    const pct = total > 0 ? diff / total : 1;

    if (pct <= 0.01) {
      // Perfect match
      validation.score = maxScore;
    } else if (pct <= 0.05) {
      // Close enough (might have fees not captured)
      validation.score = maxScore - 5;
      validation.warnings.push(`total_slight_variance: ${(pct * 100).toFixed(1)}% difference`);
    } else if (pct <= 0.15) {
      // Notable variance
      validation.score = maxScore - 15;
      validation.issues.push(`total_variance: subtotal + tax = $${(computed/100).toFixed(2)}, printed total = $${(total/100).toFixed(2)}`);
    } else {
      // Large variance - something is wrong
      validation.score = 5;
      validation.issues.push(`total_large_variance: ${(pct * 100).toFixed(1)}% difference suggests wrong total captured`);
    }
  } else {
    // No subtotal, give partial credit if total exists
    validation.score = maxScore - 10;
    validation.warnings.push('missing_subtotal: Cannot verify total equation');
  }

  // If we have raw text, check for better total candidates
  if (rawText) {
    const candidates = extractTotalCandidates(rawText);
    if (candidates.candidates.length > 1) {
      validation.alternativeTotals = candidates.candidates.slice(0, 3).map(c => ({
        label: c.label,
        valueCents: c.valueCents,
        score: c.score
      }));

      // Check if a better candidate exists that matches items sum better
      const itemsSum = (result.lineItems || []).reduce((s, i) => s + (i.lineTotalCents || 0), 0);
      const betterCandidate = candidates.candidates.find(c =>
        c.valueCents !== total &&
        c.score > 70 &&
        Math.abs(c.valueCents - itemsSum) < Math.abs(total - itemsSum)
      );

      if (betterCandidate) {
        validation.warnings.push(`possible_better_total: ${betterCandidate.label} ($${(betterCandidate.valueCents/100).toFixed(2)}) may be more accurate`);
        validation.score = Math.max(0, validation.score - 10);
      }
    }
  }

  return validation;
}

/**
 * Validate items sum reconciliation
 */
function validateItemsSum(result) {
  const validation = {
    score: 0,
    issues: [],
    warnings: [],
    itemsSum: 0,
    itemCount: 0
  };

  const maxScore = SCORING_WEIGHTS.itemsSumReconcile;
  const lineItems = result.lineItems || [];

  if (lineItems.length === 0) {
    validation.warnings.push('no_line_items: No line items extracted');
    return validation;
  }

  validation.itemCount = lineItems.length;
  validation.itemsSum = lineItems.reduce((sum, item) => sum + (item.lineTotalCents || 0), 0);

  // Compare against subtotal or total
  const compareValue = result.totals?.subtotalCents || result.totals?.totalCents || 0;

  if (compareValue === 0) {
    validation.score = maxScore - 15;
    validation.warnings.push('no_comparison_value: Cannot compare items sum to totals');
    return validation;
  }

  const diff = Math.abs(validation.itemsSum - compareValue);
  const pct = diff / compareValue;

  if (pct <= 0.01) {
    validation.score = maxScore;
  } else if (pct <= 0.05) {
    validation.score = maxScore - 5;
    validation.warnings.push(`items_sum_small_variance: ${(pct * 100).toFixed(1)}% difference`);
  } else if (pct <= 0.15) {
    validation.score = maxScore - 15;
    validation.issues.push(`items_sum_mismatch: Sum ($${(validation.itemsSum/100).toFixed(2)}) vs expected ($${(compareValue/100).toFixed(2)})`);
  } else {
    validation.score = 0;
    validation.issues.push(`items_sum_large_mismatch: ${(pct * 100).toFixed(1)}% variance`);
  }

  return validation;
}

/**
 * Validate adjustments (tax, fees, etc.)
 */
function validateAdjustments(result, rawText) {
  const validation = {
    score: 0,
    warnings: [],
    extractedTax: result.totals?.taxCents || 0,
    hasTax: false
  };

  const maxScore = SCORING_WEIGHTS.adjustmentsValid;

  // Check if tax is present and reasonable
  const tax = result.totals?.taxCents || 0;
  const subtotal = result.totals?.subtotalCents || 0;

  if (tax > 0) {
    validation.hasTax = true;

    // Check tax is reasonable (0.5% to 15% of subtotal)
    if (subtotal > 0) {
      const taxRate = tax / subtotal;
      if (taxRate >= 0.005 && taxRate <= 0.15) {
        validation.score = maxScore;
      } else if (taxRate > 0.15) {
        validation.score = maxScore - 10;
        validation.warnings.push(`high_tax_rate: ${(taxRate * 100).toFixed(1)}% tax rate seems high`);
      } else {
        validation.score = maxScore - 5;
      }
    } else {
      validation.score = maxScore - 5;
    }
  } else {
    // No tax extracted - partial credit
    validation.score = maxScore - 8;
    validation.warnings.push('no_tax_extracted: Tax may be included in line items or missing');
  }

  // If we have raw text, verify adjustments
  if (rawText) {
    try {
      const extracted = extractAdjustments(rawText);
      if (extracted.summary.taxCents > 0 && Math.abs(extracted.summary.taxCents - tax) > 100) {
        validation.warnings.push(`tax_mismatch_detected: Parsed tax differs from re-extracted tax`);
        validation.score = Math.max(0, validation.score - 5);
      }
    } catch (e) {
      // Ignore extraction errors
    }
  }

  return validation;
}

/**
 * Validate header completeness
 */
function validateHeader(result) {
  const validation = {
    score: 0,
    warnings: [],
    hasInvoiceNumber: false,
    hasDate: false,
    hasVendor: false,
    hasCustomer: false
  };

  const maxScore = SCORING_WEIGHTS.headerComplete;
  let fieldsPresent = 0;
  const totalFields = 4;

  // Invoice number
  if (result.invoiceNumber || result.header?.invoiceNumber) {
    validation.hasInvoiceNumber = true;
    fieldsPresent++;
  } else {
    validation.warnings.push('missing_invoice_number');
  }

  // Date
  if (result.invoiceDate || result.header?.invoiceDate) {
    validation.hasDate = true;
    fieldsPresent++;
  } else {
    validation.warnings.push('missing_invoice_date');
  }

  // Vendor
  if (result.vendorName || result.vendorKey !== 'generic') {
    validation.hasVendor = true;
    fieldsPresent++;
  } else {
    validation.warnings.push('unidentified_vendor');
  }

  // Customer
  if (result.customerName || result.header?.customerName) {
    validation.hasCustomer = true;
    fieldsPresent++;
  } else {
    validation.warnings.push('missing_customer_name');
  }

  validation.score = Math.round((fieldsPresent / totalFields) * maxScore);

  return validation;
}

/**
 * Validate individual line item quality
 */
function validateLineItemQuality(result) {
  const validation = {
    score: 0,
    issues: [],
    warnings: [],
    validItems: 0,
    invalidItems: 0,
    totalItems: 0
  };

  const maxScore = SCORING_WEIGHTS.lineItemQuality;
  const lineItems = result.lineItems || [];

  if (lineItems.length === 0) {
    return validation;
  }

  validation.totalItems = lineItems.length;

  for (const item of lineItems) {
    const qty = item.qty || item.quantity || 1;
    const unitPrice = item.unitPriceCents || 0;
    const lineTotal = item.lineTotalCents || 0;

    // Check qty × price = total
    const computed = qty * unitPrice;
    const diff = Math.abs(computed - lineTotal);

    if (diff <= 5 || (lineTotal > 0 && diff / lineTotal <= 0.01)) {
      validation.validItems++;
    } else {
      validation.invalidItems++;
    }
  }

  const validRate = validation.validItems / validation.totalItems;

  if (validRate >= 0.9) {
    validation.score = maxScore;
  } else if (validRate >= 0.7) {
    validation.score = maxScore - 5;
    validation.warnings.push(`some_items_invalid_math: ${validation.invalidItems} items have math errors`);
  } else if (validRate >= 0.5) {
    validation.score = maxScore - 10;
    validation.issues.push(`many_items_invalid_math: ${validation.invalidItems}/${validation.totalItems} items have math errors`);
  } else {
    validation.score = 0;
    validation.issues.push(`most_items_invalid: Only ${(validRate * 100).toFixed(0)}% of items have valid math`);
  }

  return validation;
}

/**
 * Check for group subtotal contamination
 */
function checkGroupSubtotalContamination(result) {
  const lineItems = result.lineItems || [];
  const contaminated = [];

  for (let i = 0; i < lineItems.length; i++) {
    const item = lineItems[i];
    const desc = (item.description || '').toUpperCase();

    // Patterns that indicate group subtotals
    const isContaminated =
      /\bSUBTOTAL\b/.test(desc) ||
      /\bGROUP\s*TOTAL\b/.test(desc) ||
      /\bDEPT\s*TOTAL\b/.test(desc) ||
      /\bCATEGORY\s*TOTAL\b/.test(desc) ||
      /^\d{4}\s+[A-Z]+\s+[A-Z]+$/.test(desc) || // Employee name patterns
      /\bTOTAL\s+FOR\b/.test(desc);

    if (isContaminated) {
      contaminated.push({
        index: i,
        description: item.description?.slice(0, 50),
        amount: item.lineTotalCents
      });
    }
  }

  return {
    detected: contaminated.length > 0,
    count: contaminated.length,
    items: contaminated
  };
}

/**
 * Check for garbage items (headers, footers, notes captured as items)
 */
function checkGarbageItems(result) {
  const lineItems = result.lineItems || [];
  const garbage = [];

  // Maximum reasonable line item price for restaurant supplies: $20,000
  const MAX_REASONABLE_LINE_ITEM_CENTS = 2000000;

  for (let i = 0; i < lineItems.length; i++) {
    const item = lineItems[i];
    const desc = (item.description || '').trim();
    const lineTotal = item.lineTotalCents || 0;
    const unitPrice = item.unitPriceCents || 0;

    // Patterns that indicate garbage
    const isGarbage =
      desc.length < 3 ||
      /^[*\-=_]+$/.test(desc) ||
      /^PAGE\s*\d+/i.test(desc) ||
      /^CONTINUED/i.test(desc) ||
      /^SEE\s+ATTACHED/i.test(desc) ||
      /^NOTES?:/i.test(desc) ||
      /ORDER\s+SUMMARY/i.test(desc) ||
      /CHGS\s+FOR.*ORDER/i.test(desc) ||
      /CHGS\s+FOR\s+FUEL/i.test(desc) ||
      /FUEL\s+SURCHARGE/i.test(desc) ||
      /MISC\s+CHARGES/i.test(desc) ||
      /ALLOWANCE\s+FOR/i.test(desc) ||
      /DROP\s+SIZE/i.test(desc) ||
      (item.lineTotalCents === 0 && item.unitPriceCents === 0);

    // Check for absurdly high prices (likely order numbers misread as prices)
    const hasSuspiciouslyHighPrice =
      lineTotal > MAX_REASONABLE_LINE_ITEM_CENTS ||
      unitPrice > MAX_REASONABLE_LINE_ITEM_CENTS;

    if (isGarbage) {
      garbage.push({
        index: i,
        description: desc.slice(0, 50),
        reason: 'likely_garbage'
      });
    } else if (hasSuspiciouslyHighPrice) {
      garbage.push({
        index: i,
        description: desc.slice(0, 50),
        lineTotal: lineTotal,
        unitPrice: unitPrice,
        reason: 'absurdly_high_price'
      });
    }
  }

  return {
    detected: garbage.length > 0,
    count: garbage.length,
    items: garbage
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

  // CRITICAL: Give bonus to vendor-specific parsers
  // Generic parser is a fallback - vendor-specific should win if they have reasonable totals
  validated.forEach(v => {
    const vendorKey = v.result.vendorKey;
    const hasTotal = (v.result.totals?.totalCents || 0) > 0;

    // Vendor-specific parser bonus (if they found a total)
    if (hasTotal && vendorKey && vendorKey !== 'generic') {
      // Add 10-point bonus for vendor-specific parsers with valid totals
      // This ensures Cintas parser beats generic when both find the total
      v.validation.score = Math.min(100, v.validation.score + 10);
      console.log(`[CHOOSE BEST] Bonus +10 for vendor-specific parser: ${vendorKey} (new score: ${v.validation.score})`);
    }
  });

  // Sort by score descending
  validated.sort((a, b) => b.validation.score - a.validation.score);

  // Log decision
  console.log(`[CHOOSE BEST] Selected: ${validated[0].result.vendorKey} (score: ${validated[0].validation.score})`);
  if (validated.length > 1) {
    console.log(`[CHOOSE BEST] Alternatives: ${validated.slice(1).map(v => `${v.result.vendorKey}(${v.validation.score})`).join(', ')}`);
  }

  // Return best
  return {
    ...validated[0].result,
    confidence: validated[0].validation,
    alternatives: validated.slice(1).map(v => ({
      score: v.validation.score,
      issues: v.validation.issues,
      vendorKey: v.result.vendorKey,
      parserVersion: v.result.parserVersion
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
    taxCents: result.totals?.taxCents || 0,
    lineItemCount: result.lineItems?.length || 0,
    lineItemSum: (result.lineItems || []).reduce((sum, item) => sum + (item.lineTotalCents || 0), 0),
    vendorKey: result.vendorKey || 'unknown'
  };

  return JSON.stringify(data);
}

/**
 * Get detailed score breakdown for debugging
 */
function getScoreBreakdown(result, rawText = null) {
  const validation = validateInvoiceParse(result, rawText);

  return {
    totalScore: validation.score,
    isValid: validation.isValid,
    breakdown: {
      printedTotal: {
        score: validation.breakdown.printedTotalScore,
        maxPossible: SCORING_WEIGHTS.printedTotalMatch,
        details: validation.breakdown.details.totalValidation
      },
      itemsSum: {
        score: validation.breakdown.itemsSumScore,
        maxPossible: SCORING_WEIGHTS.itemsSumReconcile,
        details: validation.breakdown.details.sumValidation
      },
      adjustments: {
        score: validation.breakdown.adjustmentsScore,
        maxPossible: SCORING_WEIGHTS.adjustmentsValid,
        details: validation.breakdown.details.adjustmentsValidation
      },
      header: {
        score: validation.breakdown.headerScore,
        maxPossible: SCORING_WEIGHTS.headerComplete,
        details: validation.breakdown.details.headerValidation
      },
      lineItemQuality: {
        score: validation.breakdown.lineItemQualityScore,
        maxPossible: SCORING_WEIGHTS.lineItemQuality,
        details: validation.breakdown.details.itemQuality
      },
      penalties: {
        total: validation.breakdown.totalPenalties,
        contamination: validation.breakdown.details.contamination,
        garbage: validation.breakdown.details.garbageCheck
      }
    },
    issues: validation.issues,
    warnings: validation.warnings
  };
}

module.exports = {
  validateInvoiceParse,
  chooseBestParse,
  calculateParseChecksum,
  getScoreBreakdown,
  checkGroupSubtotalContamination,
  checkGarbageItems,
  SCORING_WEIGHTS,
  PENALTIES
};
