/**
 * CORE EXTRACTOR - Unified Invoice Data Extraction
 *
 * This module runs FIRST before ANY vendor-specific parser logic.
 * It extracts EVERYTHING possible from the invoice WITHOUT ruling anything out.
 *
 * PHILOSOPHY:
 * - Extract ALL possible totals, line items, fees, taxes, etc.
 * - NEVER reject data at this stage
 * - Let downstream parsers SELECT from extracted values (not REJECT)
 * - This ensures we always have basic invoice data even if vendor-specific parsing fails
 *
 * WHAT THIS EXTRACTS:
 * - All labeled totals (INVOICE TOTAL, TOTAL USD, GRAND TOTAL, SUBTOTAL, etc.)
 * - All tax amounts
 * - All line item patterns
 * - All fees and surcharges
 * - All adjustment patterns
 */

const { parseMoney, parseMoneyToDollars } = require('./utils');

/**
 * Extract ALL labeled monetary values from invoice text
 * Returns arrays of candidates, not single values
 *
 * @param {string} text - Raw invoice text
 * @returns {Object} All extracted monetary values with labels and confidence
 */
function extractAllMonetaryValues(text) {
  if (!text) return { totals: [], subtotals: [], taxes: [], fees: [], misc: [] };

  const upperText = text.toUpperCase();

  const result = {
    totals: [],      // INVOICE TOTAL, TOTAL USD, GRAND TOTAL, AMOUNT DUE, BALANCE DUE
    subtotals: [],   // SUBTOTAL, SUB-TOTAL
    taxes: [],       // SALES TAX, TAX
    fees: [],        // FUEL SURCHARGE, DELIVERY FEE, SERVICE FEE
    misc: []         // Any other labeled amounts
  };

  // ============================================================
  // PRIORITY 1: INVOICE TOTAL patterns (highest priority)
  // ============================================================
  const invoiceTotalPatterns = [
    // Same-line patterns
    { regex: /INVOICE\s+TOTAL[\s:]*\$?([\d,]+\.?\d{0,2})/gi, type: 'INVOICE TOTAL', priority: 1 },
    { regex: /TOTAL\s+USD[\s:]*\$?([\d,]+\.?\d{0,2})/gi, type: 'TOTAL USD', priority: 1 },
    { regex: /GRAND\s+TOTAL[\s:]*\$?([\d,]+\.?\d{0,2})/gi, type: 'GRAND TOTAL', priority: 2 },
    { regex: /AMOUNT\s+DUE[\s:]*\$?([\d,]+\.?\d{0,2})/gi, type: 'AMOUNT DUE', priority: 2 },
    { regex: /BALANCE\s+DUE[\s:]*\$?([\d,]+\.?\d{0,2})/gi, type: 'BALANCE DUE', priority: 2 },
    { regex: /TOTAL\s+DUE[\s:]*\$?([\d,]+\.?\d{0,2})/gi, type: 'TOTAL DUE', priority: 3 },
    { regex: /NET\s+TOTAL[\s:]*\$?([\d,]+\.?\d{0,2})/gi, type: 'NET TOTAL', priority: 3 },

    // Split-line patterns (label on one line, value on next)
    { regex: /INVOICE\s*\n\s*TOTAL[\s:]*\n?\s*\$?([\d,]+\.?\d{0,2})/gi, type: 'INVOICE TOTAL (split)', priority: 1 },
    { regex: /TOTAL\s+USD\s*\n\s*\$?([\d,]+\.?\d{0,2})/gi, type: 'TOTAL USD (split)', priority: 1 },

    // Generic TOTAL (lower priority - might be subtotal or category total)
    { regex: /(?:^|\n)\s*TOTAL[\s:]+\$?([\d,]+\.?\d{0,2})/gim, type: 'TOTAL', priority: 5 },
  ];

  for (const pattern of invoiceTotalPatterns) {
    const matches = [...text.matchAll(pattern.regex)];
    for (const match of matches) {
      const cents = parseMoney(match[1]);
      if (cents > 100 && cents < 100000000) { // $1 to $1M range
        // Check context for GROUP/CATEGORY patterns (mark but don't reject)
        const contextStart = Math.max(0, match.index - 50);
        const contextEnd = Math.min(text.length, match.index + match[0].length + 20);
        const context = text.substring(contextStart, contextEnd).toUpperCase();

        const isGroupContext = /GROUP|CATEGORY|SECTION|DEPT|\*{3,}/.test(context) && !/INVOICE/.test(context);

        result.totals.push({
          cents,
          type: pattern.type,
          priority: pattern.priority,
          isGroupContext,
          raw: match[0].trim(),
          index: match.index,
          context: context.trim()
        });
      }
    }
  }

  // ============================================================
  // SUBTOTAL patterns
  // ============================================================
  const subtotalPatterns = [
    { regex: /(?:^|\n)\s*SUBTOTAL[\s:]*\$?([\d,]+\.?\d{0,2})/gim, type: 'SUBTOTAL' },
    { regex: /(?:^|\n)\s*SUB[- ]?TOTAL[\s:]*\$?([\d,]+\.?\d{0,2})/gim, type: 'SUB-TOTAL' },
    { regex: /MERCHANDISE[\s:]*\$?([\d,]+\.?\d{0,2})/gi, type: 'MERCHANDISE' },
    { regex: /PRODUCTS?[\s:]+\$?([\d,]+\.?\d{0,2})/gi, type: 'PRODUCTS' },
  ];

  for (const pattern of subtotalPatterns) {
    const matches = [...text.matchAll(pattern.regex)];
    for (const match of matches) {
      const cents = parseMoney(match[1]);
      if (cents > 100 && cents < 100000000) {
        const contextStart = Math.max(0, match.index - 40);
        const context = text.substring(contextStart, match.index).toUpperCase();
        const isGroupContext = /GROUP|CATEGORY|SECTION|DEPT/.test(context);

        result.subtotals.push({
          cents,
          type: pattern.type,
          isGroupContext,
          raw: match[0].trim(),
          index: match.index
        });
      }
    }
  }

  // ============================================================
  // TAX patterns
  // ============================================================
  const taxPatterns = [
    { regex: /SALES\s+TAX[\s:]*\$?([\d,]+\.?\d{0,2})/gi, type: 'SALES TAX' },
    { regex: /STATE\s+TAX[\s:]*\$?([\d,]+\.?\d{0,2})/gi, type: 'STATE TAX' },
    { regex: /LOCAL\s+TAX[\s:]*\$?([\d,]+\.?\d{0,2})/gi, type: 'LOCAL TAX' },
    { regex: /(?:^|\s)TAX[\s:]+\$?([\d,]+\.?\d{0,2})/gim, type: 'TAX' },
    { regex: /TAX\s+AMOUNT[\s:]*\$?([\d,]+\.?\d{0,2})/gi, type: 'TAX AMOUNT' },
  ];

  for (const pattern of taxPatterns) {
    const matches = [...text.matchAll(pattern.regex)];
    for (const match of matches) {
      const cents = parseMoney(match[1]);
      if (cents >= 0 && cents < 10000000) { // Tax can be $0 to $100k
        result.taxes.push({
          cents,
          type: pattern.type,
          raw: match[0].trim(),
          index: match.index
        });
      }
    }
  }

  // ============================================================
  // FEE and SURCHARGE patterns
  // ============================================================
  const feePatterns = [
    { regex: /FUEL\s+SURCHARGE[\s:]*\$?([\d,]+\.?\d{0,2})/gi, type: 'FUEL SURCHARGE' },
    { regex: /DELIVERY\s+(?:FEE|CHARGE)[\s:]*\$?([\d,]+\.?\d{0,2})/gi, type: 'DELIVERY FEE' },
    { regex: /SERVICE\s+(?:FEE|CHARGE)[\s:]*\$?([\d,]+\.?\d{0,2})/gi, type: 'SERVICE FEE' },
    { regex: /HANDLING\s+(?:FEE|CHARGE)[\s:]*\$?([\d,]+\.?\d{0,2})/gi, type: 'HANDLING FEE' },
    { regex: /ENVIRONMENTAL\s+(?:FEE|SURCHARGE)[\s:]*\$?([\d,]+\.?\d{0,2})/gi, type: 'ENVIRONMENTAL FEE' },
    { regex: /PROGRAM\s+FEE[\s:]*\$?([\d,]+\.?\d{0,2})/gi, type: 'PROGRAM FEE' },
    { regex: /STOP\s+CHARGE[\s:]*\$?([\d,]+\.?\d{0,2})/gi, type: 'STOP CHARGE' },
  ];

  for (const pattern of feePatterns) {
    const matches = [...text.matchAll(pattern.regex)];
    for (const match of matches) {
      const cents = parseMoney(match[1]);
      if (cents > 0 && cents < 10000000) {
        result.fees.push({
          cents,
          type: pattern.type,
          raw: match[0].trim(),
          index: match.index
        });
      }
    }
  }

  return result;
}

/**
 * Extract the BEST total from all extracted monetary values
 * Uses intelligent selection logic based on:
 * 1. Label priority (INVOICE TOTAL > TOTAL USD > GRAND TOTAL > etc.)
 * 2. Context (reject GROUP TOTAL unless it's the only option)
 * 3. Mathematical consistency (total should be >= subtotal)
 *
 * @param {Object} extractedValues - Output from extractAllMonetaryValues
 * @param {Object} options - Selection options
 * @returns {Object} Best total with source information
 */
function selectBestTotal(extractedValues, options = {}) {
  const { subtotalCents = 0, allowGroupTotal = false } = options;

  const candidates = extractedValues.totals
    // Filter out GROUP TOTAL unless allowed
    .filter(t => allowGroupTotal || !t.isGroupContext)
    // Sort by priority (lower = better), then by amount (higher = better for same priority)
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return b.cents - a.cents;
    });

  // Best candidate
  if (candidates.length > 0) {
    const best = candidates[0];

    // Validate: total should be >= subtotal (if we have subtotal)
    if (subtotalCents > 0 && best.cents < subtotalCents * 0.9) { // Allow 10% margin for rounding
      // Look for a better candidate that's >= subtotal
      const betterCandidate = candidates.find(c => c.cents >= subtotalCents * 0.95);
      if (betterCandidate) {
        return {
          totalCents: betterCandidate.cents,
          source: betterCandidate.type,
          confidence: 0.9,
          raw: betterCandidate.raw,
          allCandidates: candidates
        };
      }
    }

    return {
      totalCents: best.cents,
      source: best.type,
      confidence: best.priority <= 2 ? 0.95 : 0.8,
      raw: best.raw,
      allCandidates: candidates
    };
  }

  // No explicit total found - fall back to highest subtotal + tax
  if (extractedValues.subtotals.length > 0) {
    const subtotals = extractedValues.subtotals
      .filter(s => !s.isGroupContext)
      .sort((a, b) => b.cents - a.cents);

    if (subtotals.length > 0) {
      const highestSubtotal = subtotals[0];
      const totalTax = extractedValues.taxes.reduce((sum, t) => sum + t.cents, 0);

      return {
        totalCents: highestSubtotal.cents + totalTax,
        source: 'COMPUTED (subtotal + tax)',
        confidence: 0.6,
        subtotalCents: highestSubtotal.cents,
        taxCents: totalTax,
        allCandidates: candidates
      };
    }
  }

  return {
    totalCents: 0,
    source: 'NONE',
    confidence: 0,
    allCandidates: []
  };
}

/**
 * Extract ALL potential line items from text
 * Uses multiple patterns without rejecting any matches
 *
 * @param {string} text - Raw invoice text
 * @returns {Array} All potential line items with confidence scores
 */
function extractAllLineItems(text) {
  if (!text) return [];

  const items = [];
  const lines = text.split('\n');

  // Pattern 1: Standard line item (qty, description, price)
  // Matches: "2 WIDGET BLUE     $15.00"
  const standardPattern = /^\s*(\d+(?:\.\d+)?)\s+(.{10,60}?)\s+\$?([\d,]+\.\d{2})\s*$/;

  // Pattern 2: SKU-first pattern (SKU, description, qty, price)
  // Matches: "X12345 WIDGET BLUE 2 $15.00"
  const skuFirstPattern = /^\s*([A-Z0-9-]{4,15})\s+(.{5,50}?)\s+(\d+(?:\.\d+)?)\s+\$?([\d,]+\.\d{2})/;

  // Pattern 3: Description-first with trailing numbers (Sysco style)
  // Matches: "WIDGET BLUE LARGE   2   $7.50   $15.00"
  const descFirstPattern = /^\s*(.{10,50}?)\s+(\d+(?:\.\d+)?)\s+\$?([\d,]+\.\d{2})\s+\$?([\d,]+\.\d{2})/;

  // Pattern 4: Service line (employee-based, Cintas style)
  // Matches: "Uniform Service - JOHN DOE  1  $25.00"
  const servicePattern = /^\s*(Uniform Service|Service|Rental)\s*[-:]\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+(\d+)\s+\$?([\d,]+\.\d{2})?/i;

  // Pattern 5: Multi-number line (Sysco format with multiple numeric columns)
  // Matches lines with description followed by multiple numbers (qty, cases, unit, total)
  const multiNumberPattern = /^\s*(.{5,40}?)\s+([\d.]+)\s+([\d.]+)\s+\$?([\d,]+\.\d{2})\s+\$?([\d,]+\.\d{2})/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 10) continue;

    // Skip obvious non-item lines
    if (/^(SUBTOTAL|TOTAL|TAX|GRAND|INVOICE|PAGE|SHIP|BILL|ACCOUNT|DATE|DUE|AMOUNT)/i.test(trimmed)) {
      continue;
    }

    let match;

    // Try each pattern
    if ((match = trimmed.match(standardPattern))) {
      items.push({
        pattern: 'standard',
        qty: parseFloat(match[1]),
        description: match[2].trim(),
        totalCents: parseMoney(match[3]),
        raw: trimmed,
        confidence: 0.9
      });
    } else if ((match = trimmed.match(skuFirstPattern))) {
      items.push({
        pattern: 'sku_first',
        sku: match[1],
        description: match[2].trim(),
        qty: parseFloat(match[3]),
        totalCents: parseMoney(match[4]),
        raw: trimmed,
        confidence: 0.85
      });
    } else if ((match = trimmed.match(descFirstPattern))) {
      const unitPrice = parseMoney(match[3]);
      const totalPrice = parseMoney(match[4]);
      const qty = parseFloat(match[2]);

      items.push({
        pattern: 'desc_first',
        description: match[1].trim(),
        qty: qty,
        unitPriceCents: unitPrice,
        totalCents: totalPrice,
        raw: trimmed,
        confidence: 0.85
      });
    } else if ((match = trimmed.match(servicePattern))) {
      items.push({
        pattern: 'service',
        description: `${match[1]} - ${match[2]}`,
        qty: parseInt(match[3]) || 1,
        totalCents: match[4] ? parseMoney(match[4]) : 0,
        raw: trimmed,
        confidence: 0.8
      });
    } else if ((match = trimmed.match(multiNumberPattern))) {
      items.push({
        pattern: 'multi_number',
        description: match[1].trim(),
        qty: parseFloat(match[2]) || parseFloat(match[3]),
        unitPriceCents: parseMoney(match[4]),
        totalCents: parseMoney(match[5]),
        raw: trimmed,
        confidence: 0.75
      });
    }
  }

  return items;
}

/**
 * MAIN CORE EXTRACTION FUNCTION
 * This should be called FIRST by all parsers before any vendor-specific logic
 *
 * @param {string} text - Raw invoice text
 * @returns {Object} All extracted invoice data
 */
function extractCore(text) {
  if (!text) {
    return {
      success: false,
      monetaryValues: { totals: [], subtotals: [], taxes: [], fees: [], misc: [] },
      lineItems: [],
      bestTotal: { totalCents: 0, source: 'NONE', confidence: 0 },
      subtotalCents: 0,
      taxCents: 0,
      feesCents: 0
    };
  }

  console.log('[CORE EXTRACTOR] Starting extraction...');

  // Step 1: Extract ALL monetary values
  const monetaryValues = extractAllMonetaryValues(text);
  console.log(`[CORE EXTRACTOR] Found: ${monetaryValues.totals.length} totals, ${monetaryValues.subtotals.length} subtotals, ${monetaryValues.taxes.length} taxes, ${monetaryValues.fees.length} fees`);

  // Log all found totals for debugging
  for (const t of monetaryValues.totals) {
    console.log(`[CORE EXTRACTOR] Total: ${t.type} = $${(t.cents/100).toFixed(2)} (priority: ${t.priority}, group: ${t.isGroupContext})`);
  }

  // Step 2: Extract ALL potential line items
  const lineItems = extractAllLineItems(text);
  console.log(`[CORE EXTRACTOR] Found ${lineItems.length} potential line items`);

  // Step 3: Calculate derived values
  const subtotalCents = monetaryValues.subtotals
    .filter(s => !s.isGroupContext)
    .sort((a, b) => b.cents - a.cents)[0]?.cents || 0;

  const taxCents = monetaryValues.taxes.reduce((sum, t) => sum + t.cents, 0);
  const feesCents = monetaryValues.fees.reduce((sum, f) => sum + f.cents, 0);

  // Step 4: Select best total using intelligent logic
  const bestTotal = selectBestTotal(monetaryValues, { subtotalCents });
  console.log(`[CORE EXTRACTOR] Best total: $${(bestTotal.totalCents/100).toFixed(2)} via ${bestTotal.source}`);

  // Step 5: Compute line items sum for validation
  const lineItemsSum = lineItems.reduce((sum, item) => sum + (item.totalCents || 0), 0);

  // Step 6: Final validation - if best total seems wrong, try alternatives
  if (bestTotal.totalCents > 0 && lineItemsSum > 0) {
    // If total is less than 50% of line items sum, something's wrong
    if (bestTotal.totalCents < lineItemsSum * 0.5) {
      console.log(`[CORE EXTRACTOR] WARNING: Total $${(bestTotal.totalCents/100).toFixed(2)} < 50% of line items sum $${(lineItemsSum/100).toFixed(2)}`);

      // Look for a better total that makes sense with line items
      const alternativeTotal = monetaryValues.totals.find(t =>
        !t.isGroupContext &&
        t.cents >= lineItemsSum * 0.9 &&
        t.cents <= lineItemsSum * 1.2
      );

      if (alternativeTotal) {
        console.log(`[CORE EXTRACTOR] Found better alternative: $${(alternativeTotal.cents/100).toFixed(2)} via ${alternativeTotal.type}`);
        bestTotal.totalCents = alternativeTotal.cents;
        bestTotal.source = alternativeTotal.type + ' (corrected)';
      }
    }
  }

  return {
    success: true,
    monetaryValues,
    lineItems,
    bestTotal,
    subtotalCents,
    taxCents,
    feesCents,
    lineItemsSum,
    // Include raw data for downstream processing
    meta: {
      textLength: text.length,
      lineCount: text.split('\n').length,
      extractedAt: new Date().toISOString()
    }
  };
}

/**
 * Validate and potentially correct parser's totals using core extraction
 * This is the FINAL check before returning results
 *
 * @param {Object} parserTotals - Totals from vendor-specific parser
 * @param {string} text - Raw invoice text
 * @param {string} vendorKey - Vendor identifier
 * @returns {Object} Validated/corrected totals
 */
function validateParserTotals(parserTotals, text, vendorKey = 'generic') {
  const core = extractCore(text);
  const corrected = { ...parserTotals };

  const parserTotal = parserTotals.totalCents || 0;
  const coreTotal = core.bestTotal.totalCents || 0;

  console.log(`[CORE EXTRACTOR] Validating parser totals for ${vendorKey}:`);
  console.log(`[CORE EXTRACTOR]   Parser: $${(parserTotal/100).toFixed(2)}`);
  console.log(`[CORE EXTRACTOR]   Core:   $${(coreTotal/100).toFixed(2)} via ${core.bestTotal.source}`);

  // ============================================================
  // RULE 1: If parser found nothing but core found something, use core
  // ============================================================
  if (parserTotal === 0 && coreTotal > 0) {
    console.log(`[CORE EXTRACTOR] RULE 1: Parser found nothing, using core extraction`);
    corrected.totalCents = coreTotal;
    corrected.coreExtractorCorrected = true;
    corrected.coreExtractorSource = core.bestTotal.source;
  }

  // ============================================================
  // RULE 2: If parser total seems like SUBTOTAL (missing tax), use core
  // ============================================================
  else if (parserTotal > 0 && core.taxCents > 0) {
    // Check if parser total + tax ≈ core total
    const parserPlusTax = parserTotal + core.taxCents;
    if (Math.abs(parserPlusTax - coreTotal) < 100) { // Within $1
      console.log(`[CORE EXTRACTOR] RULE 2: Parser total looks like subtotal (missing tax), using core`);
      corrected.totalCents = coreTotal;
      corrected.coreExtractorCorrected = true;
      corrected.coreExtractorReason = 'missing_tax';
    }
  }

  // ============================================================
  // RULE 3: If core found higher-priority total (INVOICE TOTAL, TOTAL USD)
  // ============================================================
  else if (parserTotal > 0 && coreTotal > parserTotal) {
    const coreSource = core.bestTotal.source || '';
    if (coreSource.includes('INVOICE TOTAL') || coreSource.includes('TOTAL USD')) {
      console.log(`[CORE EXTRACTOR] RULE 3: Core found higher-priority total (${coreSource})`);
      corrected.totalCents = coreTotal;
      corrected.coreExtractorCorrected = true;
      corrected.coreExtractorSource = coreSource;
    }
  }

  // ============================================================
  // RULE 4: Vendor-specific overrides
  // ============================================================
  if (vendorKey === 'cintas' && core.monetaryValues.totals.some(t => t.type === 'TOTAL USD')) {
    const totalUsd = core.monetaryValues.totals.find(t => t.type === 'TOTAL USD');
    if (totalUsd && totalUsd.cents > parserTotal) {
      console.log(`[CORE EXTRACTOR] RULE 4 (Cintas): Using TOTAL USD`);
      corrected.totalCents = totalUsd.cents;
      corrected.coreExtractorCorrected = true;
      corrected.coreExtractorSource = 'TOTAL USD';
    }
  }

  if (vendorKey === 'sysco' && core.monetaryValues.totals.some(t => t.type.includes('INVOICE TOTAL'))) {
    const invoiceTotal = core.monetaryValues.totals.find(t => t.type.includes('INVOICE TOTAL'));
    if (invoiceTotal && invoiceTotal.cents > parserTotal) {
      console.log(`[CORE EXTRACTOR] RULE 4 (Sysco): Using INVOICE TOTAL`);
      corrected.totalCents = invoiceTotal.cents;
      corrected.coreExtractorCorrected = true;
      corrected.coreExtractorSource = 'INVOICE TOTAL';
    }
  }

  // Update subtotal/tax if we have better values
  if (core.subtotalCents > 0 && (!corrected.subtotalCents || core.subtotalCents > corrected.subtotalCents)) {
    corrected.subtotalCents = core.subtotalCents;
  }
  if (core.taxCents > 0 && !corrected.taxCents) {
    corrected.taxCents = core.taxCents;
  }

  return corrected;
}

module.exports = {
  extractAllMonetaryValues,
  selectBestTotal,
  extractAllLineItems,
  extractCore,
  validateParserTotals
};
