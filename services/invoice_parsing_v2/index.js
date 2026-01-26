/**
 * Invoice Parsing V2 - Main Entry Point
 * Modular, vendor-aware invoice parsing with validation
 *
 * Usage:
 *   const { parseInvoiceText } = require('./services/invoice_parsing_v2');
 *   const result = parseInvoiceText(rawText);
 *
 * Features:
 * - Automatic vendor detection
 * - Vendor-specific parsers (Cintas, Sysco, etc.)
 * - Generic fallback parser
 * - Validation and scoring
 * - Multi-pass parsing with best result selection
 */

const { normalizeInvoiceText, splitIntoPages, removeRepeatedHeadersFooters, parseMoney } = require('./utils');
const { detectVendor } = require('./vendorDetector');
const { parseCintasInvoice } = require('./parsers/cintasParser');
const { parseSyscoInvoice } = require('./parsers/syscoParser');
const { parseUSFoodsInvoice } = require('./parsers/usFoodsParser');
const { parseGenericInvoice } = require('./genericParser');
const { parseInvoiceEnhanced } = require('./enhancedParser');
const { parseAdaptive } = require('./adaptiveParser');
const { validateInvoiceParse, chooseBestParse, calculateParseChecksum } = require('./validator');
const { validateAndFixLineItems } = require('./numberClassifier');
const { analyzeTextQuality, cleanText, mergeMultiLineItems } = require('./textQuality');
const { analyzeLayout, generateParsingHints } = require('./layoutAnalyzer');
const { fullReconciliation, generateInvoiceSummary, reconcileWithSalvage, attemptSalvage, reconcileWithPrintedTotalPriority, getAuthoritativeTotalCents } = require('./invoiceReconciler');
const { storePattern, findPatterns, getRecommendation } = require('./patternStore');
const { extractTotalCandidates, findReconcilableTotal, validateTotalsEquation } = require('./totalsCandidates');
const { extractAdjustments, calculateAdjustmentsSummary, extractTax } = require('./adjustmentsExtractor');
const { isLayoutExtractionAvailable, extractWithLayout, getLayoutQuality } = require('./pdfLayoutExtractor');
const { detectUOM, enhanceLineItemWithUOM, PRODUCT_CATEGORY_HINTS } = require('./unitOfMeasure');

/**
 * Main parsing function
 * @param {string} rawText - Raw extracted text from PDF
 * @param {Object} options - Parsing options
 * @param {string} options.vendorHint - Hint for vendor (bypasses detection)
 * @param {boolean} options.strict - Use strict parsing only (no fallback)
 * @param {boolean} options.debug - Include debug information
 * @returns {Object} - Parsed invoice result with validation
 */
function parseInvoiceText(rawText, options = {}) {
  const startTime = Date.now();

  // Step 1: Normalize text
  const normalizedText = normalizeInvoiceText(rawText);
  const pages = splitIntoPages(normalizedText);
  const cleanedPages = removeRepeatedHeadersFooters(pages);
  let fullText = cleanedPages.join('\n\n');

  // Step 1.5: Analyze text quality and clean if needed
  const textQuality = analyzeTextQuality(fullText);
  if (textQuality.quality === 'poor' && options.aggressiveClean !== false) {
    const cleaned = cleanText(fullText, { aggressive: true });
    fullText = cleaned.text;
  }

  // Step 1.6: Merge multi-line items if OCR split them
  const lines = fullText.split('\n');
  const mergedLines = mergeMultiLineItems(lines);
  fullText = mergedLines.join('\n');

  // Step 2: Detect vendor
  const vendorInfo = options.vendorHint
    ? { vendorKey: options.vendorHint, vendorName: options.vendorHint, confidence: 100 }
    : detectVendor(fullText);

  // Log vendor detection for debugging
  console.log(`[PARSER V2] Vendor detection: ${vendorInfo.vendorName} (${vendorInfo.confidence}% confidence, key: ${vendorInfo.vendorKey})`);

  // Step 2.5: Check pattern store for recommendations
  let patternRecommendation = null;
  if (vendorInfo.vendorKey === 'generic' || vendorInfo.confidence < 70) {
    try {
      patternRecommendation = getRecommendation(fullText);
      if (patternRecommendation.hasRecommendation && patternRecommendation.confidence > vendorInfo.confidence) {
        console.log(`[PARSER V2] Pattern store suggests: ${patternRecommendation.vendor} (confidence: ${patternRecommendation.confidence})`);
      }
    } catch (err) {
      // Pattern store is optional, don't fail if it errors
    }
  }

  // Step 3: Run vendor-specific parser
  const candidates = [];

  if (vendorInfo.vendorKey === 'cintas') {
    // Run Cintas parser
    const cintasResult = parseCintasInvoice(fullText, options);
    cintasResult.vendorDetection = vendorInfo;
    candidates.push(cintasResult);

    // Also run generic as fallback comparison
    if (!options.strict) {
      const genericResult = parseGenericInvoice(fullText, options);
      genericResult.vendorDetection = { ...vendorInfo, note: 'fallback' };
      candidates.push(genericResult);

      // Run enhanced parser too
      try {
        const enhancedResult = parseInvoiceEnhanced(fullText, { vendor: 'cintas' });
        enhancedResult.vendorDetection = { ...vendorInfo, note: 'enhanced' };
        enhancedResult.vendorKey = vendorInfo.vendorKey;
        candidates.push(enhancedResult);
      } catch (err) {
        console.error('[PARSER V2] Enhanced parser error:', err.message);
      }
    }
  } else if (vendorInfo.vendorKey === 'sysco') {
    // Run Sysco parser
    console.log('[PARSER V2] Using Sysco-specific parser');
    const syscoResult = parseSyscoInvoice(fullText, options);
    syscoResult.vendorDetection = vendorInfo;
    candidates.push(syscoResult);

    // Also run generic as fallback comparison
    if (!options.strict) {
      const genericResult = parseGenericInvoice(fullText, options);
      genericResult.vendorDetection = { ...vendorInfo, note: 'fallback' };
      candidates.push(genericResult);

      // Run enhanced parser too
      try {
        const enhancedResult = parseInvoiceEnhanced(fullText, { vendor: 'sysco' });
        enhancedResult.vendorDetection = { ...vendorInfo, note: 'enhanced' };
        enhancedResult.vendorKey = vendorInfo.vendorKey;
        candidates.push(enhancedResult);
      } catch (err) {
        console.error('[PARSER V2] Enhanced parser error:', err.message);
      }
    }
  } else if (vendorInfo.vendorKey === 'usfoods') {
    // Run US Foods parser
    console.log('[PARSER V2] Using US Foods-specific parser');
    const usFoodsResult = parseUSFoodsInvoice(fullText, options);
    usFoodsResult.vendorDetection = vendorInfo;
    candidates.push(usFoodsResult);

    // Also run generic and enhanced as fallback comparison
    if (!options.strict) {
      const genericResult = parseGenericInvoice(fullText, options);
      genericResult.vendorDetection = { ...vendorInfo, note: 'fallback' };
      candidates.push(genericResult);

      try {
        const enhancedResult = parseInvoiceEnhanced(fullText, { vendor: 'usfoods' });
        enhancedResult.vendorDetection = { ...vendorInfo, note: 'enhanced' };
        enhancedResult.vendorKey = vendorInfo.vendorKey;
        candidates.push(enhancedResult);
      } catch (err) {
        console.error('[PARSER V2] Enhanced parser error:', err.message);
      }
    }
  } else {
    // Use generic parser
    const genericResult = parseGenericInvoice(fullText, options);
    genericResult.vendorDetection = vendorInfo;
    candidates.push(genericResult);

    // Also run enhanced multi-strategy parser for comparison
    if (!options.strict) {
      try {
        const enhancedResult = parseInvoiceEnhanced(fullText, { vendor: vendorInfo.vendorKey });
        enhancedResult.vendorDetection = { ...vendorInfo, note: 'enhanced' };
        enhancedResult.vendorKey = vendorInfo.vendorKey;
        candidates.push(enhancedResult);
      } catch (err) {
        console.error('[PARSER V2] Enhanced parser error:', err.message);
      }

      // Also run adaptive parser for unknown formats
      try {
        const adaptiveResult = parseAdaptive(fullText, { totals: genericResult.totals });
        if (adaptiveResult.success && adaptiveResult.lineItems.length > 0) {
          adaptiveResult.vendorDetection = { ...vendorInfo, note: 'adaptive' };
          adaptiveResult.vendorKey = vendorInfo.vendorKey || 'generic';
          adaptiveResult.header = genericResult.header;
          adaptiveResult.totals = genericResult.totals;
          candidates.push(adaptiveResult);
        }
      } catch (err) {
        console.error('[PARSER V2] Adaptive parser error:', err.message);
      }
    }
  }

  // Step 4: Choose best result
  const bestResult = chooseBestParse(candidates);

  if (!bestResult) {
    return {
      success: false,
      error: 'No valid parse result',
      vendorDetection: vendorInfo,
      debug: {
        candidateCount: candidates.length,
        parseTimeMs: Date.now() - startTime
      }
    };
  }

  // Step 5: Post-process line items (validate and fix math errors)
  if (bestResult.lineItems && bestResult.lineItems.length > 0) {
    const validatedItems = validateAndFixLineItems(bestResult.lineItems);
    bestResult.lineItems = validatedItems;
    bestResult.mathCorrectedCount = validatedItems.filter(i => i.mathCorrected).length;
  }

  // Step 5.5: Run full reconciliation
  let reconciliation = null;
  if (bestResult.lineItems && bestResult.lineItems.length > 0) {
    reconciliation = fullReconciliation({
      lineItems: bestResult.lineItems,
      totals: bestResult.totals || {}
    }, { autoFix: true });

    // Apply reconciliation fixes
    if (reconciliation.changelog.length > 0) {
      bestResult.lineItems = reconciliation.finalItems;
      bestResult.mathCorrectedCount = (bestResult.mathCorrectedCount || 0) + reconciliation.changelog.length;
    }

    // Adjust confidence based on reconciliation
    if (bestResult.confidence && reconciliation.confidenceAdjustment) {
      bestResult.confidence.score = Math.max(0, Math.min(100,
        (bestResult.confidence.score || 50) + reconciliation.confidenceAdjustment
      ));
    }
  }

  // Step 5.7: Final garbage filter - catch anything that slipped through parsers
  // This is critical for catching ORDER SUMMARY numbers misread as prices
  const MAX_REASONABLE_LINE_ITEM_CENTS = 2000000; // $20,000 - generous for restaurant supplies

  if (bestResult.lineItems && bestResult.lineItems.length > 0) {
    const originalCount = bestResult.lineItems.length;
    bestResult.lineItems = bestResult.lineItems.filter(item => {
      const desc = (item.description || '').toUpperCase();
      const lineTotal = item.lineTotalCents || 0;
      const unitPrice = item.unitPriceCents || 0;

      // FILTER 1: Reject items with absurdly high prices (likely order numbers)
      if (lineTotal > MAX_REASONABLE_LINE_ITEM_CENTS || unitPrice > MAX_REASONABLE_LINE_ITEM_CENTS) {
        console.log(`[PARSER V2] Filtering garbage item: "${item.description?.slice(0, 50)}" - price too high: $${(lineTotal/100).toFixed(2)}`);
        return false;
      }

      // FILTER 2: Reject ORDER SUMMARY section (contains order numbers that look like prices)
      if (/ORDER\s*SUMMARY/i.test(desc)) {
        console.log(`[PARSER V2] Filtering garbage item: "${item.description?.slice(0, 50)}" - ORDER SUMMARY`);
        return false;
      }

      // FILTER 3: Reject MISC CHARGES / fee lines (not product items)
      if (/MISC\s*CHARGES/i.test(desc) || /FUEL\s*SURCHARGE/i.test(desc) || /CHGS\s+FOR/i.test(desc)) {
        console.log(`[PARSER V2] Filtering garbage item: "${item.description?.slice(0, 50)}" - MISC/FEE line`);
        return false;
      }

      // FILTER 4: Reject ALLOWANCE / DROP SIZE (adjustments, not items)
      if (/ALLOWANCE\s+FOR/i.test(desc) || /DROP\s+SIZE/i.test(desc)) {
        console.log(`[PARSER V2] Filtering garbage item: "${item.description?.slice(0, 50)}" - ADJUSTMENT line`);
        return false;
      }

      // FILTER 5: Reject ADDRESS lines (CITY, STATE ZIP patterns)
      // These get picked up when PDF extraction fails partially
      // NUCLEAR: Check MULTIPLE patterns to ensure addresses don't slip through
      const isAddressLine =
        /\b[A-Z]{2}\s+\d{5}\b/.test(desc) ||           // State + ZIP (e.g., "MD 21851")
        /\b[A-Z]{2},?\s*\d{5}/.test(desc) ||           // State,ZIP (no space: "MD,21851" or "MD 21851")
        /\bCITY\b/i.test(desc) ||                      // Contains word "CITY"
        /\bFOTAL\b/i.test(desc) ||                     // Corrupted "TOTAL" (OCR error T→F)
        /\d{5,}\s*[A-Z]{2}\s*\d{5}/.test(desc) ||      // Multiple ZIPs
        /^\d+\s+[A-Z]+\s+(ST|AVE|BLVD|RD|DR|LN|WAY|CT|ROAD|DRIVE|LANE|COURT|CIRCLE|PIKE|HWY|HIGHWAY)\b/i.test(desc) || // Street address
        /POCOMOKE|BALTIMORE|ANNAPOLIS|ROCKVILLE/i.test(desc) ||  // Common city names (Maryland)
        (/\b\d{5}\b/.test(desc) && /\b[A-Z]{2}\b/.test(desc) && !/\d{6,}/.test(desc) && !/[A-Z]{3,}/i.test(desc.replace(/[^A-Z]/gi, '').slice(0,20)));  // Has zip+state but NOT product-like description

      if (isAddressLine) {
        console.log(`[PARSER V2] Filtering garbage item: "${item.description?.slice(0, 50)}" - ADDRESS line`);
        return false;
      }

      // FILTER 6: Reject items where description contains TOTAL or SUBTOTAL (likely totals row, not item)
      if (/\bTOTAL\b/i.test(desc) && !/TOTAL\s*CASE/i.test(desc)) {
        console.log(`[PARSER V2] Filtering garbage item: "${item.description?.slice(0, 50)}" - contains TOTAL`);
        return false;
      }
      if (/\bSUBTOTAL\b/i.test(desc)) {
        console.log(`[PARSER V2] Filtering garbage item: "${item.description?.slice(0, 50)}" - contains SUBTOTAL`);
        return false;
      }

      // FILTER 6b: Reject items where description is just "$" or very short meaningless text
      // These are remnants of totals rows where only the currency symbol was captured
      const trimmedDesc = desc.trim();
      if (trimmedDesc === '$' || trimmedDesc === '' || trimmedDesc.length <= 2) {
        console.log(`[PARSER V2] Filtering garbage item: "${item.description?.slice(0, 50)}" - too short/just currency symbol`);
        return false;
      }

      // FILTER 6c: Reject items that are just "TAX" or "SALES TAX" (tax lines, not items)
      if (/^(SALES\s*)?TAX$/i.test(trimmedDesc)) {
        console.log(`[PARSER V2] Filtering garbage item: "${item.description?.slice(0, 50)}" - tax line`);
        return false;
      }

      // FILTER 7: Reject items where lineTotal equals the only item and matches invoice total
      // This catches when a summary line is parsed as the only item
      if (bestResult.lineItems.length === 1 && lineTotal === bestResult.totals?.totalCents) {
        // Only one item and it equals the invoice total - suspicious
        // Check if description looks like a summary, not a product
        if (!/[A-Z]{3,}\s+[A-Z]{3,}/i.test(desc.replace(/[^A-Z\s]/gi, ''))) {
          console.log(`[PARSER V2] Filtering garbage item: "${item.description?.slice(0, 50)}" - single item equals total, likely summary line`);
          return false;
        }
      }

      return true;
    });

    const filteredCount = originalCount - bestResult.lineItems.length;
    if (filteredCount > 0) {
      console.log(`[PARSER V2] Filtered ${filteredCount} garbage items from final result`);
    }
  }

  // Step 5.8: Enhance line items with UOM (unit of measure) detection
  // This improves accuracy for weight-based pricing (meat, seafood) and volume-based (beverages)
  if (bestResult.lineItems && bestResult.lineItems.length > 0) {
    let uomEnhancedCount = 0;
    bestResult.lineItems = bestResult.lineItems.map((item, idx) => {
      // Detect UOM from description
      const uomInfo = detectUOM(item.description);

      // Add product category info if detected
      if (uomInfo.expectedCategory) {
        item.productCategory = uomInfo.expectedCategory.category;
        item.expectedUOM = uomInfo.expectedCategory.expectedUOM;
      }

      // Track if item has UOM info
      if (uomInfo.detected) {
        item.uomDetected = true;
        if (uomInfo.units.length > 0) {
          item.detectedUnits = uomInfo.units.map(u => `${u.value}${u.unit}`).join(', ');
        }
        if (uomInfo.pricingType) {
          item.pricingType = uomInfo.pricingType.name;
        }
        uomEnhancedCount++;
      }

      return item;
    });

    if (uomEnhancedCount > 0) {
      console.log(`[PARSER V2] Enhanced ${uomEnhancedCount} items with UOM detection`);
    }
  }

  // Step 6: Run printed total priority reconciliation
  // CRITICAL: This ensures printed invoice total ALWAYS wins over computed totals
  const printedTotalReconcile = reconcileWithPrintedTotalPriority({
    lineItems: bestResult.lineItems || [],
    totals: bestResult.totals || {},
    adjustments: bestResult.adjustments || bestResult.totals?.adjustments || []
  }, fullText);

  // Get the authoritative total (printed total wins)
  const authoritativeTotalCents = getAuthoritativeTotalCents(printedTotalReconcile);

  // Merge adjustments (include any synthetic adjustments created by reconciliation)
  const finalAdjustments = printedTotalReconcile.adjustments || [];

  console.log(`[PARSER V2] Authoritative total: $${(authoritativeTotalCents/100).toFixed(2)} (printed: $${(printedTotalReconcile.printed_total_cents/100).toFixed(2)}, computed: $${(printedTotalReconcile.computed_total_cents/100).toFixed(2)})`);

  // Step 7: Build final result
  // CRITICAL: Use vendor info from detection, not from bestResult (which may be generic)
  // PRIORITY ORDER for vendor name:
  // 1. vendorInfo.vendorName (from vendorDetector) - HIGHEST priority
  // 2. bestResult.vendorDetection?.vendorName (from parser)
  // 3. bestResult.header?.vendorName (from header extraction)
  // 4. "Unknown Vendor" - LAST resort only
  const finalVendorKey = bestResult.vendorKey || vendorInfo.vendorKey || 'generic';
  let finalVendorName = 'Unknown Vendor';

  // Priority 1: vendorInfo from vendorDetector (most reliable)
  if (vendorInfo.vendorName && vendorInfo.vendorName !== 'Unknown Vendor') {
    finalVendorName = vendorInfo.vendorName;
    console.log(`[PARSER V2] Using vendor name from detector: ${finalVendorName}`);
  }
  // Priority 2: bestResult.vendorDetection
  else if (bestResult.vendorDetection?.vendorName && bestResult.vendorDetection.vendorName !== 'Unknown Vendor') {
    finalVendorName = bestResult.vendorDetection.vendorName;
    console.log(`[PARSER V2] Using vendor name from parse result: ${finalVendorName}`);
  }
  // Priority 3: bestResult.header
  else if (bestResult.header?.vendorName && bestResult.header.vendorName !== 'Unknown Vendor') {
    finalVendorName = bestResult.header.vendorName;
    console.log(`[PARSER V2] Using vendor name from header: ${finalVendorName}`);
  }
  // Priority 4: Try to infer from vendorKey
  else if (finalVendorKey && finalVendorKey !== 'generic') {
    const keyToName = {
      'cintas': 'Cintas Corporation',
      'sysco': 'Sysco Corporation',
      'usfoods': 'US Foods',
      'aramark': 'Aramark',
      'unifirst': 'UniFirst'
    };
    if (keyToName[finalVendorKey]) {
      finalVendorName = keyToName[finalVendorKey];
      console.log(`[PARSER V2] Inferred vendor name from key: ${finalVendorName}`);
    }
  }

  console.log(`[PARSER V2] FINAL vendor: key=${finalVendorKey}, name=${finalVendorName}`);

  const result = {
    success: true,
    vendorKey: finalVendorKey,
    vendorName: finalVendorName,
    parserVersion: bestResult.parserVersion || '2.0.0',

    // Header/metadata
    invoiceNumber: bestResult.header?.invoiceNumber || null,
    invoiceDate: bestResult.header?.invoiceDate || null,
    customerName: bestResult.header?.customerName || null,
    accountNumber: bestResult.header?.accountNumber || null,
    soldTo: bestResult.header?.soldTo || null,
    billTo: bestResult.header?.billTo || null,
    shipTo: bestResult.header?.shipTo || null,

    // Totals - CRITICAL: Use authoritative (printed) total
    totals: {
      subtotalCents: bestResult.totals?.subtotalCents || 0,
      taxCents: bestResult.totals?.taxCents || 0,
      adjustmentsCents: finalAdjustments.reduce((sum, adj) => sum + (adj.amountCents || 0), 0),
      totalCents: authoritativeTotalCents,  // PRINTED TOTAL WINS
      printedTotalCents: printedTotalReconcile.printed_total_cents,  // For reference
      computedTotalCents: printedTotalReconcile.computed_total_cents,  // For reference
      currency: bestResult.totals?.currency || 'USD'
    },

    // Adjustments (fees, credits, surcharges - things that affect total but aren't line items)
    // Includes any synthetic adjustments created to reconcile printed vs computed
    adjustments: finalAdjustments.map((adj, idx) => ({
      adjustmentNumber: idx + 1,
      type: adj.type || 'adjustment',
      description: adj.description || 'Adjustment',
      amountCents: adj.amountCents || 0,
      isSynthetic: adj.isSynthetic || false
    })),

    // Line items (normalized format)
    lineItems: (bestResult.lineItems || []).map((item, idx) => ({
      lineNumber: idx + 1,
      sku: item.sku || null,
      description: item.description || '',
      quantity: item.qty || item.quantity || 1,
      unitPriceCents: item.unitPriceCents || 0,
      lineTotalCents: item.lineTotalCents || 0,
      taxable: item.taxFlag === 'Y',
      category: item.type || item.category || 'item',
      mathValidated: item.mathValidated || false,
      mathCorrected: item.mathCorrected || false,
      // UOM (unit of measure) info
      weightCorrected: item.weightCorrected || false,
      productCategory: item.productCategory || null,
      detectedUnits: item.detectedUnits || null,
      pricingType: item.pricingType || null,
      actualWeight: item.actualWeight || null
    })),

    // Confidence and validation
    confidence: bestResult.confidence || { score: 0, issues: [], warnings: [] },

    // Optional grouping data
    employees: bestResult.employees || [],
    departments: bestResult.departments || [],

    // Debug info (if requested)
    debug: options.debug ? {
      vendorDetection: bestResult.vendorDetection,
      parseTimeMs: Date.now() - startTime,
      rawLineCount: fullText.split('\n').length,
      pageCount: pages.length,
      tableRegions: bestResult.debug?.tableRegions,
      alternatives: bestResult.alternatives,
      checksum: calculateParseChecksum(bestResult),
      mathCorrectedCount: bestResult.mathCorrectedCount || 0,
      textQuality: textQuality,
      patternRecommendation: patternRecommendation,
      reconciliation: reconciliation ? {
        isValid: reconciliation.isValid,
        issues: reconciliation.reconciliation?.issues || [],
        warnings: reconciliation.reconciliation?.warnings || [],
        corrections: reconciliation.changelog
      } : null,
      // CRITICAL: Printed total reconciliation details
      printedTotalReconciliation: {
        printedTotalCents: printedTotalReconcile.printed_total_cents,
        computedTotalCents: printedTotalReconcile.computed_total_cents,
        lineItemsSumCents: printedTotalReconcile.line_items_sum_cents,
        adjustmentsSumCents: printedTotalReconcile.adjustments_sum_cents,
        deltaCents: printedTotalReconcile.reconciliation.delta_cents,
        toleranceOk: printedTotalReconcile.reconciliation.tolerance_ok,
        reason: printedTotalReconcile.reconciliation.reason,
        warnings: printedTotalReconcile.reconciliation.warnings,
        syntheticAdjustment: printedTotalReconcile.synthetic_adjustment
      }
    } : undefined
  };

  // Step 8: Store successful pattern for future use
  if (result.success && result.confidence?.score >= 60) {
    try {
      storePattern(result, fullText);
    } catch (err) {
      // Pattern storage is optional, don't fail if it errors
    }
  }

  return result;
}

/**
 * Convert v2 result to v1 format for backwards compatibility
 */
function convertToV1Format(v2Result) {
  if (!v2Result.success) {
    return {
      items: [],
      totals: { subtotalCents: 0, taxCents: 0, totalCents: 0 },
      vendor: { name: 'Unknown' },
      accountName: null,
      confidence: 0
    };
  }

  return {
    items: v2Result.lineItems.map(item => ({
      description: item.description,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      totalCents: item.lineTotalCents,
      sku: item.sku,
      category: item.category
    })),
    totals: {
      subtotalCents: v2Result.totals.subtotalCents,
      taxCents: v2Result.totals.taxCents,
      totalCents: v2Result.totals.totalCents
    },
    vendor: {
      name: v2Result.vendorName,
      confidence: v2Result.confidence.score / 100
    },
    accountName: v2Result.customerName,
    invoiceNumber: v2Result.invoiceNumber,
    invoiceDate: v2Result.invoiceDate,
    employees: v2Result.employees,
    confidence: v2Result.confidence.score / 100
  };
}

/**
 * Quick validation check - useful for testing
 */
function quickValidate(rawText) {
  const result = parseInvoiceText(rawText, { debug: true });
  return {
    success: result.success,
    score: result.confidence?.score || 0,
    issues: result.confidence?.issues || [],
    totalCents: result.totals?.totalCents || 0,
    lineItemCount: result.lineItems?.length || 0,
    lineItemSum: (result.lineItems || []).reduce((sum, item) => sum + item.lineTotalCents, 0)
  };
}

// Export everything
module.exports = {
  // Main API
  parseInvoiceText,
  convertToV1Format,
  quickValidate,

  // Utilities (for advanced use)
  normalizeInvoiceText,
  detectVendor,
  validateInvoiceParse,
  validateAndFixLineItems,

  // Text quality and reconciliation
  analyzeTextQuality,
  cleanText,
  mergeMultiLineItems,
  fullReconciliation,
  generateInvoiceSummary,
  reconcileWithSalvage,
  attemptSalvage,
  reconcileWithPrintedTotalPriority,
  getAuthoritativeTotalCents,

  // Totals and adjustments extraction
  extractTotalCandidates,
  findReconcilableTotal,
  validateTotalsEquation,
  extractAdjustments,
  calculateAdjustmentsSummary,
  extractTax,

  // Layout analysis
  analyzeLayout,
  generateParsingHints,

  // PDF layout extraction (optional)
  isLayoutExtractionAvailable,
  extractWithLayout,
  getLayoutQuality,

  // Pattern learning
  storePattern,
  findPatterns,
  getRecommendation,

  // Individual parsers (for testing)
  parseCintasInvoice,
  parseSyscoInvoice,
  parseUSFoodsInvoice,
  parseGenericInvoice,
  parseInvoiceEnhanced,
  parseAdaptive
};
