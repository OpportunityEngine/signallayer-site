/**
 * Unified Invoice Parser Module
 *
 * This module provides consistent invoice parsing across all entry points:
 * - Dashboard Upload
 * - Email Autopilot
 * - Browser Extension
 *
 * Features:
 * - Multiple extraction strategies with fallbacks
 * - Confidence scoring for data quality
 * - Opportunity detection (price anomalies, upsell signals)
 * - Vendor/customer extraction
 * - Smart categorization
 *
 * V2 Parser (INVOICE_PARSER_V2=true):
 * - State-machine based vendor-specific parsing
 * - Robust totals detection (scan from bottom)
 * - Validation scoring to choose best parse
 * - Better handling of multi-page invoices
 */

// Feature flag for V2 parser
const USE_PARSER_V2 = process.env.INVOICE_PARSER_V2 === 'true';

// V2 Parser import (lazy loaded)
let parserV2 = null;
function getParserV2() {
  if (!parserV2) {
    try {
      parserV2 = require('./services/invoice_parsing_v2');
    } catch (e) {
      console.error('[PARSER] Failed to load V2 parser:', e.message);
      parserV2 = { parseInvoiceText: null };
    }
  }
  return parserV2;
}

// ============ MAIN PARSING FUNCTION ============

/**
 * Main parsing function - extracts all invoice data with confidence scoring
 * @param {string} text - Raw invoice text
 * @param {Object} options - Optional parsing options
 * @returns {Object} Complete parsed invoice data with confidence scores
 */
function parseInvoice(text, options = {}) {
  const startTime = Date.now();

  if (!text || typeof text !== 'string') {
    return {
      ok: false,
      error: 'No text provided',
      items: [],
      totals: { subtotalCents: 0, taxCents: 0, shippingCents: 0, totalCents: 0 },
      vendor: {},
      customer: {},
      metadata: {},
      confidence: { overall: 0, items: 0, totals: 0, parties: 0 },
      opportunities: [],
      parseTimeMs: Date.now() - startTime
    };
  }

  // ========== V2 PARSER (if enabled) ==========
  if (USE_PARSER_V2 || options.useV2) {
    try {
      const v2 = getParserV2();
      if (v2.parseInvoiceText) {
        console.log('[PARSER] Using V2 parser');
        const v2Result = v2.parseInvoiceText(text, { debug: true });

        if (v2Result.success && v2Result.confidence?.score >= 50) {
          // Convert V2 result to V1 format for compatibility
          const v1Compat = v2.convertToV1Format(v2Result);

          // Add opportunities detection using V1 logic
          const cleanedText = normalizeText(text);
          const opportunities = detectOpportunities(v1Compat.items, v1Compat.totals, v1Compat.vendor, cleanedText);

          console.log(`[PARSER V2] Score: ${v2Result.confidence.score}, Total: $${(v2Result.totals.totalCents/100).toFixed(2)}, Items: ${v2Result.lineItems.length}`);
          if (v2Result.confidence.issues?.length > 0) {
            console.log(`[PARSER V2] Issues: ${v2Result.confidence.issues.join(', ')}`);
          }

          return {
            ok: true,
            parserVersion: 'v2',
            items: v1Compat.items,
            totals: v1Compat.totals,
            vendor: v1Compat.vendor,
            customer: { name: v1Compat.accountName },
            metadata: {
              invoiceNumber: v1Compat.invoiceNumber,
              invoiceDate: v1Compat.invoiceDate
            },
            employees: v1Compat.employees,
            accountName: v1Compat.accountName,
            confidence: {
              overall: v2Result.confidence.score / 100,
              items: v2Result.lineItems.length > 0 ? 0.8 : 0.2,
              totals: v2Result.totals.totalCents > 0 ? 0.9 : 0.3,
              parties: v1Compat.vendor?.name ? 0.7 : 0.3
            },
            opportunities: opportunities,
            parseTimeMs: Date.now() - startTime,
            v2Debug: v2Result.debug
          };
        } else {
          console.log(`[PARSER V2] Score too low (${v2Result.confidence?.score || 0}), falling back to V1`);
        }
      }
    } catch (e) {
      console.error('[PARSER V2] Error, falling back to V1:', e.message);
    }
  }

  // ========== V1 PARSER (original) ==========
  // Clean and normalize text
  const cleanedText = normalizeText(text);

  // Extract all components
  const items = extractLineItems(cleanedText);
  const totals = extractTotals(cleanedText);
  const vendor = extractVendor(cleanedText);
  const customer = extractCustomer(cleanedText);
  const metadata = extractMetadata(cleanedText);

  // Calculate confidence scores
  const confidence = calculateConfidence(items, totals, vendor, customer, cleanedText);

  // If we have items but no total, calculate from items
  if (items.length > 0 && totals.totalCents === 0) {
    totals.totalCents = items.reduce((sum, item) => sum + item.totalCents, 0);
    totals.subtotalCents = totals.totalCents;
  }

  // Detect opportunities (price anomalies, upsell signals, etc.)
  const opportunities = detectOpportunities(items, totals, vendor, cleanedText);

  // Cross-validate totals vs line items
  const validation = validateExtraction(items, totals);

  return {
    ok: items.length > 0 || totals.totalCents > 0,
    items,
    totals,
    vendor,
    customer,
    metadata,
    confidence,
    opportunities,
    validation,
    rawTextLength: text.length,
    extractedAt: new Date().toISOString(),
    parseTimeMs: Date.now() - startTime
  };
}

// ============ LINE ITEM EXTRACTION ============

/**
 * Extract line items from invoice text using multiple strategies
 * @param {string} text - Normalized invoice text
 * @returns {Array} Array of extracted line items with confidence
 */
function extractLineItems(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  const items = [];
  const seenDescriptions = new Set();
  let strategyUsed = null;

  // Strategy 0: Vendor-specific formats (highest priority)
  // Cintas, Sysco, US Foods, etc. have specific invoice formats
  const vendorItems = extractVendorSpecificFormat(text);
  if (vendorItems.length > 0) {
    strategyUsed = 'vendor_specific';
    vendorItems.forEach(item => {
      const key = `${item.description}|${item.totalCents}`.toLowerCase();
      if (!seenDescriptions.has(key)) {
        seenDescriptions.add(key);
        items.push({ ...item, extractionStrategy: strategyUsed, confidence: 0.95 });
      }
    });
  }

  // Strategy 1: Structured table format (most reliable)
  // QTY | DESCRIPTION | UNIT PRICE | TOTAL
  if (items.length === 0) {
    const tableItems = extractTableFormat(text);
    if (tableItems.length > 0) {
      strategyUsed = 'table_format';
      tableItems.forEach(item => {
        if (!seenDescriptions.has(item.description.toLowerCase())) {
          seenDescriptions.add(item.description.toLowerCase());
          items.push({ ...item, extractionStrategy: strategyUsed, confidence: 0.9 });
        }
      });
    }
  }

  // Strategy 2: Line-by-line with price at end
  if (items.length === 0) {
    const lineItems = extractLineByLine(text);
    if (lineItems.length > 0) {
      strategyUsed = 'line_by_line';
      lineItems.forEach(item => {
        if (!seenDescriptions.has(item.description.toLowerCase())) {
          seenDescriptions.add(item.description.toLowerCase());
          items.push({ ...item, extractionStrategy: strategyUsed, confidence: 0.75 });
        }
      });
    }
  }

  // Strategy 3: SKU-based extraction
  if (items.length === 0) {
    const skuItems = extractSkuBased(text);
    if (skuItems.length > 0) {
      strategyUsed = 'sku_based';
      skuItems.forEach(item => {
        if (!seenDescriptions.has(item.description.toLowerCase())) {
          seenDescriptions.add(item.description.toLowerCase());
          items.push({ ...item, extractionStrategy: strategyUsed, confidence: 0.8 });
        }
      });
    }
  }

  // Strategy 4: Browser-extension style extraction (same logic as chrome extension)
  if (items.length === 0) {
    const browserItems = extractBrowserExtensionStyle(text);
    if (browserItems.length > 0) {
      strategyUsed = 'browser_extension_style';
      browserItems.forEach(item => {
        const key = `${item.description}|${item.totalCents}`.toLowerCase();
        if (!seenDescriptions.has(key)) {
          seenDescriptions.add(key);
          items.push({ ...item, extractionStrategy: strategyUsed, confidence: 0.7 });
        }
      });
    }
  }

  // Strategy 5: Price-anchor extraction (find prices, work backwards)
  if (items.length === 0) {
    const priceItems = extractPriceAnchored(text);
    if (priceItems.length > 0) {
      strategyUsed = 'price_anchored';
      priceItems.forEach(item => {
        if (!seenDescriptions.has(item.description.toLowerCase())) {
          seenDescriptions.add(item.description.toLowerCase());
          items.push({ ...item, extractionStrategy: strategyUsed, confidence: 0.6 });
        }
      });
    }
  }

  // Strategy 6: OCR-tolerant extraction (handles common OCR artifacts)
  if (items.length === 0) {
    const ocrItems = extractOCRTolerant(text);
    if (ocrItems.length > 0) {
      strategyUsed = 'ocr_tolerant';
      ocrItems.forEach(item => {
        const key = `${item.description}|${item.totalCents}`.toLowerCase();
        if (!seenDescriptions.has(key)) {
          seenDescriptions.add(key);
          items.push({ ...item, extractionStrategy: strategyUsed, confidence: 0.55 });
        }
      });
    }
  }

  // Strategy 7: Multi-line item extraction (items spanning multiple lines)
  if (items.length === 0) {
    const multiLineItems = extractMultiLineItems(text);
    if (multiLineItems.length > 0) {
      strategyUsed = 'multi_line';
      multiLineItems.forEach(item => {
        const key = `${item.description}|${item.totalCents}`.toLowerCase();
        if (!seenDescriptions.has(key)) {
          seenDescriptions.add(key);
          items.push({ ...item, extractionStrategy: strategyUsed, confidence: 0.5 });
        }
      });
    }
  }

  // Strategy 8: Fallback - extract total as single item
  if (items.length === 0) {
    const totalItem = extractTotalAsItem(text);
    if (totalItem) {
      items.push({ ...totalItem, extractionStrategy: 'total_fallback', confidence: 0.4 });
    }
  }

  // Add categories to all items (preserve if already set by vendor-specific extractor)
  return items.map(item => ({
    ...item,
    category: item.category || categorizeItem(item.description),
    sku: item.sku || extractSku(item.description)
  }));
}

/**
 * Strategy 1: Table format extraction
 * Enhanced with more patterns for common invoice layouts
 */
function extractTableFormat(text) {
  const items = [];
  const lines = text.split('\n');

  // Detect table header to understand column order
  let columnOrder = detectColumnOrder(lines);

  // Comprehensive patterns for table rows
  const patterns = [
    // Standard: QTY DESC UNIT TOTAL
    /^\s*(\d+)\s+(.{5,60}?)\s+\$?([\d,]+\.?\d{0,2})\s+\$?([\d,]+\.?\d{0,2})\s*$/,
    // QTY DESC TOTAL (no unit price)
    /^\s*(\d+)\s+(.{5,60}?)\s+\$?([\d,]+\.?\d{2})\s*$/,
    // DESC QTY UNIT TOTAL
    /^\s*(.{5,60}?)\s+(\d+)\s+\$?([\d,]+\.?\d{0,2})\s+\$?([\d,]+\.?\d{0,2})\s*$/,
    // SKU QTY DESC UNIT TOTAL (common in distributor invoices)
    /^\s*([A-Z0-9\-]{3,15})\s+(\d+)\s+(.{5,50}?)\s+\$?([\d,]+\.?\d{0,2})\s+\$?([\d,]+\.?\d{0,2})\s*$/,
    // QTY @ UNIT = TOTAL (receipt style)
    /^\s*(\d+)\s*@\s*\$?([\d,]+\.?\d{0,2})\s*=?\s*\$?([\d,]+\.?\d{2})\s+(.{5,50})/,
    // DESC x QTY TOTAL (Amazon/retail style)
    /^\s*(.{5,50}?)\s+[xX]\s*(\d+)\s+\$?([\d,]+\.?\d{2})\s*$/,
    // DESC (QTY) TOTAL
    /^\s*(.{5,50}?)\s+\((\d+)\)\s+\$?([\d,]+\.?\d{2})\s*$/,
    // TAB-separated: QTY\tDESC\tPRICE
    /^(\d+)\t+(.{5,60}?)\t+\$?([\d,]+\.?\d{2})$/,
    // Pipe-separated (PDF table extraction artifact): QTY|DESC|PRICE
    /^(\d+)\s*\|\s*(.{5,60}?)\s*\|\s*\$?([\d,]+\.?\d{2})$/
  ];

  for (const line of lines) {
    if (isLikelyTotalLine(line) || isLikelyHeaderLine(line)) continue;

    for (let pIdx = 0; pIdx < patterns.length; pIdx++) {
      const pattern = patterns[pIdx];
      const match = line.match(pattern);
      if (match) {
        let qty, desc, unitPrice, totalPrice, sku = null;

        // Parse based on pattern type
        if (pIdx === 0) {
          // QTY DESC UNIT TOTAL
          qty = parseInt(match[1]) || 1;
          desc = cleanDescription(match[2]);
          unitPrice = parsePrice(match[3]);
          totalPrice = parsePrice(match[4]);
        } else if (pIdx === 1) {
          // QTY DESC TOTAL
          qty = parseInt(match[1]) || 1;
          desc = cleanDescription(match[2]);
          totalPrice = parsePrice(match[3]);
          unitPrice = Math.round(totalPrice / qty);
        } else if (pIdx === 2) {
          // DESC QTY UNIT TOTAL
          desc = cleanDescription(match[1]);
          qty = parseInt(match[2]) || 1;
          unitPrice = parsePrice(match[3]);
          totalPrice = parsePrice(match[4]) || unitPrice * qty;
        } else if (pIdx === 3) {
          // SKU QTY DESC UNIT TOTAL
          sku = match[1].trim();
          qty = parseInt(match[2]) || 1;
          desc = cleanDescription(match[3]);
          unitPrice = parsePrice(match[4]);
          totalPrice = parsePrice(match[5]) || unitPrice * qty;
        } else if (pIdx === 4) {
          // QTY @ UNIT = TOTAL DESC
          qty = parseInt(match[1]) || 1;
          unitPrice = parsePrice(match[2]);
          totalPrice = parsePrice(match[3]);
          desc = cleanDescription(match[4]);
        } else if (pIdx === 5 || pIdx === 6) {
          // DESC x QTY TOTAL or DESC (QTY) TOTAL
          desc = cleanDescription(match[1]);
          qty = parseInt(match[2]) || 1;
          totalPrice = parsePrice(match[3]);
          unitPrice = Math.round(totalPrice / qty);
        } else {
          // TAB or pipe separated
          qty = parseInt(match[1]) || 1;
          desc = cleanDescription(match[2]);
          totalPrice = parsePrice(match[3]);
          unitPrice = Math.round(totalPrice / qty);
        }

        if (isValidItem(desc, totalPrice || unitPrice)) {
          items.push({
            description: desc,
            quantity: qty,
            unitPriceCents: unitPrice || Math.round(totalPrice / qty),
            totalCents: totalPrice || unitPrice * qty,
            sku: sku
          });
        }
        break;
      }
    }
  }

  return items;
}

/**
 * Strategy 2: Line by line extraction
 */
function extractLineByLine(text) {
  const items = [];
  const lines = text.split('\n');

  for (const line of lines) {
    // Skip likely header/total lines
    if (isLikelyTotalLine(line) || isLikelyHeaderLine(line)) continue;

    // Look for price at end of line
    const priceMatch = line.match(/^(.+?)\s+\$?([\d,]+\.?\d{2})\s*$/);
    if (priceMatch) {
      const desc = cleanDescription(priceMatch[1]);
      const price = parsePrice(priceMatch[2]);

      if (isValidItem(desc, price)) {
        const qty = inferQuantity(desc, line);
        items.push({
          description: desc.replace(/\s*\d+\s*(x|@|ea|each|pc|pcs)\s*/gi, '').trim(),
          quantity: qty,
          unitPriceCents: Math.round(price / qty),
          totalCents: price,
          sku: null
        });
      }
    }
  }

  return items;
}

/**
 * Strategy 3: SKU-based extraction
 */
function extractSkuBased(text) {
  const items = [];

  // Pattern: SKU/Part# followed by description and price
  const pattern = /([A-Z0-9][\w\-]{2,15})\s+([A-Za-z][A-Za-z0-9\s\-\.,]{4,45}?)\s+\$?([\d,]+\.?\d{0,2})/g;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const sku = match[1].trim();
    const desc = cleanDescription(match[2]);
    const price = parsePrice(match[3]);

    // Validate SKU looks like a real SKU (not a date, phone, etc)
    if (isValidSku(sku) && isValidItem(desc, price)) {
      items.push({
        description: desc,
        quantity: 1,
        unitPriceCents: price,
        totalCents: price,
        sku: sku
      });
    }
  }

  return items;
}

/**
 * Strategy 4: Price-anchored extraction
 */
function extractPriceAnchored(text) {
  const items = [];

  // Find all prices first
  const pricePattern = /\$?([\d,]+\.?\d{2})\b/g;
  const lines = text.split('\n');

  for (const line of lines) {
    if (isLikelyTotalLine(line)) continue;

    const priceMatch = line.match(/\$?([\d,]+\.?\d{2})/);
    if (priceMatch) {
      const price = parsePrice(priceMatch[1]);
      if (price > 0 && price < 10000000) { // Max $100k per item
        // Get text before price as description
        const beforePrice = line.substring(0, line.indexOf(priceMatch[0])).trim();
        const desc = cleanDescription(beforePrice);

        if (desc.length >= 3 && !isLikelyTotalLine(desc)) {
          items.push({
            description: desc,
            quantity: inferQuantity(desc, line),
            unitPriceCents: price,
            totalCents: price,
            sku: null
          });
        }
      }
    }
  }

  return items;
}

/**
 * Strategy 6: OCR-tolerant extraction
 * Handles common OCR artifacts like confused characters (0/O, 1/l, etc.)
 */
function extractOCRTolerant(text) {
  const items = [];
  const lines = text.split('\n');

  // Normalize common OCR errors
  const normalizedText = text
    .replace(/[|l]/g, '1') // pipe and lowercase L often misread as 1
    .replace(/O(?=\d)/g, '0') // O followed by digit is likely 0
    .replace(/(?<=\d)O/g, '0') // digit followed by O is likely 0
    .replace(/S(?=\d{2,})/g, '5') // S followed by digits might be 5
    .replace(/\s{2,}/g, ' '); // Multiple spaces to single

  const normalizedLines = normalizedText.split('\n');

  // More relaxed price pattern for OCR text
  const ocrPricePatterns = [
    // Standard: $12.34 or 12.34
    /\$?\s*([\d,]+\.[\d]{2})\s*$/,
    // With OCR artifacts: $ 12 . 34 or 12 , 34
    /\$?\s*([\d\s,]+[\.\,]\s*[\d]{2})\s*$/,
    // Price with units: 12.34 EA or 12.34/ea
    /\$?\s*([\d,]+\.[\d]{2})\s*(?:ea|each|pc|\/ea|\/each)?\s*$/i
  ];

  for (let i = 0; i < normalizedLines.length; i++) {
    const line = normalizedLines[i].trim();
    if (line.length < 5) continue;
    if (isLikelyTotalLine(line) || isLikelyHeaderLine(line)) continue;

    for (const pattern of ocrPricePatterns) {
      const match = line.match(pattern);
      if (match) {
        // Clean up OCR'd price string
        const priceStr = match[1].replace(/\s+/g, '').replace(/,(?=\d{2}$)/, '.');
        const price = parsePrice(priceStr);

        if (price > 0 && price < 10000000) {
          const descPart = line.substring(0, line.lastIndexOf(match[0])).trim();
          const desc = cleanOCRDescription(descPart);

          if (desc.length >= 3 && !isLikelyTotalLine(desc)) {
            items.push({
              description: desc,
              quantity: inferQuantity(desc, line),
              unitPriceCents: price,
              totalCents: price,
              sku: extractSku(desc)
            });
          }
        }
        break;
      }
    }
  }

  return items;
}

/**
 * Strategy 7: Multi-line item extraction
 * Handles invoices where item descriptions span multiple lines
 */
function extractMultiLineItems(text) {
  const items = [];
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  let currentItem = null;
  let descriptionLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip totals and headers
    if (isLikelyTotalLine(line) || isLikelyHeaderLine(line)) {
      // Save any pending item
      if (currentItem && currentItem.totalCents > 0) {
        items.push(currentItem);
      }
      currentItem = null;
      descriptionLines = [];
      continue;
    }

    // Check if line ends with a price
    const priceMatch = line.match(/\$?([\d,]+\.[\d]{2})\s*$/);

    if (priceMatch) {
      const price = parsePrice(priceMatch[1]);

      // Save previous item if any
      if (currentItem && currentItem.totalCents > 0) {
        items.push(currentItem);
      }

      // Get description from this line (before price)
      const descOnLine = line.substring(0, line.indexOf(priceMatch[0])).trim();

      // Check if previous lines might be part of description (if they have no price)
      let fullDesc = descOnLine;
      if (descriptionLines.length > 0 && descOnLine.length < 20) {
        // Short desc on price line - combine with accumulated desc
        fullDesc = [...descriptionLines, descOnLine].join(' ').trim();
      }

      const cleanDesc = cleanDescription(fullDesc);

      if (cleanDesc.length >= 3 && price > 0) {
        currentItem = {
          description: cleanDesc,
          quantity: inferQuantity(cleanDesc, line),
          unitPriceCents: price,
          totalCents: price,
          sku: extractSku(cleanDesc)
        };
      }

      descriptionLines = [];
    } else {
      // Line without price - might be continuation of description
      if (line.length >= 3 && line.length <= 100 && !/^\d+$/.test(line)) {
        descriptionLines.push(line);
      }
    }
  }

  // Don't forget last item
  if (currentItem && currentItem.totalCents > 0) {
    items.push(currentItem);
  }

  return items;
}

/**
 * Clean OCR'd description with common artifact fixes
 */
function cleanOCRDescription(desc) {
  if (!desc) return '';

  return desc
    // Fix common OCR character confusions in words
    .replace(/\b0nly\b/gi, 'Only')
    .replace(/\bl\b(?=[A-Za-z])/g, 'I') // Standalone l followed by letter is likely I
    .replace(/\b(\d+)\s*[xX×]\s*/g, '') // Remove quantity indicators
    .replace(/\bqty[:\s]*\d+\b/gi, '')
    .replace(/[^\w\s\-\.,&\/\#\(\)\'\"]/g, ' ') // Remove unusual chars
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 200);
}

/**
 * Strategy 0: Vendor-specific format extraction
 * Handles known vendor invoice formats (Cintas, Sysco, US Foods, etc.)
 * Uses the same logic approach as the browser extension for consistency
 *
 * IMPORTANT: For Cintas invoices, we ONLY extract employee subtotals (not individual
 * garment line items) because the subtotals are roll-ups of the line items.
 * Extracting both would cause double-counting.
 */
function extractVendorSpecificFormat(text) {
  const items = [];
  const textLower = text.toLowerCase();

  // ===== CINTAS FORMAT =====
  // Cintas uniform invoices structure:
  // - Individual garment items per employee (X59294, X61356, etc.)
  // - Employee SUBTOTAL lines that SUM the garments above
  // - UNIFORM ADVANTAGE fees (separate line items, NOT included in employee subtotals)
  // - Department SUBTOTAL (sum of employee subtotals in that dept)
  // - Final SUBTOTAL (before tax)
  // - SALES TAX
  // - TOTAL USD
  //
  // To avoid double-counting, we extract ONLY:
  // 1. Employee subtotals (rolled-up uniform costs per employee)
  // 2. UNIFORM ADVANTAGE fees (these are SEPARATE from employee subtotals)
  // 3. Facility items (mats, mops - usually non-taxable "N" items)
  //
  // We DO NOT extract individual garment lines because they're already
  // included in employee subtotals.
  if (textLower.includes('cintas') || /X\d{5}/.test(text)) {

    // 1. Extract employee subtotals (most reliable for uniform services)
    // Pattern: "LEVI HENDRIX SUBTOTAL - 18.46" or "0001 LEVI HENDRIX SUBTOTAL - 18.46"
    // Use [A-Z ,.'-] without \s to avoid matching across newlines
    const subtotalPattern = /([A-Z][A-Z ,.'\-]+?)\s+SUBTOTAL\s*-?\s*([\d,\.]+)/g;
    let match;
    const seenEmployees = new Set();

    while ((match = subtotalPattern.exec(text)) !== null) {
      const empName = match[1].trim();
      const subtotal = parsePrice(match[2]);

      // Skip department/bulk subtotals and already-seen employees
      const empNameUpper = empName.toUpperCase();
      // Must be a valid employee name: typically 2-3 words, each 2+ chars
      // Examples: "MARK HOWELL", "JOHN SMITH JR", "MARY O'BRIEN"
      const nameParts = empNameUpper.trim().split(/\s+/).filter(p => p.length >= 2);
      const looksLikeEmployee = nameParts.length >= 2 && nameParts.length <= 4 &&
                                 empName.length <= 40;  // Employee names shouldn't be too long

      if (subtotal > 0 && empName.length >= 3 && looksLikeEmployee &&
          !empNameUpper.includes('INVOICE') &&
          !empNameUpper.includes('BULK') &&
          !empNameUpper.includes('FR DEPT') &&
          !empNameUpper.includes('IT SUBTOTAL') &&
          !empNameUpper.includes('CORPORATION') &&
          !empNameUpper.includes('COMPANY') &&
          !empNameUpper.includes('INC') &&
          !empNameUpper.includes('LLC') &&
          !empNameUpper.includes('CINTAS') &&
          !empNameUpper.startsWith('IT ') &&
          !empNameUpper.startsWith('DEPT') &&
          !empNameUpper.startsWith('N ') &&
          !/^[A-Z]\s+[A-Z]{1,3}$/.test(empNameUpper) && // Skip things like "N IT"
          !seenEmployees.has(empNameUpper)) {
        seenEmployees.add(empNameUpper);
        items.push({
          description: `Uniform Service - ${empName}`,
          quantity: 1,
          unitPriceCents: subtotal,
          totalCents: subtotal,
          sku: null,
          category: 'uniform_service'
        });
      }
    }

    // 2. Extract facility items (mats, mops, towels - usually marked with "N" for no tax)
    // Pattern: X##### DESCRIPTION 01 F QTY PRICE TOTAL N
    const facilityPattern = /^(X\d{4,6})\s+([A-Z0-9\s\/\-"]+?)\s+01\s+F\s+(\d+)\s+([\d\.]+)\s+([\d\.]+)\s+N$/gm;
    let facilityMatch;
    while ((facilityMatch = facilityPattern.exec(text)) !== null) {
      const sku = facilityMatch[1];
      const desc = facilityMatch[2].trim();
      const qty = parseInt(facilityMatch[3]) || 1;
      const unitPrice = parsePrice(facilityMatch[4]);
      const lineTotal = parsePrice(facilityMatch[5]);

      // Only include facility items (mats, mops, towels, wipes) not employee garments
      const descLower = desc.toLowerCase();
      if (lineTotal > 0 &&
          (descLower.includes('mat') || descLower.includes('mop') ||
           descLower.includes('towel') || descLower.includes('wipe') ||
           descLower.includes('xtrac'))) {
        items.push({
          description: desc,
          quantity: qty,
          unitPriceCents: unitPrice,
          totalCents: lineTotal,
          sku: sku,
          category: 'facility_services'
        });
      }
    }

    // 3. Extract UNIFORM ADVANTAGE fees
    // These appear as standalone lines: "UNIFORM ADVANTAGE 104.48 Y"
    // They are SEPARATE from employee subtotals and must be included
    // Note: There can be multiple UNIFORM ADVANTAGE entries (e.g., per department)
    const uniformAdvPattern = /^\s*UNIFORM\s+ADVANTAGE\s+([\d,\.]+)\s+Y$/gm;
    let uaMatch;
    let uniformAdvTotal = 0;
    while ((uaMatch = uniformAdvPattern.exec(text)) !== null) {
      uniformAdvTotal += parsePrice(uaMatch[1]);
    }
    if (uniformAdvTotal > 0) {
      items.push({
        description: 'Uniform Advantage Fee',
        quantity: 1,
        unitPriceCents: uniformAdvTotal,
        totalCents: uniformAdvTotal,
        sku: null,
        category: 'fees'
      });
    }

    // 4. Extract other Cintas fee items (if present)
    // EMBLEM ADVANTAGE, PREP ADVANTAGE, SERVICE CHARGE
    const otherFeePatterns = [
      { pattern: /^\s*EMBLEM\s+ADVANTAGE\s+([\d,\.]+)\s+Y$/gm, name: 'Emblem Advantage Fee' },
      { pattern: /^\s*PREP\s+ADVANTAGE\s+([\d,\.]+)\s+Y$/gm, name: 'Prep Advantage Fee' },
      { pattern: /^\s*SERVICE\s+CHARGE\s+([\d,\.]+)\s+Y$/gm, name: 'Service Charge' }
    ];

    for (const { pattern, name } of otherFeePatterns) {
      let feeMatch;
      let feeTotal = 0;
      while ((feeMatch = pattern.exec(text)) !== null) {
        feeTotal += parsePrice(feeMatch[1]);
      }
      if (feeTotal > 0) {
        items.push({
          description: name,
          quantity: 1,
          unitPriceCents: feeTotal,
          totalCents: feeTotal,
          sku: null,
          category: 'fees'
        });
      }
    }

    // If we found items, return them
    if (items.length > 0) {
      return items;
    }
  }

  // ===== SYSCO / US FOODS / FOOD DISTRIBUTOR FORMAT =====
  if (textLower.includes('sysco') || textLower.includes('us foods') || textLower.includes('food service') || textLower.includes('produce')) {
    const foodPattern = /(\d{6,8})\s+([A-Za-z][A-Za-z0-9\s\-\/\.,]{5,50}?)\s+(\d+)\s*\/\s*([A-Z0-9]+)\s+(\d+)\s+\$?([\d,\.]+)\s+\$?([\d,\.]+)/g;
    let match;

    while ((match = foodPattern.exec(text)) !== null) {
      const sku = match[1];
      const desc = cleanDescription(match[2]);
      const qty = parseInt(match[5]) || 1;
      const unitPrice = parsePrice(match[6]);
      const lineTotal = parsePrice(match[7]);

      if (desc.length >= 3 && lineTotal > 0) {
        items.push({
          description: desc,
          quantity: qty,
          unitPriceCents: unitPrice,
          totalCents: lineTotal,
          sku: sku,
          category: 'food_supplies'
        });
      }
    }

    if (items.length > 0) return items;
  }

  return items;
}

/**
 * Browser-extension style extraction
 * Same logic as chrome-extension/background.js for consistency
 */
function extractBrowserExtensionStyle(text) {
  const items = [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length >= 6);

  // Price pattern: $12.34 or 12.34
  const moneyRe = /\$?([\d,]+\.?\d{2})\b/;

  for (const line of lines) {
    // Skip total/header lines
    if (isLikelyTotalLine(line) || isLikelyHeaderLine(line)) continue;

    const m = line.match(moneyRe);
    if (!m) continue;

    const price = parsePrice(m[1]);
    if (price <= 0 || price > 10000000) continue;

    // Infer quantity
    let quantity = 1;
    const mult = line.match(/\b(\d+)\s*[xX]\b/);
    if (mult) quantity = parseInt(mult[1], 10) || 1;

    const qtyMatch = line.match(/\bqty[:\s]*(\d+)\b/i) || line.match(/\bquantity[:\s]*(\d+)\b/i);
    if (qtyMatch) quantity = parseInt(qtyMatch[1], 10) || 1;

    // Extract description: text before the price
    let desc = line.substring(0, line.indexOf(m[0])).trim();

    // Clean up description
    desc = desc
      .replace(/\b\d+\s*[xX]\b/, '') // Remove "2 x"
      .replace(/\bqty[:\s]*\d+\b/i, '') // Remove "qty 2"
      .replace(/\bquantity[:\s]*\d+\b/i, '') // Remove "quantity 2"
      .replace(/\s+/g, ' ')
      .trim();

    if (desc.length < 3) continue;
    if (isLikelyTotalLine(desc)) continue;

    items.push({
      description: desc,
      quantity: quantity,
      unitPriceCents: Math.round(price / quantity),
      totalCents: price,
      sku: extractSku(desc)
    });

    if (items.length >= 200) break;
  }

  return items;
}

// ============ TOTALS EXTRACTION ============

/**
 * Extract invoice totals from text
 * @param {string} text
 * @returns {Object} totals object with subtotal, tax, total in cents
 */
function extractTotals(text) {
  const totals = {
    subtotalCents: 0,
    taxCents: 0,
    taxRate: null,
    shippingCents: 0,
    discountCents: 0,
    totalCents: 0
  };

  // Grand total patterns (most specific to least)
  // Cintas uses "TOTAL USD" format
  const totalPatterns = [
    /TOTAL\s+USD[:\s]*\$?([\d,]+\.?\d{0,2})/i,  // Cintas format
    /(?:grand\s*total|total\s*amount|amount\s*due|balance\s*due|total\s*due)[:\s]*\$?([\d,]+\.?\d{0,2})/i,
    /(?:^|\s)total[:\s]+\$?([\d,]+\.?\d{2})(?:\s|$)/im,
    /\$?([\d,]+\.?\d{2})\s*(?:total|due)(?:\s|$)/i
  ];

  for (const pattern of totalPatterns) {
    const match = text.match(pattern);
    if (match) {
      const total = parsePrice(match[1]);
      if (total > totals.totalCents) {
        totals.totalCents = total;
      }
      break;
    }
  }

  // Subtotal - look for standalone SUBTOTAL (not IT SUBTOTAL or employee SUBTOTAL)
  // For Cintas, we want the final "SUBTOTAL 2248.11" not "IT SUBTOTAL 22.75" or department subtotals
  // Use matchAll to find ALL subtotal values and keep the largest (which is typically the final invoice subtotal)
  const subtotalPatterns = [
    /(?:^|\n)\s*SUBTOTAL\s*\$?([\d,]+\.?\d{0,2})/gim,  // SUBTOTAL at line start (global)
    /(?:^|\n)\s*SUB[\s\-]?TOTAL[:\s]*\$?([\d,]+\.?\d{0,2})/gim  // SUB-TOTAL or SUB TOTAL at line start (global)
  ];
  for (const pattern of subtotalPatterns) {
    const matches = [...text.matchAll(pattern)];
    for (const match of matches) {
      const subtotal = parsePrice(match[1]);
      // Keep the larger subtotal (for multi-section invoices, the final total is usually largest)
      if (subtotal > totals.subtotalCents) {
        totals.subtotalCents = subtotal;
      }
    }
  }

  // Tax (with optional rate)
  // Cintas uses "SALES TAX 91.38" format without dollar sign
  const taxPatterns = [
    /SALES\s+TAX[:\s]*([\d,]+\.?\d{0,2})/i,  // Cintas format
    /(?:sales\s*tax|tax)\s*\(?(\d+\.?\d*)%?\)?[:\s]*\$?([\d,]+\.?\d{0,2})/i,
    /(?:tax|vat)[:\s]*\$?([\d,]+\.?\d{0,2})/i
  ];
  for (const pattern of taxPatterns) {
    const match = text.match(pattern);
    if (match) {
      // Handle different capture group scenarios
      if (match[2]) {
        totals.taxRate = parseFloat(match[1]);
        totals.taxCents = parsePrice(match[2]);
      } else {
        totals.taxCents = parsePrice(match[1]);
      }
      break;
    }
  }

  // Shipping/Freight
  const shippingMatch = text.match(/(?:shipping|freight|delivery|s&h)[:\s]*\$?([\d,]+\.?\d{0,2})/i);
  if (shippingMatch) {
    totals.shippingCents = parsePrice(shippingMatch[1]);
  }

  // Discount
  const discountMatch = text.match(/(?:discount|savings|promo)[:\s]*-?\$?([\d,]+\.?\d{0,2})/i);
  if (discountMatch) {
    totals.discountCents = parsePrice(discountMatch[1]);
  }

  return totals;
}

// ============ VENDOR EXTRACTION ============

/**
 * Extract vendor information from invoice text
 * @param {string} text
 * @returns {Object} vendor info with confidence
 */
function extractVendor(text) {
  const vendor = {
    name: null,
    address: null,
    city: null,
    state: null,
    zip: null,
    phone: null,
    email: null,
    website: null,
    confidence: 0
  };

  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Look for "From:" or "Vendor:" section
  const fromMatch = text.match(/(?:from|vendor|seller|sold\s*by)[:\s]*\n?([A-Za-z][A-Za-z0-9\s\-\.,&']{2,50})/i);
  if (fromMatch) {
    vendor.name = fromMatch[1].trim();
    vendor.confidence = 0.9;
  }

  // Otherwise, first substantial line that looks like a company name
  if (!vendor.name) {
    for (const line of lines.slice(0, 10)) {
      if (line.length >= 3 && line.length <= 60 &&
          /^[A-Z]/.test(line) &&
          !line.match(/invoice|bill|order|date|number|#|total/i)) {
        vendor.name = line;
        vendor.confidence = 0.6;
        break;
      }
    }
  }

  // Phone number
  const phoneMatch = text.match(/(?:phone|tel|ph)[:\s]*([\d\-\(\)\s\.]{10,20})/i) ||
                     text.match(/\b(\(\d{3}\)\s*\d{3}[\-\.\s]?\d{4})\b/) ||
                     text.match(/\b(\d{3}[\-\.\s]\d{3}[\-\.\s]\d{4})\b/);
  if (phoneMatch) {
    vendor.phone = phoneMatch[1].replace(/\s+/g, '').trim();
  }

  // Email
  const emailMatch = text.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,})/);
  if (emailMatch) {
    vendor.email = emailMatch[1].toLowerCase();
  }

  // Website
  const websiteMatch = text.match(/(?:www\.[a-zA-Z0-9\-]+\.[a-zA-Z]{2,}|https?:\/\/[a-zA-Z0-9\-\.]+\.[a-zA-Z]{2,})/i);
  if (websiteMatch) {
    vendor.website = websiteMatch[0].toLowerCase();
  }

  return vendor;
}

// ============ CUSTOMER EXTRACTION ============

/**
 * Extract customer/ship-to information
 * @param {string} text
 * @returns {Object} customer info
 */
function extractCustomer(text) {
  const customer = {
    name: null,
    company: null,
    address: null,
    city: null,
    state: null,
    zip: null,
    confidence: 0
  };

  // Look for SHIP TO section (highest priority)
  const shipToMatch = text.match(/ship\s*to[:\s]*\n?([A-Za-z][A-Za-z0-9\s\-\.,&']{2,50})/i);
  if (shipToMatch) {
    customer.name = shipToMatch[1].trim();
    customer.confidence = 0.9;
  }

  // Look for BILL TO section
  if (!customer.name) {
    const billToMatch = text.match(/bill\s*to[:\s]*\n?([A-Za-z][A-Za-z0-9\s\-\.,&']{2,50})/i);
    if (billToMatch) {
      customer.name = billToMatch[1].trim();
      customer.confidence = 0.85;
    }
  }

  // Look for SOLD TO or CUSTOMER section
  if (!customer.name) {
    const soldToMatch = text.match(/(?:sold\s*to|customer)[:\s]*\n?([A-Za-z][A-Za-z0-9\s\-\.,&']{2,50})/i);
    if (soldToMatch) {
      customer.name = soldToMatch[1].trim();
      customer.confidence = 0.8;
    }
  }

  // Extract address components - look for city, state, zip pattern
  const cityStateZipMatch = text.match(/([A-Za-z\s]{2,30}),?\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?/);
  if (cityStateZipMatch) {
    customer.city = cityStateZipMatch[1].trim();
    customer.state = cityStateZipMatch[2];
    customer.zip = cityStateZipMatch[3];
  } else {
    // Just try to find ZIP
    const zipMatch = text.match(/\b(\d{5})(?:-\d{4})?\b/);
    if (zipMatch) {
      customer.zip = zipMatch[1];
    }
  }

  return customer;
}

// ============ METADATA EXTRACTION ============

/**
 * Extract invoice metadata (number, date, etc)
 * @param {string} text
 * @returns {Object} metadata
 */
function extractMetadata(text) {
  const metadata = {
    invoiceNumber: null,
    invoiceDate: null,
    dueDate: null,
    poNumber: null,
    orderNumber: null,
    terms: null
  };

  // Invoice number
  const invoicePatterns = [
    /invoice\s*(?:#|no\.?|number)?[:\s]*([A-Z0-9\-]{3,20})/i,
    /inv[#:\s]+([A-Z0-9\-]{3,20})/i
  ];
  for (const pattern of invoicePatterns) {
    const match = text.match(pattern);
    if (match) {
      metadata.invoiceNumber = match[1].trim();
      break;
    }
  }

  // Invoice date
  const datePatterns = [
    /(?:invoice\s*date|date)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /(?:invoice\s*date|date)[:\s]*([A-Za-z]+\.?\s+\d{1,2},?\s+\d{4})/i,
    /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/
  ];
  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (match) {
      metadata.invoiceDate = match[1].trim();
      break;
    }
  }

  // Due date
  const dueMatch = text.match(/(?:due\s*date|payment\s*due|due)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
  if (dueMatch) {
    metadata.dueDate = dueMatch[1].trim();
  }

  // PO Number
  const poMatch = text.match(/(?:p\.?o\.?\s*(?:#|no\.?|number)?|purchase\s*order)[:\s]*([A-Z0-9\-]{3,20})/i);
  if (poMatch) {
    metadata.poNumber = poMatch[1].trim();
  }

  // Order Number
  const orderMatch = text.match(/(?:order\s*(?:#|no\.?|number)?)[:\s]*([A-Z0-9\-]{3,20})/i);
  if (orderMatch) {
    metadata.orderNumber = orderMatch[1].trim();
  }

  // Payment terms
  const termsMatch = text.match(/(?:terms|payment\s*terms)[:\s]*(net\s*\d+|due\s*on\s*receipt|cod|prepaid)/i);
  if (termsMatch) {
    metadata.terms = termsMatch[1].trim();
  }

  return metadata;
}

// ============ CONFIDENCE SCORING ============

/**
 * Calculate confidence scores for extracted data
 */
function calculateConfidence(items, totals, vendor, customer, text) {
  const scores = {
    overall: 0,
    items: 0,
    totals: 0,
    parties: 0,
    reasons: []
  };

  // Items confidence
  if (items.length > 0) {
    const avgItemConfidence = items.reduce((sum, i) => sum + (i.confidence || 0.5), 0) / items.length;
    scores.items = avgItemConfidence;

    // Bonus for multiple items (more likely a real invoice)
    if (items.length >= 3) scores.items = Math.min(1, scores.items + 0.1);

    // Bonus for items with SKUs
    const skuRatio = items.filter(i => i.sku).length / items.length;
    scores.items = Math.min(1, scores.items + skuRatio * 0.1);
  }

  // Totals confidence
  if (totals.totalCents > 0) {
    scores.totals = 0.5;

    // Check if items sum matches total (±5%)
    const itemsSum = items.reduce((sum, i) => sum + i.totalCents, 0);
    if (itemsSum > 0) {
      const diff = Math.abs(totals.totalCents - itemsSum) / totals.totalCents;
      if (diff < 0.05) {
        scores.totals = 0.95;
        scores.reasons.push('Items sum matches total');
      } else if (diff < 0.15) {
        scores.totals = 0.7;
        scores.reasons.push('Items sum close to total (within 15%)');
      }
    }

    // Has subtotal and tax
    if (totals.subtotalCents > 0) scores.totals = Math.min(1, scores.totals + 0.1);
    if (totals.taxCents > 0) scores.totals = Math.min(1, scores.totals + 0.1);
  }

  // Parties confidence
  if (vendor.name) scores.parties += 0.3;
  if (vendor.phone || vendor.email) scores.parties += 0.1;
  if (customer.name) scores.parties += 0.3;
  if (customer.zip) scores.parties += 0.2;
  if (customer.city && customer.state) scores.parties += 0.1;

  // Overall score (weighted average)
  scores.overall = (scores.items * 0.4 + scores.totals * 0.3 + scores.parties * 0.3);

  return scores;
}

// ============ OPPORTUNITY DETECTION ============

/**
 * Detect potential opportunities from invoice data
 * This is the "money-maker" for sales reps
 */
function detectOpportunities(items, totals, vendor, text) {
  const opportunities = [];

  // 1. High-value items (potential for upsell/volume discount)
  items.forEach(item => {
    if (item.totalCents >= 100000) { // $1000+
      opportunities.push({
        type: 'high_value_item',
        severity: 'info',
        description: `High-value item: ${item.description}`,
        itemDescription: item.description,
        amount: item.totalCents,
        suggestion: 'Check if volume discounts or alternatives available'
      });
    }
  });

  // 2. Repeat/recurring items (subscription or regular order patterns)
  const descWords = {};
  items.forEach(item => {
    const words = item.description.toLowerCase().split(/\s+/);
    words.forEach(w => {
      if (w.length > 3) descWords[w] = (descWords[w] || 0) + 1;
    });
  });

  // 3. Price anomalies - items with unusual unit prices
  const unitPrices = items.map(i => i.unitPriceCents).filter(p => p > 0);
  if (unitPrices.length >= 3) {
    const avgPrice = unitPrices.reduce((a, b) => a + b, 0) / unitPrices.length;
    items.forEach(item => {
      if (item.unitPriceCents > avgPrice * 3) {
        opportunities.push({
          type: 'price_anomaly',
          severity: 'warning',
          description: `Unusually high price for: ${item.description}`,
          itemDescription: item.description,
          amount: item.unitPriceCents,
          averageAmount: Math.round(avgPrice),
          suggestion: 'Verify pricing - may be overcharge or premium item'
        });
      }
    });
  }

  // 4. Large quantity items (bulk buying - potential for better pricing)
  items.forEach(item => {
    if (item.quantity >= 10) {
      opportunities.push({
        type: 'bulk_purchase',
        severity: 'info',
        description: `Bulk purchase detected: ${item.quantity}x ${item.description}`,
        itemDescription: item.description,
        quantity: item.quantity,
        suggestion: 'Negotiate volume pricing or check for bulk discounts'
      });
    }
  });

  // 5. No discount applied on large order
  if (totals.totalCents >= 500000 && totals.discountCents === 0) { // $5000+
    opportunities.push({
      type: 'missing_discount',
      severity: 'warning',
      description: 'Large order with no discount applied',
      amount: totals.totalCents,
      suggestion: 'Negotiate discount for orders over $5000'
    });
  }

  // 6. High shipping cost ratio
  if (totals.shippingCents > 0 && totals.subtotalCents > 0) {
    const shippingRatio = totals.shippingCents / totals.subtotalCents;
    if (shippingRatio > 0.1) { // >10% shipping
      opportunities.push({
        type: 'high_shipping',
        severity: 'warning',
        description: `Shipping cost is ${Math.round(shippingRatio * 100)}% of order`,
        shippingAmount: totals.shippingCents,
        subtotal: totals.subtotalCents,
        suggestion: 'Consider consolidating orders or negotiating shipping rates'
      });
    }
  }

  // 7. Check for services that could be recurring
  items.forEach(item => {
    const desc = item.description.toLowerCase();
    if (/service|maintenance|support|subscription|license|consulting/.test(desc)) {
      opportunities.push({
        type: 'recurring_potential',
        severity: 'info',
        description: `Service item detected: ${item.description}`,
        itemDescription: item.description,
        amount: item.totalCents,
        suggestion: 'Confirm recurring billing setup or contract terms'
      });
    }
  });

  return opportunities;
}

// ============ VALIDATION ============

/**
 * Cross-validate extraction results
 */
function validateExtraction(items, totals) {
  const validation = {
    isValid: true,
    warnings: [],
    errors: []
  };

  // Check items sum vs total
  const itemsSum = items.reduce((sum, i) => sum + i.totalCents, 0);
  if (itemsSum > 0 && totals.totalCents > 0) {
    const diff = Math.abs(totals.totalCents - itemsSum);
    const diffPercent = diff / totals.totalCents;

    if (diffPercent > 0.20) {
      validation.warnings.push(`Items sum ($${(itemsSum/100).toFixed(2)}) differs from total ($${(totals.totalCents/100).toFixed(2)}) by ${Math.round(diffPercent*100)}%`);
    }
  }

  // Check for suspiciously round numbers
  items.forEach(item => {
    if (item.unitPriceCents % 10000 === 0 && item.unitPriceCents >= 10000) {
      validation.warnings.push(`Suspiciously round price for "${item.description}": $${(item.unitPriceCents/100).toFixed(2)}`);
    }
  });

  // Check for negative amounts
  items.forEach(item => {
    if (item.totalCents < 0) {
      validation.errors.push(`Negative amount for "${item.description}"`);
      validation.isValid = false;
    }
  });

  return validation;
}

// ============ HELPER FUNCTIONS ============

function normalizeText(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, '  ')
    .replace(/\u00A0/g, ' ') // Non-breaking space
    .replace(/\s{3,}/g, '  ');
}

function parsePrice(priceStr) {
  if (!priceStr) return 0;
  const cleaned = String(priceStr).replace(/[,$\s]/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num)) return 0;
  return Math.round(num * 100);
}

function cleanDescription(desc) {
  if (!desc) return '';
  return desc
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s\-\.,&\/\#\(\)]/g, '')
    .trim()
    .slice(0, 200);
}

function isValidItem(description, priceCents) {
  if (!description || description.length < 3) return false;
  if (priceCents <= 0 || priceCents > 100000000) return false;
  if (isLikelyTotalLine(description)) return false;
  if (isLikelyHeaderLine(description)) return false;
  return true;
}

function isLikelyTotalLine(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  const keywords = ['total', 'subtotal', 'sub-total', 'tax', 'shipping', 'freight',
                    'balance', 'amount due', 'discount', 'payment', 'paid', 'credit'];
  return keywords.some(kw => lower.includes(kw));
}

function isLikelyHeaderLine(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  const headers = ['description', 'qty', 'quantity', 'price', 'amount', 'item', 'unit', 'sku', 'part'];
  const matches = headers.filter(h => lower.includes(h));
  return matches.length >= 2;
}

function extractSku(text) {
  if (!text) return null;
  const patterns = [
    /\b([A-Z]{2,4}[\-]?\d{3,8})\b/,
    /\b(\d{5,12})\b/,
    /\b([A-Z0-9]{6,12})\b/
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && isValidSku(match[1])) {
      return match[1];
    }
  }
  return null;
}

function isValidSku(sku) {
  if (!sku || sku.length < 3 || sku.length > 20) return false;
  // Exclude things that look like dates, phone numbers, etc
  if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(sku)) return false;
  if (/^\d{10,}$/.test(sku)) return false;
  return true;
}

function inferQuantity(description, line) {
  const patterns = [
    /(\d+)\s*[xX]\s/,
    /(\d+)\s*@/,
    /qty[:\s]*(\d+)/i,
    /(\d+)\s*(?:ea|each|pc|pcs|units?)/i
  ];

  const searchText = line || description;
  for (const pattern of patterns) {
    const match = searchText.match(pattern);
    if (match) {
      const qty = parseInt(match[1]);
      if (qty > 0 && qty < 10000) return qty;
    }
  }
  return 1;
}

function detectColumnOrder(lines) {
  // Simple heuristic - look for header row
  for (const line of lines.slice(0, 20)) {
    const lower = line.toLowerCase();
    if (lower.includes('qty') || lower.includes('quantity')) {
      if (lower.includes('description') || lower.includes('item')) {
        return 'detected';
      }
    }
  }
  return 'default';
}

function categorizeItem(description) {
  if (!description) return 'general';
  const desc = description.toLowerCase();

  const categories = [
    { pattern: /food|produce|meat|dairy|vegetable|fruit|bread|beverage|coffee|tea|juice|milk|cheese|egg/, category: 'food_supplies' },
    { pattern: /equipment|machine|tool|hardware|appliance|device|printer|computer/, category: 'equipment' },
    { pattern: /service|labor|maintenance|repair|install|consult|professional/, category: 'services' },
    { pattern: /shipping|freight|delivery|transport|handling|postage/, category: 'shipping' },
    { pattern: /license|subscription|software|saas|cloud|hosting|domain/, category: 'software' },
    { pattern: /paper|pen|office|supplies|toner|ink|staple|folder|binder/, category: 'office_supplies' },
    { pattern: /clean|sanit|soap|detergent|chemical|disinfect/, category: 'cleaning' },
    { pattern: /rent|lease|space|facility|utilities/, category: 'facilities' },
    { pattern: /insurance|premium|coverage|policy/, category: 'insurance' },
    { pattern: /marketing|advertising|promo|campaign/, category: 'marketing' }
  ];

  for (const { pattern, category } of categories) {
    if (pattern.test(desc)) return category;
  }

  return 'general';
}

function extractTotalAsItem(text) {
  const patterns = [
    /(?:grand\s*total|total\s*due|amount\s*due|balance\s*due|total)[:\s]*\$?([\d,]+\.?\d{0,2})/i,
    /\$?([\d,]+\.?\d{2})\s*(?:total|due)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const totalCents = parsePrice(match[1]);
      if (totalCents > 0) {
        return {
          description: 'Invoice Total',
          quantity: 1,
          unitPriceCents: totalCents,
          totalCents: totalCents,
          sku: null
        };
      }
    }
  }
  return null;
}

// ============ EXPORTS ============

module.exports = {
  parseInvoice,
  extractLineItems,
  extractTotals,
  extractVendor,
  extractCustomer,
  extractMetadata,
  detectOpportunities,
  calculateConfidence,
  categorizeItem,
  parsePrice
};
