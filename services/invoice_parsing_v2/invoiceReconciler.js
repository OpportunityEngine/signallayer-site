/**
 * Invoice Reconciler
 *
 * Cross-validates extracted invoice data:
 * - Line items sum should match subtotal
 * - Subtotal + tax should match total
 * - Individual line items: qty × price = extended
 * - Detects and reports discrepancies
 */

/**
 * Tolerance settings for reconciliation
 */
const TOLERANCES = {
  // Cents tolerance for individual line items
  lineItemCents: 5,
  // Cents tolerance for totals
  totalsCents: 100,
  // Percentage tolerance for sum vs subtotal
  sumVsSubtotalPercent: 0.02,  // 2%
  // Percentage tolerance for total validation
  totalValidationPercent: 0.01  // 1%
};

/**
 * Validate a single line item's math
 * @param {Object} item - Line item
 * @returns {Object} Validation result
 */
function validateLineItem(item) {
  const result = {
    valid: true,
    issues: [],
    suggested: {}
  };

  const qty = item.qty || item.quantity || 1;
  const unitPrice = item.unitPriceCents || 0;
  const lineTotal = item.lineTotalCents || 0;

  // Check qty × price = total
  const computed = qty * unitPrice;
  const diff = Math.abs(computed - lineTotal);

  if (diff > TOLERANCES.lineItemCents) {
    result.valid = false;
    result.issues.push({
      type: 'math_mismatch',
      message: `${qty} × $${(unitPrice/100).toFixed(2)} = $${(computed/100).toFixed(2)} ≠ $${(lineTotal/100).toFixed(2)}`,
      diff: diff,
      computed: computed,
      actual: lineTotal
    });

    // Suggest corrections
    if (unitPrice > 0 && lineTotal > 0) {
      const suggestedQty = Math.round(lineTotal / unitPrice);
      if (suggestedQty >= 1 && suggestedQty <= 999) {
        const suggestedDiff = Math.abs(suggestedQty * unitPrice - lineTotal);
        if (suggestedDiff <= TOLERANCES.lineItemCents) {
          result.suggested.qty = suggestedQty;
        }
      }

      const suggestedUnitPrice = Math.round(lineTotal / qty);
      if (suggestedUnitPrice > 0) {
        const suggestedDiff = Math.abs(qty * suggestedUnitPrice - lineTotal);
        if (suggestedDiff <= TOLERANCES.lineItemCents) {
          result.suggested.unitPriceCents = suggestedUnitPrice;
        }
      }
    }
  }

  // Check for suspicious values
  if (qty > 100) {
    result.issues.push({
      type: 'suspicious_qty',
      message: `Quantity ${qty} seems unusually high`,
      value: qty
    });
  }

  if (unitPrice > 1000000) {  // > $10,000
    result.issues.push({
      type: 'suspicious_price',
      message: `Unit price $${(unitPrice/100).toFixed(2)} seems unusually high`,
      value: unitPrice
    });
  }

  if (lineTotal === 0 && qty > 0) {
    result.issues.push({
      type: 'zero_total',
      message: 'Line total is zero',
      value: lineTotal
    });
  }

  return result;
}

/**
 * Reconcile line items against totals
 * @param {Array} lineItems - Array of line items
 * @param {Object} totals - Extracted totals
 * @returns {Object} Reconciliation result
 */
function reconcileInvoice(lineItems, totals) {
  const result = {
    valid: true,
    lineItemsValid: true,
    totalsValid: true,
    issues: [],
    warnings: [],
    computed: {},
    corrections: []
  };

  // Validate each line item
  const lineItemResults = lineItems.map((item, idx) => ({
    index: idx,
    item,
    validation: validateLineItem(item)
  }));

  const invalidItems = lineItemResults.filter(r => !r.validation.valid);
  if (invalidItems.length > 0) {
    result.lineItemsValid = false;
    result.issues.push({
      type: 'line_item_errors',
      message: `${invalidItems.length} line items have math errors`,
      items: invalidItems.map(r => ({
        index: r.index,
        description: r.item.description?.slice(0, 50),
        issues: r.validation.issues
      }))
    });

    // Add suggested corrections
    for (const r of invalidItems) {
      if (Object.keys(r.validation.suggested).length > 0) {
        result.corrections.push({
          index: r.index,
          description: r.item.description?.slice(0, 50),
          original: {
            qty: r.item.qty || r.item.quantity,
            unitPriceCents: r.item.unitPriceCents
          },
          suggested: r.validation.suggested
        });
      }
    }
  }

  // Calculate sum of line items
  const sumOfItems = lineItems.reduce((sum, item) => sum + (item.lineTotalCents || 0), 0);
  result.computed.sumOfItemsCents = sumOfItems;

  // Compare to subtotal
  if (totals.subtotalCents > 0) {
    const diff = Math.abs(sumOfItems - totals.subtotalCents);
    const pctDiff = totals.subtotalCents > 0 ? diff / totals.subtotalCents : 0;

    result.computed.sumVsSubtotalDiff = diff;
    result.computed.sumVsSubtotalPct = pctDiff;

    if (pctDiff > TOLERANCES.sumVsSubtotalPercent) {
      result.warnings.push({
        type: 'sum_subtotal_mismatch',
        message: `Line items sum ($${(sumOfItems/100).toFixed(2)}) differs from subtotal ($${(totals.subtotalCents/100).toFixed(2)}) by ${(pctDiff * 100).toFixed(1)}%`,
        computed: sumOfItems,
        expected: totals.subtotalCents,
        diff
      });
    }
  }

  // Validate subtotal + tax = total
  if (totals.totalCents > 0 && totals.subtotalCents > 0) {
    const computedTotal = totals.subtotalCents + (totals.taxCents || 0);
    const diff = Math.abs(computedTotal - totals.totalCents);
    const pctDiff = totals.totalCents > 0 ? diff / totals.totalCents : 0;

    result.computed.subtotalPlusTax = computedTotal;
    result.computed.totalDiff = diff;

    if (pctDiff > TOLERANCES.totalValidationPercent) {
      result.totalsValid = false;
      result.issues.push({
        type: 'total_mismatch',
        message: `Subtotal ($${(totals.subtotalCents/100).toFixed(2)}) + Tax ($${((totals.taxCents || 0)/100).toFixed(2)}) = $${(computedTotal/100).toFixed(2)} ≠ Total ($${(totals.totalCents/100).toFixed(2)})`,
        computed: computedTotal,
        expected: totals.totalCents,
        diff
      });
    }
  }

  // Check if sum of items matches total (when no subtotal)
  if (totals.totalCents > 0 && !totals.subtotalCents) {
    const diff = Math.abs(sumOfItems - totals.totalCents);
    const pctDiff = totals.totalCents > 0 ? diff / totals.totalCents : 0;

    if (pctDiff > TOLERANCES.sumVsSubtotalPercent) {
      result.warnings.push({
        type: 'sum_total_mismatch',
        message: `Line items sum ($${(sumOfItems/100).toFixed(2)}) differs from total ($${(totals.totalCents/100).toFixed(2)}) by ${(pctDiff * 100).toFixed(1)}%`,
        computed: sumOfItems,
        expected: totals.totalCents,
        diff
      });
    }
  }

  // Overall validity
  result.valid = result.lineItemsValid && result.totalsValid && result.issues.length === 0;

  return result;
}

/**
 * Calculate confidence score based on reconciliation
 * @param {Object} reconciliation - Reconciliation result
 * @returns {number} Confidence adjustment (-50 to +30)
 */
function getConfidenceAdjustment(reconciliation) {
  let adjustment = 0;

  if (reconciliation.valid) {
    adjustment += 20;
  }

  if (reconciliation.lineItemsValid) {
    adjustment += 10;
  } else {
    adjustment -= 20;
  }

  if (reconciliation.totalsValid) {
    adjustment += 10;
  } else {
    adjustment -= 15;
  }

  // Penalize for warnings
  adjustment -= Math.min(15, reconciliation.warnings.length * 5);

  return Math.max(-50, Math.min(30, adjustment));
}

/**
 * Auto-fix line items based on reconciliation suggestions
 * @param {Array} lineItems - Original line items
 * @param {Object} reconciliation - Reconciliation result
 * @returns {Object} Fixed items and changelog
 */
function applyCorrections(lineItems, reconciliation) {
  const fixedItems = JSON.parse(JSON.stringify(lineItems));  // Deep clone
  const changelog = [];

  for (const correction of reconciliation.corrections) {
    const item = fixedItems[correction.index];
    if (!item) continue;

    if (correction.suggested.qty !== undefined) {
      const oldQty = item.qty || item.quantity;
      item.qty = correction.suggested.qty;
      item.quantity = correction.suggested.qty;
      item.mathCorrected = true;
      item.originalQty = oldQty;

      changelog.push({
        index: correction.index,
        field: 'qty',
        from: oldQty,
        to: correction.suggested.qty,
        description: correction.description
      });
    }

    if (correction.suggested.unitPriceCents !== undefined) {
      const oldPrice = item.unitPriceCents;
      item.unitPriceCents = correction.suggested.unitPriceCents;
      item.mathCorrected = true;
      item.originalUnitPriceCents = oldPrice;

      changelog.push({
        index: correction.index,
        field: 'unitPriceCents',
        from: oldPrice,
        to: correction.suggested.unitPriceCents,
        description: correction.description
      });
    }
  }

  return {
    items: fixedItems,
    changelog,
    fixedCount: changelog.length
  };
}

/**
 * Generate a summary report of the invoice
 * @param {Object} parseResult - Full parse result
 * @returns {Object} Summary report
 */
function generateInvoiceSummary(parseResult) {
  const lineItems = parseResult.lineItems || [];
  const totals = parseResult.totals || {};

  const itemCount = lineItems.length;
  const sumOfItems = lineItems.reduce((sum, item) => sum + (item.lineTotalCents || 0), 0);

  const categories = {};
  for (const item of lineItems) {
    const cat = item.category || 'uncategorized';
    if (!categories[cat]) {
      categories[cat] = { count: 0, totalCents: 0 };
    }
    categories[cat].count++;
    categories[cat].totalCents += item.lineTotalCents || 0;
  }

  return {
    vendor: parseResult.vendorName || parseResult.vendorKey,
    invoiceNumber: parseResult.invoiceNumber,
    invoiceDate: parseResult.invoiceDate,

    itemCount,
    sumOfItemsCents: sumOfItems,
    sumOfItemsFormatted: `$${(sumOfItems / 100).toFixed(2)}`,

    subtotalCents: totals.subtotalCents || 0,
    subtotalFormatted: `$${((totals.subtotalCents || 0) / 100).toFixed(2)}`,

    taxCents: totals.taxCents || 0,
    taxFormatted: `$${((totals.taxCents || 0) / 100).toFixed(2)}`,

    totalCents: totals.totalCents || 0,
    totalFormatted: `$${((totals.totalCents || 0) / 100).toFixed(2)}`,

    categories: Object.entries(categories).map(([name, data]) => ({
      name,
      count: data.count,
      totalCents: data.totalCents,
      totalFormatted: `$${(data.totalCents / 100).toFixed(2)}`
    })),

    confidence: parseResult.confidence?.score || 0,
    parserVersion: parseResult.parserVersion
  };
}

/**
 * Full reconciliation pipeline
 * @param {Object} parseResult - Parse result to reconcile
 * @param {Object} options - Options
 * @returns {Object} Reconciled result
 */
function fullReconciliation(parseResult, options = {}) {
  const { autoFix = true } = options;

  const lineItems = parseResult.lineItems || [];
  const totals = parseResult.totals || {};

  // Run reconciliation
  const reconciliation = reconcileInvoice(lineItems, totals);

  // Apply corrections if enabled
  let finalItems = lineItems;
  let changelog = [];

  if (autoFix && reconciliation.corrections.length > 0) {
    const fixed = applyCorrections(lineItems, reconciliation);
    finalItems = fixed.items;
    changelog = fixed.changelog;

    // Re-run reconciliation to verify fixes
    reconciliation.postFixValidation = reconcileInvoice(finalItems, totals);
  }

  // Calculate confidence adjustment
  const confidenceAdjustment = getConfidenceAdjustment(reconciliation);

  // Generate summary
  const summary = generateInvoiceSummary({
    ...parseResult,
    lineItems: finalItems
  });

  return {
    reconciliation,
    finalItems,
    changelog,
    confidenceAdjustment,
    summary,
    isValid: reconciliation.valid || (reconciliation.postFixValidation?.valid ?? false)
  };
}

module.exports = {
  validateLineItem,
  reconcileInvoice,
  getConfidenceAdjustment,
  applyCorrections,
  generateInvoiceSummary,
  fullReconciliation,
  TOLERANCES
};
