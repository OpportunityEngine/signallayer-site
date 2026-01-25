/**
 * Invoice Reconciler
 *
 * Cross-validates extracted invoice data:
 * - Line items sum should match subtotal
 * - Subtotal + tax should match total
 * - Individual line items: qty × price = extended
 * - Detects and reports discrepancies
 * - Salvage mode: re-attempts parsing when reconciliation fails
 */

const { extractTotalCandidates, findReconcilableTotal } = require('./totalsCandidates');
const { extractAdjustments, calculateAdjustmentsSummary } = require('./adjustmentsExtractor');

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

/**
 * CRITICAL: Reconcile with printed total priority
 * This ensures the PRINTED invoice total always wins over computed totals.
 * If there's a mismatch, we create a synthetic adjustment to explain the delta.
 *
 * @param {Object} parseResult - Parse result from parser
 * @param {string} rawText - Original invoice text (for additional extraction if needed)
 * @param {Object} options - Options
 * @returns {Object} - Reconciled result with printed_total_cents, computed_total_cents, and any synthetic adjustments
 */
function reconcileWithPrintedTotalPriority(parseResult, rawText, options = {}) {
  const lineItems = parseResult.lineItems || [];
  const totals = parseResult.totals || {};
  const adjustments = parseResult.adjustments || [];

  // Step 1: Calculate computed total (sum of line items + adjustments)
  const lineItemsSum = lineItems.reduce((sum, item) => sum + (item.lineTotalCents || 0), 0);
  const adjustmentsSum = adjustments.reduce((sum, adj) => sum + (adj.amountCents || 0), 0);
  const computedTotalCents = lineItemsSum + adjustmentsSum;

  // Step 2: Get printed total from parser's extracted totals
  // The parser should have found INVOICE TOTAL from the document
  const printedTotalCents = totals.totalCents || 0;

  // Step 3: Calculate delta
  const deltaCents = printedTotalCents - computedTotalCents;
  const absDelta = Math.abs(deltaCents);

  // Step 4: Create result object with canonical fields
  const result = {
    printed_total_cents: printedTotalCents,
    computed_total_cents: computedTotalCents,
    line_items_sum_cents: lineItemsSum,
    adjustments_sum_cents: adjustmentsSum,
    reconciliation: {
      delta_cents: deltaCents,
      tolerance_ok: absDelta <= TOLERANCES.totalsCents,
      reason: null,
      warnings: []
    },
    adjustments: [...adjustments],  // Copy existing adjustments
    synthetic_adjustment: null
  };

  // Step 5: Determine reconciliation status
  if (printedTotalCents === 0) {
    result.reconciliation.reason = 'No printed total found - using computed total';
    result.reconciliation.warnings.push('PRINTED_TOTAL_MISSING');
    // Use computed as fallback
    result.printed_total_cents = computedTotalCents;
  } else if (adjustmentsSum !== 0 && Math.abs(printedTotalCents - lineItemsSum) <= TOLERANCES.totalsCents) {
    // SPECIAL CASE: Printed total equals line items sum but we have adjustments
    // This means the parser found a subtotal, not the true invoice total
    // The true total should include adjustments
    result.reconciliation.reason = 'Printed total appears to be subtotal - adding adjustments to get true total';
    result.reconciliation.warnings.push('SUBTOTAL_DETECTED_AS_TOTAL');
    result.printed_total_cents = computedTotalCents;  // Use computed (items + adjustments)
    console.log(`[RECONCILE] Subtotal detected: printed $${(printedTotalCents/100).toFixed(2)} == items $${(lineItemsSum/100).toFixed(2)}, but have $${(adjustmentsSum/100).toFixed(2)} in adjustments. Using computed total: $${(computedTotalCents/100).toFixed(2)}`);
  } else if (absDelta === 0) {
    result.reconciliation.reason = 'Exact match between printed and computed totals';
    result.reconciliation.tolerance_ok = true;
  } else if (absDelta <= TOLERANCES.totalsCents) {
    result.reconciliation.reason = `Within tolerance (${absDelta} cents difference)`;
    result.reconciliation.tolerance_ok = true;
  } else {
    // Step 6: MISMATCH - Create synthetic adjustment
    const pctDelta = printedTotalCents > 0 ? absDelta / printedTotalCents : 0;

    // Only create synthetic if delta is reasonable (< 20% of total)
    if (pctDelta < 0.20) {
      // Determine type based on whether delta is positive (missing charge) or negative (missing credit)
      const syntheticType = deltaCents > 0 ? 'inferred_tax_or_fee' : 'inferred_credit';
      const syntheticLabel = deltaCents > 0
        ? 'Inferred Tax/Fee (from printed total)'
        : 'Inferred Credit (from printed total)';

      result.synthetic_adjustment = {
        type: syntheticType,
        description: syntheticLabel,
        amountCents: deltaCents,
        isSynthetic: true,
        evidence: `AUTO: printed_total ($${(printedTotalCents/100).toFixed(2)}) - computed_total ($${(computedTotalCents/100).toFixed(2)}) = $${(deltaCents/100).toFixed(2)}`,
        note: 'Auto-generated to reconcile printed invoice total with computed total'
      };

      // Add synthetic to adjustments list
      result.adjustments.push(result.synthetic_adjustment);

      // Update computed total to match printed (after synthetic)
      result.computed_total_cents = printedTotalCents;
      result.reconciliation.reason = `Created synthetic adjustment of $${(deltaCents/100).toFixed(2)} to match printed total`;
      result.reconciliation.tolerance_ok = true;

      console.log(`[RECONCILE] Created synthetic adjustment: $${(deltaCents/100).toFixed(2)} (${(pctDelta * 100).toFixed(1)}% of printed total)`);
    } else {
      // Delta too large - don't create synthetic, just warn
      result.reconciliation.reason = `Large mismatch: printed $${(printedTotalCents/100).toFixed(2)} vs computed $${(computedTotalCents/100).toFixed(2)} (${(pctDelta * 100).toFixed(1)}%)`;
      result.reconciliation.tolerance_ok = false;
      result.reconciliation.warnings.push('LARGE_DELTA_NOT_RECONCILED');

      console.warn(`[RECONCILE] WARNING: Large delta of ${(pctDelta * 100).toFixed(1)}% - not creating synthetic adjustment`);
    }
  }

  return result;
}

/**
 * Get the authoritative invoice total (printed total wins, with sanity checks)
 * This is the value that should be stored in invoice_total_cents
 *
 * @param {Object} reconcileResult - Result from reconcileWithPrintedTotalPriority
 * @returns {number} - The authoritative total in cents
 */
function getAuthoritativeTotalCents(reconcileResult) {
  const printedTotal = reconcileResult.printed_total_cents || 0;
  const computedTotal = reconcileResult.computed_total_cents || 0;

  // SANITY CHECK 1: Minimum reasonable invoice total is $10.00 (1000 cents)
  // Anything less is almost certainly a parsing error (like picking up "PAGE 1" as "$1.00")
  const MIN_REASONABLE_TOTAL = 1000;  // $10.00

  // SANITY CHECK 2: If printed total is less than 5% of computed total, something is wrong
  // Use computed total instead (which is sum of line items - more reliable)
  const MISMATCH_THRESHOLD = 0.05;  // 5%

  // If printed total is suspiciously low
  if (printedTotal < MIN_REASONABLE_TOTAL) {
    if (computedTotal >= MIN_REASONABLE_TOTAL) {
      console.log(`[AUTHORITATIVE TOTAL] Printed total ($${(printedTotal/100).toFixed(2)}) below minimum - using computed ($${(computedTotal/100).toFixed(2)})`);
      return computedTotal;
    }
    // Both are low - return printed anyway (might be a small invoice)
    return printedTotal;
  }

  // If printed total is vastly smaller than computed (likely a parsing error)
  if (computedTotal > MIN_REASONABLE_TOTAL && printedTotal < computedTotal * MISMATCH_THRESHOLD) {
    console.log(`[AUTHORITATIVE TOTAL] Printed total ($${(printedTotal/100).toFixed(2)}) is <5% of computed ($${(computedTotal/100).toFixed(2)}) - using computed`);
    return computedTotal;
  }

  // Normal case: use printed total
  return printedTotal;
}

/**
 * Salvage mode - triggered when reconciliation fails
 * Re-attempts to find correct totals and adjustments
 * @param {Object} parseResult - Parse result that failed reconciliation
 * @param {string} rawText - Original invoice text
 * @param {Object} options - Options
 * @returns {Object} Salvage result with potential fixes
 */
function attemptSalvage(parseResult, rawText, options = {}) {
  const salvageResult = {
    attempted: true,
    success: false,
    reason: null,
    changes: [],
    originalTotals: { ...parseResult.totals },
    newTotals: null,
    adjustments: null
  };

  const lineItems = parseResult.lineItems || [];
  const itemsSum = lineItems.reduce((sum, item) => sum + (item.lineTotalCents || 0), 0);

  if (itemsSum === 0) {
    salvageResult.reason = 'No line items to reconcile';
    return salvageResult;
  }

  // Step 1: Extract all total candidates
  const totalCandidates = extractTotalCandidates(rawText, options.layoutHints);

  // Step 2: Extract adjustments (tax, fees, discounts)
  const adjustmentsResult = extractAdjustments(rawText, options.layoutHints);
  const adjustmentsSum = adjustmentsResult.summary.netAdjustmentsCents;
  salvageResult.adjustments = adjustmentsResult;

  // Step 3: Try to find a total that reconciles with items + adjustments
  const reconcilableTotal = findReconcilableTotal(
    totalCandidates.candidates,
    itemsSum,
    adjustmentsSum,
    TOLERANCES.sumVsSubtotalPercent
  );

  if (reconcilableTotal && reconcilableTotal.reconciliation.variancePct <= 5) {
    salvageResult.success = true;
    salvageResult.reason = `Found reconcilable total: ${reconcilableTotal.label}`;

    // Build new totals object
    salvageResult.newTotals = {
      subtotalCents: itemsSum,
      taxCents: adjustmentsResult.summary.taxCents,
      feesCents: adjustmentsResult.summary.feesCents,
      discountsCents: adjustmentsResult.summary.discountsCents,
      shippingCents: adjustmentsResult.summary.shippingCents,
      totalCents: reconcilableTotal.valueCents,
      currency: parseResult.totals?.currency || 'USD',
      salvaged: true,
      originalTotalCents: parseResult.totals?.totalCents
    };

    salvageResult.changes.push({
      field: 'totals',
      reason: `Total updated from ${reconcilableTotal.reconciliation.actualTotal} to match ${reconcilableTotal.label}`,
      from: parseResult.totals?.totalCents,
      to: reconcilableTotal.valueCents
    });

    // Check if we found better adjustments
    if (adjustmentsResult.summary.taxCents !== (parseResult.totals?.taxCents || 0)) {
      salvageResult.changes.push({
        field: 'taxCents',
        reason: 'Updated tax from adjustments extraction',
        from: parseResult.totals?.taxCents,
        to: adjustmentsResult.summary.taxCents
      });
    }

    return salvageResult;
  }

  // Step 4: If no exact reconciliation, try alternative strategies
  // Strategy A: Look for subtotal that matches items sum
  const subtotalMatch = totalCandidates.candidates.find(c =>
    c.label.includes('SUBTOTAL') &&
    Math.abs(c.valueCents - itemsSum) <= itemsSum * TOLERANCES.sumVsSubtotalPercent
  );

  if (subtotalMatch) {
    // Found a matching subtotal, look for total that's subtotal + adjustments
    const expectedTotal = subtotalMatch.valueCents + adjustmentsSum;
    const totalMatch = totalCandidates.candidates.find(c =>
      !c.label.includes('SUBTOTAL') &&
      Math.abs(c.valueCents - expectedTotal) <= expectedTotal * 0.02
    );

    if (totalMatch) {
      salvageResult.success = true;
      salvageResult.reason = 'Found subtotal + adjustments = total pattern';
      salvageResult.newTotals = {
        subtotalCents: subtotalMatch.valueCents,
        taxCents: adjustmentsResult.summary.taxCents,
        totalCents: totalMatch.valueCents,
        currency: parseResult.totals?.currency || 'USD',
        salvaged: true
      };
      return salvageResult;
    }
  }

  // Strategy B: If total is way off, it might be a group total - find the real one
  if (parseResult.totals?.totalCents > 0) {
    const currentTotalDiff = Math.abs(itemsSum - parseResult.totals.totalCents);
    const currentTotalPct = currentTotalDiff / parseResult.totals.totalCents;

    // If current total is > 50% different, it's probably wrong
    if (currentTotalPct > 0.5) {
      // Look for a total closer to items sum
      const betterTotal = totalCandidates.candidates.find(c =>
        !c.isGroupTotal &&
        c.valueCents !== parseResult.totals.totalCents &&
        Math.abs(c.valueCents - itemsSum) < currentTotalDiff
      );

      if (betterTotal) {
        salvageResult.success = true;
        salvageResult.reason = `Replaced suspected group total with ${betterTotal.label}`;
        salvageResult.newTotals = {
          subtotalCents: itemsSum,
          taxCents: adjustmentsResult.summary.taxCents,
          totalCents: betterTotal.valueCents,
          currency: parseResult.totals?.currency || 'USD',
          salvaged: true,
          originalWasSuspectedGroupTotal: true
        };
        return salvageResult;
      }
    }
  }

  // Salvage failed
  salvageResult.reason = 'Could not find reconcilable totals';
  salvageResult.candidatesConsidered = totalCandidates.candidates.length;
  salvageResult.itemsSum = itemsSum;
  salvageResult.adjustmentsSum = adjustmentsSum;

  return salvageResult;
}

/**
 * Enhanced reconciliation with salvage mode
 * @param {Object} parseResult - Parse result to reconcile
 * @param {string} rawText - Original invoice text (for salvage mode)
 * @param {Object} options - Options
 * @returns {Object} Reconciled result
 */
function reconcileWithSalvage(parseResult, rawText, options = {}) {
  const { autoFix = true, enableSalvage = true, salvageThreshold = 0.10 } = options;

  // First, run standard reconciliation
  const standardResult = fullReconciliation(parseResult, { autoFix });

  // Check if salvage is needed
  const needsSalvage = !standardResult.isValid ||
    (standardResult.reconciliation.computed.sumVsSubtotalPct > salvageThreshold);

  if (!needsSalvage || !enableSalvage || !rawText) {
    return {
      ...standardResult,
      salvageAttempted: false
    };
  }

  // Attempt salvage
  const salvageResult = attemptSalvage(parseResult, rawText, options);

  if (!salvageResult.success) {
    return {
      ...standardResult,
      salvageAttempted: true,
      salvageSuccess: false,
      salvageReason: salvageResult.reason
    };
  }

  // Apply salvage results and re-reconcile
  const salvagedParseResult = {
    ...parseResult,
    totals: salvageResult.newTotals
  };

  const postSalvageResult = fullReconciliation(salvagedParseResult, { autoFix });

  return {
    ...postSalvageResult,
    salvageAttempted: true,
    salvageSuccess: true,
    salvageChanges: salvageResult.changes,
    salvageAdjustments: salvageResult.adjustments,
    preSalvageTotals: salvageResult.originalTotals,
    confidenceAdjustment: postSalvageResult.confidenceAdjustment - 5 // Small penalty for needing salvage
  };
}

/**
 * Quick check if reconciliation might fail
 * Useful for deciding whether to try alternative parsers
 * @param {Array} lineItems
 * @param {Object} totals
 * @returns {Object} Quick check result
 */
function quickReconcileCheck(lineItems, totals) {
  if (!lineItems || lineItems.length === 0) {
    return { likely: false, reason: 'No line items' };
  }

  const sum = lineItems.reduce((s, item) => s + (item.lineTotalCents || 0), 0);
  const total = totals?.totalCents || 0;
  const subtotal = totals?.subtotalCents || 0;

  // Check against subtotal if available, otherwise total
  const compareValue = subtotal > 0 ? subtotal : total;
  if (compareValue === 0) {
    return { likely: false, reason: 'No totals to compare' };
  }

  const diff = Math.abs(sum - compareValue);
  const pct = diff / compareValue;

  return {
    likely: pct <= 0.05,
    itemsSum: sum,
    compareValue,
    difference: diff,
    percentDiff: pct * 100,
    reason: pct <= 0.05 ? 'Items sum matches totals' : `${(pct * 100).toFixed(1)}% difference`
  };
}

module.exports = {
  validateLineItem,
  reconcileInvoice,
  getConfidenceAdjustment,
  applyCorrections,
  generateInvoiceSummary,
  fullReconciliation,
  attemptSalvage,
  reconcileWithSalvage,
  quickReconcileCheck,
  reconcileWithPrintedTotalPriority,
  getAuthoritativeTotalCents,
  TOLERANCES
};
