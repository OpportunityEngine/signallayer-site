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
const { parseGenericInvoice } = require('./genericParser');
const { parseInvoiceEnhanced } = require('./enhancedParser');
const { validateInvoiceParse, chooseBestParse, calculateParseChecksum } = require('./validator');
const { validateAndFixLineItems } = require('./numberClassifier');

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
  const fullText = cleanedPages.join('\n\n');

  // Step 2: Detect vendor
  const vendorInfo = options.vendorHint
    ? { vendorKey: options.vendorHint, vendorName: options.vendorHint, confidence: 100 }
    : detectVendor(fullText);

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

  // Step 6: Build final result
  const result = {
    success: true,
    vendorKey: bestResult.vendorKey,
    vendorName: bestResult.vendorDetection?.vendorName || 'Unknown',
    parserVersion: bestResult.parserVersion || '2.0.0',

    // Header/metadata
    invoiceNumber: bestResult.header?.invoiceNumber || null,
    invoiceDate: bestResult.header?.invoiceDate || null,
    customerName: bestResult.header?.customerName || null,
    accountNumber: bestResult.header?.accountNumber || null,
    soldTo: bestResult.header?.soldTo || null,
    billTo: bestResult.header?.billTo || null,
    shipTo: bestResult.header?.shipTo || null,

    // Totals
    totals: {
      subtotalCents: bestResult.totals?.subtotalCents || 0,
      taxCents: bestResult.totals?.taxCents || 0,
      totalCents: bestResult.totals?.totalCents || 0,
      currency: bestResult.totals?.currency || 'USD'
    },

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
      mathCorrected: item.mathCorrected || false
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
      mathCorrectedCount: bestResult.mathCorrectedCount || 0
    } : undefined
  };

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

  // Individual parsers (for testing)
  parseCintasInvoice,
  parseSyscoInvoice,
  parseGenericInvoice,
  parseInvoiceEnhanced
};
