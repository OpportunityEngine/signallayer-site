/**
 * Invoice Parsing V2 - Sysco Parser
 * Specialized parser for Sysco Food Services invoices
 *
 * Sysco Invoice Format:
 * - Line items have format: [Category] [Qty] [Unit] [Size] [Description] [SKU] [UnitPrice] [LineTotal]
 * - Category codes: C (Cooler/Cold), F (Frozen), D (Dry), P (Produce)
 * - SKU is a 6-7 digit number at the end of description, before prices
 * - GROUP TOTAL lines are category subtotals (should be skipped)
 * - INVOICE TOTAL is the final invoice total
 */

const { parseMoney, parseQty, normalizeInvoiceText, isGroupSubtotal } = require('../utils');

/**
 * Parse Sysco line item
 * Format: C 1 CS 25 LB WHLFCLS CREAM SOUR CULTRD GRADE A 1003864    21.52    21.52
 *         ^-- Category
 *           ^-- Qty
 *              ^-- Unit (CS, LB, GAL, etc.)
 *                 ^-- Size/Weight info
 *                                                           ^-- SKU (6-7 digits)
 *                                                                  ^-- Unit Price
 *                                                                          ^-- Line Total
 */
function parseSyscoLineItem(line) {
  // Skip empty lines
  if (!line || line.trim().length < 10) return null;

  const trimmed = line.trim();

  // Skip total/subtotal lines
  if (/^(SUB)?TOTAL/i.test(trimmed)) return null;
  if (/GROUP\s+TOTAL/i.test(trimmed)) return null;
  if (/INVOICE\s+TOTAL/i.test(trimmed)) return null;
  if (isGroupSubtotal(trimmed)) return null;

  // Skip header lines
  if (/^(ITEM|SKU|DESCRIPTION|QTY|QUANTITY|PRICE|AMOUNT|UNIT)/i.test(trimmed)) return null;

  // Sysco line item pattern:
  // [Category] [Qty] [Unit] ... [SKU] [UnitPrice] [LineTotal]
  // Example: C 1 CS 25 LB WHLFCLS CREAM SOUR 1003864 21.52 21.52
  // Example: F 2 CS 42.5LB PORTCLS SHRIMP WHT P&D TLOF 26/30 6739153 58.57 117.14

  // Primary pattern: Category + Qty + Unit + Description + SKU + Prices
  // The prices are at the end, SKU is the 6-7 digit number before prices
  const syscoPattern = /^([CFPD])\s+(\d+)\s+([A-Z]{1,4})\s+(.+?)\s+(\d{5,8})\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s*$/i;

  let match = trimmed.match(syscoPattern);
  if (match) {
    const category = match[1].toUpperCase();
    const qty = parseInt(match[2], 10);
    const unit = match[3].toUpperCase();
    const description = match[4].trim();
    const sku = match[5];
    const unitPrice = parseMoney(match[6]);
    const lineTotal = parseMoney(match[7]);

    return {
      type: 'item',
      sku: sku,
      description: `${qty} ${unit} ${description}`.trim(),
      qty: qty,
      unit: unit,
      category: categoryCodeToName(category),
      unitPriceCents: unitPrice,
      lineTotalCents: lineTotal,
      taxFlag: null,
      raw: line
    };
  }

  // Alternative pattern: Some lines have merged quantity and unit (e.g., "1CS" or "1S")
  const mergedPattern = /^([CFPD])\s+(\d+)([A-Z]{1,4})\s+(.+?)\s+(\d{5,8})\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s*$/i;

  match = trimmed.match(mergedPattern);
  if (match) {
    const category = match[1].toUpperCase();
    const qty = parseInt(match[2], 10);
    const unit = match[3].toUpperCase();
    const description = match[4].trim();
    const sku = match[5];
    const unitPrice = parseMoney(match[6]);
    const lineTotal = parseMoney(match[7]);

    return {
      type: 'item',
      sku: sku,
      description: `${qty} ${unit} ${description}`.trim(),
      qty: qty,
      unit: unit,
      category: categoryCodeToName(category),
      unitPriceCents: unitPrice,
      lineTotalCents: lineTotal,
      taxFlag: null,
      raw: line
    };
  }

  // Fallback pattern: Just look for SKU + two prices at end
  // This handles variations in the format
  const fallbackPattern = /^(.+?)\s+(\d{5,8})\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s*$/;

  match = trimmed.match(fallbackPattern);
  if (match) {
    const fullDesc = match[1].trim();
    const sku = match[2];
    const unitPrice = parseMoney(match[3]);
    const lineTotal = parseMoney(match[4]);

    // Try to extract quantity from the beginning of description
    // Pattern: [Category]? [Qty] [Unit] [Rest]
    const qtyMatch = fullDesc.match(/^([CFPD])?\s*(\d+)\s*([A-Z]{1,4})?\s+(.+)$/i);

    let qty = 1;
    let description = fullDesc;
    let category = 'general';
    let unit = '';

    if (qtyMatch) {
      if (qtyMatch[1]) category = categoryCodeToName(qtyMatch[1]);
      qty = parseInt(qtyMatch[2], 10) || 1;
      unit = qtyMatch[3] || '';
      description = `${qty} ${unit} ${qtyMatch[4]}`.trim();
    }

    // Sanity check: quantity should be reasonable (1-999)
    if (qty < 1 || qty > 999) qty = 1;

    return {
      type: 'item',
      sku: sku,
      description: description,
      qty: qty,
      unit: unit,
      category: category,
      unitPriceCents: unitPrice,
      lineTotalCents: lineTotal,
      taxFlag: null,
      raw: line
    };
  }

  return null;
}

/**
 * Convert Sysco category code to readable name
 */
function categoryCodeToName(code) {
  const categories = {
    'C': 'cooler',
    'F': 'frozen',
    'D': 'dry_goods',
    'P': 'produce'
  };
  return categories[code?.toUpperCase()] || 'food_supplies';
}

/**
 * Parse Sysco invoice header
 */
function parseSyscoHeader(text, lines) {
  const header = {
    vendorName: 'Sysco',
    invoiceNumber: null,
    invoiceDate: null,
    accountNumber: null,
    customerName: null,
    soldTo: null,
    billTo: null,
    shipTo: null
  };

  // Invoice number - Sysco uses various formats
  const invPatterns = [
    /Invoice\s*#?[:\s]*(\d{6,12})/i,
    /INV[:\s#]*(\d{6,12})/i,
    /Invoice\s+Number[:\s]*(\d+)/i
  ];

  for (const pattern of invPatterns) {
    const match = text.match(pattern);
    if (match) {
      header.invoiceNumber = match[1];
      break;
    }
  }

  // Invoice date
  const dateMatch = text.match(/(?:Invoice\s+)?Date[:\s]*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i);
  if (dateMatch) {
    header.invoiceDate = dateMatch[1];
  }

  // Customer name from SHIP TO or SOLD TO
  const shipToMatch = text.match(/SHIP\s+TO[:\s]*\n?([A-Z][A-Z0-9\s\.,&'\-]+?)(?:\n|$)/im);
  if (shipToMatch) {
    header.customerName = shipToMatch[1].trim();
    header.shipTo = shipToMatch[1].trim();
  }

  const soldToMatch = text.match(/SOLD\s+TO[:\s]*\n?([A-Z][A-Z0-9\s\.,&'\-]+?)(?:\n|$)/im);
  if (soldToMatch) {
    header.soldTo = soldToMatch[1].trim();
    if (!header.customerName) {
      header.customerName = header.soldTo;
    }
  }

  return header;
}

/**
 * Extract totals from Sysco invoice
 */
function extractSyscoTotals(text, lines) {
  const totals = {
    subtotalCents: 0,
    taxCents: 0,
    totalCents: 0,
    currency: 'USD'
  };

  // Find INVOICE TOTAL (the final total)
  // Sysco format: "INVOICE TOTAL    1,550.15" or "INVOICE\nTOTAL 1550.15"
  const invoiceTotalMatches = text.match(/INVOICE[\s\n]*TOTAL[\s:\n]*\$?([\d,]+\.?\d*)/gi);
  if (invoiceTotalMatches && invoiceTotalMatches.length > 0) {
    // Use the last INVOICE TOTAL (in case there are multiple)
    const lastMatch = invoiceTotalMatches[invoiceTotalMatches.length - 1];
    const valueMatch = lastMatch.match(/\$?([\d,]+\.?\d*)\s*$/);
    if (valueMatch) {
      totals.totalCents = parseMoney(valueMatch[1]);
    }
  }

  // Find SUBTOTAL (excluding GROUP TOTAL lines)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();

    // Skip GROUP TOTAL lines (these are category subtotals)
    if (/GROUP\s+TOTAL/i.test(line)) continue;

    // Look for standalone SUBTOTAL
    const subtotalMatch = line.match(/^SUBTOTAL[\s:]*\$?([\d,]+\.?\d*)/i);
    if (subtotalMatch) {
      totals.subtotalCents = parseMoney(subtotalMatch[1]);
      break;
    }
  }

  // Find TAX
  const taxMatch = text.match(/(?:SALES\s+)?TAX[\s:]*\$?([\d,]+\.?\d*)/i);
  if (taxMatch) {
    totals.taxCents = parseMoney(taxMatch[1]);
  }

  return totals;
}

/**
 * Main Sysco parser function
 */
function parseSyscoInvoice(normalizedText, options = {}) {
  const lines = normalizedText.split('\n');

  // Parse header
  const header = parseSyscoHeader(normalizedText, lines);

  // Extract totals
  const totals = extractSyscoTotals(normalizedText, lines);

  // Extract line items
  const lineItems = [];
  let inItemSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect start of item section (look for header row or first item)
    if (!inItemSection) {
      if (/DESCRIPTION|ITEM\s+#|QTY.*PRICE/i.test(line)) {
        inItemSection = true;
        continue;
      }
      // Check if line looks like a Sysco item (starts with category code)
      if (/^[CFPD]\s+\d+/i.test(line.trim())) {
        inItemSection = true;
      }
    }

    if (inItemSection) {
      // Stop at totals section
      if (/^INVOICE\s+TOTAL/i.test(line.trim())) break;
      if (/^SUBTOTAL\s*[\d$]/i.test(line.trim())) break;

      const item = parseSyscoLineItem(line);
      if (item) {
        lineItems.push(item);
      }
    }
  }

  // Calculate confidence score
  const confidence = calculateSyscoConfidence(lineItems, totals);

  return {
    vendorKey: 'sysco',
    parserVersion: '2.1.0',
    header: header,
    totals: totals,
    lineItems: lineItems,
    employees: [],
    departments: [],
    confidence: confidence,
    debug: {
      parseAttempts: ['sysco'],
      rawLineCount: lines.length,
      itemLinesProcessed: lineItems.length
    }
  };
}

/**
 * Calculate confidence score for Sysco parse
 */
function calculateSyscoConfidence(lineItems, totals) {
  let score = 50;  // Base score for Sysco detection
  const issues = [];
  const warnings = [];

  // Check if we have line items
  if (lineItems.length === 0) {
    score -= 30;
    issues.push('No line items extracted');
  } else {
    score += Math.min(20, lineItems.length * 2);  // Up to +20 for items
  }

  // Check if we have a total
  if (totals.totalCents > 0) {
    score += 15;
  } else {
    issues.push('No invoice total found');
  }

  // Verify line items sum reasonably close to total (if both present)
  if (lineItems.length > 0 && totals.totalCents > 0) {
    const itemsSum = lineItems.reduce((sum, item) => sum + (item.lineTotalCents || 0), 0);
    const diff = Math.abs(totals.totalCents - itemsSum);
    const pctDiff = diff / totals.totalCents;

    if (pctDiff <= 0.01) {
      score += 15;  // Exact or near-exact match
    } else if (pctDiff <= 0.05) {
      score += 10;  // Within 5%
    } else if (pctDiff <= 0.15) {
      score += 5;   // Within 15%
      warnings.push(`Line items sum differs from total by ${(pctDiff * 100).toFixed(1)}%`);
    } else {
      warnings.push(`Significant difference: items sum $${(itemsSum/100).toFixed(2)} vs total $${(totals.totalCents/100).toFixed(2)}`);
    }
  }

  // Check for valid SKUs in items
  const validSkus = lineItems.filter(item => item.sku && /^\d{5,8}$/.test(item.sku)).length;
  if (validSkus > 0) {
    score += Math.min(10, validSkus);
  }

  return {
    score: Math.min(100, Math.max(0, score)),
    issues: issues,
    warnings: warnings
  };
}

module.exports = {
  parseSyscoInvoice,
  parseSyscoLineItem,
  parseSyscoHeader,
  extractSyscoTotals,
  calculateSyscoConfidence
};
