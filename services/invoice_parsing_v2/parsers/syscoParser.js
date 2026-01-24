/**
 * Invoice Parsing V2 - Sysco Parser
 * Specialized parser for Sysco Food Services invoices
 *
 * Sysco Invoice Format (from PDF):
 * Columns: QTY | PACK | SIZE | ITEM DESCRIPTION | ITEM CODE | UNIT PRICE | UNIT TAX | EXTENDED PRICE
 *
 * Actual line format after PDF extraction:
 * [Category] [Qty][Unit] [Size] [Description] [SKU1] [ItemCode] [UnitPrice] [ExtPrice]
 * Example: C 1S ONLY5LB CASAIMP CHEESE CHDR MILD FTHR SHRD YE 169734 2822343 15.73 15.73
 * Example: C 1 CS 25 LB WHLFCLS CREAM SOUR CULTRD GRADE A 1003864 5020193 21.52 21.52
 *
 * KEY: There are TWO numeric codes before the prices - SKU and ItemCode
 * The quantity is at the beginning (1S, 1 CS, 2 CS, etc.)
 */

const { parseMoney, parseQty, normalizeInvoiceText, isGroupSubtotal } = require('../utils');
const { validateLineItemMath, validateAndFixLineItems, isLikelyMisclassifiedItemCode } = require('../numberClassifier');
const { detectUOM, detectContinuationLine, enhanceLineItemWithUOM, parseSyscoSizeNotation } = require('../unitOfMeasure');

/**
 * Parse Sysco line item
 * Handles the complex format with TWO item codes before prices
 */
function parseSyscoLineItem(line) {
  if (!line || line.trim().length < 10) return null;

  const trimmed = line.trim();

  // Skip total/subtotal lines
  if (/^(SUB)?TOTAL/i.test(trimmed)) return null;
  if (/GROUP\s+TOTAL/i.test(trimmed)) return null;
  if (/INVOICE\s+TOTAL/i.test(trimmed)) return null;
  if (isGroupSubtotal(trimmed)) return null;

  // Skip ORDER SUMMARY section - contains order numbers that look like prices!
  // These 7-digit order numbers (like 2823871, 2823930) get misread as $2,823,930.00
  if (/ORDER\s+SUMMARY/i.test(trimmed)) return null;
  if (/^\d{7}\s+\d{7}\s+\d{7}/i.test(trimmed)) return null;  // Lines with just order numbers
  if (/\d{7}\s+\d{7}\s+\d{7}/i.test(trimmed)) return null;  // Order numbers anywhere in line

  // Skip MISC CHARGES section entirely - these are fees, not line items
  if (/MISC\s+CHARGES/i.test(trimmed)) return null;
  if (/ALLOWANCE\s+FOR/i.test(trimmed)) return null;
  if (/DROP\s+SIZE/i.test(trimmed)) return null;

  // Skip fuel surcharge lines (they belong in fees, not line items)
  if (/FUEL\s+SURCHARGE/i.test(trimmed)) return null;
  if (/CHGS\s+FOR\s+FUEL/i.test(trimmed)) return null;

  // Skip header lines
  if (/^(ITEM|SKU|DESCRIPTION|QTY|QUANTITY|PRICE|AMOUNT|UNIT|PACK|SIZE)/i.test(trimmed)) return null;
  if (/ITEM\s+CODE/i.test(trimmed)) return null;

  // Skip advertisement/promo lines
  if (/SHOP\s+OUR|WWW\./i.test(trimmed)) return null;
  if (/^\*+[A-Z]+\*+$/.test(trimmed)) return null;  // Like ****DAIRY**** or ****MEAT****

  // =====================================================
  // PATTERN 1: Full Sysco format with TWO codes before prices
  // [Category] [Qty] [Unit] [Size] [Description] [SKU] [ItemCode] [UnitPrice] [ExtPrice]
  // Example: C 1 CS 25 LB WHLFCLS CREAM SOUR CULTRD GRADE A 1003864 5020193 21.52 21.52
  // =====================================================
  let match = trimmed.match(/^([CFPD])\s+(\d+)\s+([A-Z]{1,4})\s+(.+?)\s+(\d{5,8})\s+(\d{5,8})\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s*$/i);

  if (match) {
    const category = match[1].toUpperCase();
    const qty = parseInt(match[2], 10);
    const unit = match[3].toUpperCase();
    const descPart = match[4].trim();
    const sku1 = match[5];
    const itemCode = match[6];
    const unitPrice = parseMoney(match[7]);
    const lineTotal = parseMoney(match[8]);

    // Sanity check: reject absurdly high prices (likely order numbers misread as prices)
    // Max $10,000 per line item is generous for restaurant supplies
    const MAX_LINE_ITEM_CENTS = 2000000; // $20,000
    if (qty >= 1 && qty <= 999 && lineTotal > 0 && lineTotal < MAX_LINE_ITEM_CENTS && unitPrice < MAX_LINE_ITEM_CENTS) {
      return {
        type: 'item',
        sku: sku1,
        itemCode: itemCode,
        description: descPart,
        qty: qty,
        unit: unit,
        category: categoryCodeToName(category),
        unitPriceCents: unitPrice,
        lineTotalCents: lineTotal,
        taxFlag: null,
        raw: line
      };
    }
  }

  // =====================================================
  // PATTERN 2: Merged qty+unit (e.g., "1S" instead of "1 S")
  // [Category] [Qty][Unit] [Size] [Description] [SKU] [ItemCode] [UnitPrice] [ExtPrice]
  // Example: C 1S ONLY5LB CASAIMP CHEESE CHDR MILD FTHR SHRD YE 169734 2822343 15.73 15.73
  // =====================================================
  match = trimmed.match(/^([CFPD])\s+(\d+)([A-Z]{1,4})\s+(.+?)\s+(\d{5,8})\s+(\d{5,8})\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s*$/i);

  if (match) {
    const category = match[1].toUpperCase();
    const qty = parseInt(match[2], 10);
    const unit = match[3].toUpperCase();
    const descPart = match[4].trim();
    const sku1 = match[5];
    const itemCode = match[6];
    const unitPrice = parseMoney(match[7]);
    const lineTotal = parseMoney(match[8]);

    // Sanity check: reject absurdly high prices
    const MAX_LINE_ITEM_CENTS = 2000000; // $20,000
    if (qty >= 1 && qty <= 999 && lineTotal > 0 && lineTotal < MAX_LINE_ITEM_CENTS && unitPrice < MAX_LINE_ITEM_CENTS) {
      return {
        type: 'item',
        sku: sku1,
        itemCode: itemCode,
        description: descPart,
        qty: qty,
        unit: unit,
        category: categoryCodeToName(category),
        unitPriceCents: unitPrice,
        lineTotalCents: lineTotal,
        taxFlag: null,
        raw: line
      };
    }
  }

  // =====================================================
  // PATTERN 3: Format with only ONE code before prices (older format)
  // [Category] [Qty] [Unit] [Description] [SKU] [UnitPrice] [ExtPrice]
  // =====================================================
  match = trimmed.match(/^([CFPD])\s+(\d+)\s+([A-Z]{1,4})\s+(.+?)\s+(\d{5,8})\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s*$/i);

  if (match) {
    const category = match[1].toUpperCase();
    const qty = parseInt(match[2], 10);
    const unit = match[3].toUpperCase();
    const descPart = match[4].trim();
    const sku = match[5];
    const unitPrice = parseMoney(match[6]);
    const lineTotal = parseMoney(match[7]);

    // Sanity check: reject absurdly high prices
    const MAX_LINE_ITEM_CENTS = 2000000; // $20,000
    if (qty >= 1 && qty <= 999 && lineTotal > 0 && lineTotal < MAX_LINE_ITEM_CENTS && unitPrice < MAX_LINE_ITEM_CENTS) {
      return {
        type: 'item',
        sku: sku,
        description: descPart,
        qty: qty,
        unit: unit,
        category: categoryCodeToName(category),
        unitPriceCents: unitPrice,
        lineTotalCents: lineTotal,
        taxFlag: null,
        raw: line
      };
    }
  }

  // =====================================================
  // PATTERN 4: Merged qty+unit with ONE code
  // =====================================================
  match = trimmed.match(/^([CFPD])\s+(\d+)([A-Z]{1,4})\s+(.+?)\s+(\d{5,8})\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s*$/i);

  if (match) {
    const category = match[1].toUpperCase();
    const qty = parseInt(match[2], 10);
    const unit = match[3].toUpperCase();
    const descPart = match[4].trim();
    const sku = match[5];
    const unitPrice = parseMoney(match[6]);
    const lineTotal = parseMoney(match[7]);

    // Sanity check: reject absurdly high prices
    const MAX_LINE_ITEM_CENTS = 2000000; // $20,000
    if (qty >= 1 && qty <= 999 && lineTotal > 0 && lineTotal < MAX_LINE_ITEM_CENTS && unitPrice < MAX_LINE_ITEM_CENTS) {
      return {
        type: 'item',
        sku: sku,
        description: descPart,
        qty: qty,
        unit: unit,
        category: categoryCodeToName(category),
        unitPriceCents: unitPrice,
        lineTotalCents: lineTotal,
        taxFlag: null,
        raw: line
      };
    }
  }

  // =====================================================
  // PATTERN 5: Generic fallback - extract prices from end, codes before them
  // Look for: [anything] [code1] [code2] [price] [price]
  // OR: [anything] [code] [price] [price]
  // =====================================================

  // Try with TWO codes first
  match = trimmed.match(/^(.+?)\s+(\d{5,8})\s+(\d{5,8})\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s*$/);
  if (match) {
    const fullDesc = match[1].trim();
    const sku1 = match[2];
    const itemCode = match[3];
    const unitPrice = parseMoney(match[4]);
    const lineTotal = parseMoney(match[5]);

    // Try to extract qty from beginning: [Cat]? [Qty] [Unit]? [Rest...]
    let qty = 1;
    let description = fullDesc;
    let category = 'food_supplies';
    let unit = '';

    // Pattern: C 1 CS ... or C 1S ... or just 1 CS ...
    const qtyMatch = fullDesc.match(/^([CFPD])?\s*(\d+)\s*([A-Z]{1,4})?\s+(.+)$/i);
    if (qtyMatch) {
      if (qtyMatch[1]) category = categoryCodeToName(qtyMatch[1]);
      const parsedQty = parseInt(qtyMatch[2], 10);
      if (parsedQty >= 1 && parsedQty <= 999) {
        qty = parsedQty;
        unit = qtyMatch[3] || '';
        description = qtyMatch[4].trim();
      }
    }

    // Sanity check: reject absurdly high prices (likely order numbers)
    const MAX_LINE_ITEM_CENTS = 2000000; // $20,000
    if (description.length >= 3 && lineTotal > 0 && lineTotal < MAX_LINE_ITEM_CENTS && unitPrice < MAX_LINE_ITEM_CENTS) {
      return {
        type: 'item',
        sku: sku1,
        itemCode: itemCode,
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
  }

  // Try with ONE code
  match = trimmed.match(/^(.+?)\s+(\d{5,8})\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s*$/);
  if (match) {
    const fullDesc = match[1].trim();
    const sku = match[2];
    const unitPrice = parseMoney(match[3]);
    const lineTotal = parseMoney(match[4]);

    let qty = 1;
    let description = fullDesc;
    let category = 'food_supplies';
    let unit = '';

    const qtyMatch = fullDesc.match(/^([CFPD])?\s*(\d+)\s*([A-Z]{1,4})?\s+(.+)$/i);
    if (qtyMatch) {
      if (qtyMatch[1]) category = categoryCodeToName(qtyMatch[1]);
      const parsedQty = parseInt(qtyMatch[2], 10);
      if (parsedQty >= 1 && parsedQty <= 999) {
        qty = parsedQty;
        unit = qtyMatch[3] || '';
        description = qtyMatch[4].trim();
      }
    }

    // Sanity check: reject absurdly high prices (likely order numbers)
    const MAX_LINE_ITEM_CENTS = 2000000; // $20,000
    if (description.length >= 3 && lineTotal > 0 && lineTotal < MAX_LINE_ITEM_CENTS && unitPrice < MAX_LINE_ITEM_CENTS) {
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
  // Sysco invoices often have INVOICE and TOTAL on separate lines or with various spacing
  // Also look for the pattern near "LAST PAGE" which indicates the final total

  // Pattern 1: Standard "INVOICE TOTAL" with value
  const invoiceTotalMatches = text.match(/INVOICE[\s\n]*TOTAL[\s:\n]*\$?([\d,]+\.?\d*)/gi);
  if (invoiceTotalMatches && invoiceTotalMatches.length > 0) {
    const lastMatch = invoiceTotalMatches[invoiceTotalMatches.length - 1];
    const valueMatch = lastMatch.match(/\$?([\d,]+\.?\d*)\s*$/);
    if (valueMatch) {
      totals.totalCents = parseMoney(valueMatch[1]);
    }
  }

  // Pattern 2: Look for total value near "LAST PAGE" marker (Sysco specific)
  const lastPageMatch = text.match(/LAST\s+PAGE[\s\S]{0,50}?([\d,]+\.?\d{2})\s*$/im);
  if (lastPageMatch) {
    const lastPageTotal = parseMoney(lastPageMatch[1]);
    if (lastPageTotal > totals.totalCents) {
      totals.totalCents = lastPageTotal;
    }
  }

  // Pattern 3: Look for standalone total at end of document
  // Format: "TOTAL" followed by amount, appearing after line items
  const endTotalMatch = text.match(/(?:^|\n)\s*TOTAL\s+\$?([\d,]+\.?\d{2})\s*(?:\n|$)/gim);
  if (endTotalMatch && endTotalMatch.length > 0) {
    const lastEndTotal = endTotalMatch[endTotalMatch.length - 1];
    const valueMatch = lastEndTotal.match(/\$?([\d,]+\.?\d{2})/);
    if (valueMatch) {
      const endTotal = parseMoney(valueMatch[1]);
      if (endTotal > totals.totalCents) {
        totals.totalCents = endTotal;
      }
    }
  }

  // Pattern 4: Scan lines from end to find largest total
  // The final INVOICE TOTAL is usually the largest monetary value near the end
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 20); i--) {
    const line = lines[i].trim();

    // Skip GROUP TOTAL lines
    if (/GROUP\s+TOTAL/i.test(line)) continue;

    // Match INVOICE TOTAL or just TOTAL followed by amount
    const match = line.match(/(?:INVOICE\s+)?TOTAL[\s:]*\$?([\d,]+\.?\d{2})/i);
    if (match) {
      const lineTotal = parseMoney(match[1]);
      if (lineTotal > totals.totalCents) {
        totals.totalCents = lineTotal;
      }
    }
  }

  // Find SUBTOTAL (excluding GROUP TOTAL lines)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (/GROUP\s+TOTAL/i.test(line)) continue;

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

  console.log(`[SYSCO TOTALS] Extracted: total=$${(totals.totalCents/100).toFixed(2)}, subtotal=$${(totals.subtotalCents/100).toFixed(2)}, tax=$${(totals.taxCents/100).toFixed(2)}`);

  return totals;
}

/**
 * Main Sysco parser function
 */
function parseSyscoInvoice(normalizedText, options = {}) {
  const lines = normalizedText.split('\n');

  const header = parseSyscoHeader(normalizedText, lines);
  const totals = extractSyscoTotals(normalizedText, lines);

  const lineItems = [];
  let inItemSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect start of item section
    if (!inItemSection) {
      if (/DESCRIPTION|ITEM\s+(CODE|#)|QTY.*PRICE|PACK.*SIZE/i.test(line)) {
        inItemSection = true;
        continue;
      }
      // Check if line looks like a Sysco item
      if (/^[CFPD]\s+\d+/i.test(line.trim())) {
        inItemSection = true;
      }
    }

    if (inItemSection) {
      // Stop at totals section
      if (/^INVOICE\s+TOTAL/i.test(line.trim())) break;
      if (/^SUBTOTAL\s*[\d$]/i.test(line.trim()) && !/GROUP/i.test(line)) break;

      const item = parseSyscoLineItem(line);
      if (item) {
        // Look ahead for T/WT= continuation line (weight info on next line)
        // Format: "84.000 T/WT= 84.000" - the weight is used to calculate true qty
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1].trim();
          const twtMatch = nextLine.match(/^([\d.]+)\s*T\/WT=\s*([\d.]+)/i);
          if (twtMatch) {
            const weight = parseFloat(twtMatch[1]);
            if (weight > 0 && weight < 10000) {
              // Weight is the actual quantity (e.g., 84 lbs)
              // Recalculate unit price: lineTotal / weight
              item.actualWeight = weight;
              item.originalQty = item.qty;
              item.qty = weight;
              // Unit price should be per lb/unit of weight
              if (item.lineTotalCents > 0) {
                item.unitPriceCents = Math.round(item.lineTotalCents / weight);
              }
              item.weightCorrected = true;
              console.log(`[SYSCO] Applied T/WT weight: ${weight}, unit price: $${(item.unitPriceCents/100).toFixed(2)}/unit`);
              i++; // Skip the T/WT line
            }
          }
        }

        // Validate that qty isn't a misclassified item code
        if (!item.weightCorrected && isLikelyMisclassifiedItemCode(item.qty, item.unitPriceCents, item.lineTotalCents)) {
          console.log(`[SYSCO] Detected misclassified item code as qty: ${item.qty}, recalculating...`);
          // Try to infer correct qty from math
          if (item.unitPriceCents > 0) {
            const inferredQty = Math.round(item.lineTotalCents / item.unitPriceCents);
            if (inferredQty >= 1 && inferredQty <= 999) {
              item.originalQty = item.qty;
              item.qty = inferredQty;
              item.mathCorrected = true;
            }
          }
        }
        lineItems.push(item);
      }
    }
  }

  // Post-processing: validate and fix line items math
  const validatedItems = validateAndFixLineItems(lineItems);

  const confidence = calculateSyscoConfidence(validatedItems, totals);

  // Count how many items were corrected
  const correctedCount = validatedItems.filter(item => item.mathCorrected).length;
  const weightCorrectedCount = validatedItems.filter(item => item.weightCorrected).length;

  console.log(`[SYSCO] Parsed ${validatedItems.length} items, total: $${(totals.totalCents/100).toFixed(2)}, weight-corrected: ${weightCorrectedCount}`);

  return {
    vendorKey: 'sysco',
    parserVersion: '2.4.0',
    header: header,
    totals: totals,
    lineItems: validatedItems,
    employees: [],
    departments: [],
    confidence: confidence,
    debug: {
      parseAttempts: ['sysco'],
      rawLineCount: lines.length,
      itemLinesProcessed: validatedItems.length,
      mathCorrectedItems: correctedCount,
      weightCorrectedItems: weightCorrectedCount
    }
  };
}

/**
 * Calculate confidence score for Sysco parse
 */
function calculateSyscoConfidence(lineItems, totals) {
  let score = 50;
  const issues = [];
  const warnings = [];

  if (lineItems.length === 0) {
    score -= 30;
    issues.push('No line items extracted');
  } else {
    score += Math.min(20, lineItems.length * 2);
  }

  if (totals.totalCents > 0) {
    score += 15;
  } else {
    issues.push('No invoice total found');
  }

  if (lineItems.length > 0 && totals.totalCents > 0) {
    const itemsSum = lineItems.reduce((sum, item) => sum + (item.lineTotalCents || 0), 0);
    const diff = Math.abs(totals.totalCents - itemsSum);
    const pctDiff = totals.totalCents > 0 ? diff / totals.totalCents : 1;

    if (pctDiff <= 0.01) {
      score += 15;
    } else if (pctDiff <= 0.05) {
      score += 10;
    } else if (pctDiff <= 0.15) {
      score += 5;
      warnings.push(`Line items sum differs from total by ${(pctDiff * 100).toFixed(1)}%`);
    } else {
      warnings.push(`Significant difference: items sum $${(itemsSum/100).toFixed(2)} vs total $${(totals.totalCents/100).toFixed(2)}`);
    }
  }

  // Validate quantities are reasonable (not item codes)
  const badQtyItems = lineItems.filter(item => item.qty > 100 && !item.mathCorrected);
  if (badQtyItems.length > 0) {
    score -= 20;
    issues.push(`${badQtyItems.length} items have suspicious quantities > 100`);
  }

  // Check math validation status
  const mathValidatedCount = lineItems.filter(item => item.mathValidated).length;
  const mathCorrectedCount = lineItems.filter(item => item.mathCorrected).length;

  if (lineItems.length > 0) {
    const validationRate = mathValidatedCount / lineItems.length;
    if (validationRate >= 0.9) {
      score += 10;
    } else if (validationRate < 0.5) {
      score -= 5;
      warnings.push(`Only ${Math.round(validationRate * 100)}% of items passed math validation`);
    }

    if (mathCorrectedCount > 0) {
      warnings.push(`${mathCorrectedCount} items had quantities auto-corrected`);
    }
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
