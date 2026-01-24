/**
 * Invoice Parsing V2 - US Foods Parser
 * Specialized parser for US Foods distribution invoices
 *
 * US Foods Invoice Format (typical):
 * Columns: ITEM# | BRAND | DESCRIPTION | PACK/SIZE | QTY | PRICE | AMOUNT
 *
 * Common line patterns after PDF extraction:
 * [ItemCode] [Brand] [Description] [Pack] [Qty] [Price] [Extended]
 * Example: 1234567 CHEF'S LINE CHICKEN BREAST BNLS 4/10LB 2 45.99 91.98
 */

const { parseMoney, parseMoneyToDollars, calculateLineTotalCents, parseQty, normalizeInvoiceText, isGroupSubtotal } = require('../utils');
const { validateAndFixLineItems, isLikelyMisclassifiedItemCode } = require('../numberClassifier');

/**
 * Process price string with 3 decimal precision
 * Returns both cents (rounded) and dollars (precise) for accurate calculations
 */
function processPrice(priceStr, qty = 1) {
  const dollars = parseMoneyToDollars(priceStr, 3);
  const cents = parseMoney(priceStr);
  const computedCents = calculateLineTotalCents(qty, dollars);
  return { dollars, cents, computedCents };
}

/**
 * Parse US Foods line item
 */
function parseUSFoodsLineItem(line) {
  if (!line || line.trim().length < 10) return null;

  const trimmed = line.trim();

  // Skip total/subtotal lines
  if (/^(SUB)?TOTAL/i.test(trimmed)) return null;
  if (/GROUP\s+TOTAL/i.test(trimmed)) return null;
  if (/INVOICE\s+TOTAL/i.test(trimmed)) return null;
  if (isGroupSubtotal(trimmed)) return null;

  // Skip header lines
  if (/^(ITEM|BRAND|DESCRIPTION|QTY|QUANTITY|PRICE|AMOUNT|PACK)/i.test(trimmed)) return null;

  // Skip credit/return lines for now (could be handled separately)
  if (/CREDIT|RETURN|ADJUSTMENT/i.test(trimmed)) return null;

  // Skip advertisement/promo lines
  if (/SHOP\s+OUR|WWW\.|ORDER\s+ONLINE/i.test(trimmed)) return null;

  // =====================================================
  // PATTERN 1: Standard US Foods format
  // [ItemCode] [Brand/Description] [Pack] [Qty] [Price] [Extended]
  // Example: 1234567 CHEF'S LINE CHICKEN BREAST BNLS 4/10LB 2 45.99 91.98
  // =====================================================

  // Look for item code at start (typically 6-8 digits)
  let match = trimmed.match(/^(\d{6,8})\s+(.+?)\s+(\d+)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s*$/);

  if (match) {
    const itemCode = match[1];
    const descPart = match[2].trim();
    const qty = parseInt(match[3], 10);
    const unitPriceProc = processPrice(match[4], qty);
    const lineTotalCents = parseMoney(match[5]);

    // Extract pack size from description if present
    let description = descPart;
    let packSize = '';

    const packMatch = descPart.match(/\s+(\d+\/\d+\s*(?:LB|OZ|GAL|CT|PK|CS|EA)?)\s*$/i);
    if (packMatch) {
      packSize = packMatch[1];
      description = descPart.slice(0, packMatch.index).trim();
    }

    if (qty >= 1 && qty <= 999 && lineTotalCents > 0) {
      return {
        type: 'item',
        sku: itemCode,
        description: description,
        packSize: packSize,
        qty: qty,
        unitPriceDollars: unitPriceProc.dollars,
        unitPriceCents: unitPriceProc.cents,
        lineTotalCents: lineTotalCents,
        computedTotalCents: unitPriceProc.computedCents,
        category: 'food_supplies',
        raw: line
      };
    }
  }

  // =====================================================
  // PATTERN 2: With explicit pack column
  // [ItemCode] [Description] [Pack] [Size] [Qty] [Price] [Extended]
  // =====================================================
  match = trimmed.match(/^(\d{6,8})\s+(.+?)\s+(\d+)\s*([A-Z]{1,4})\s+(\d+)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s*$/i);

  if (match) {
    const itemCode = match[1];
    const description = match[2].trim();
    const packNum = match[3];
    const packUnit = match[4];
    const qty = parseInt(match[5], 10);
    const unitPriceProc = processPrice(match[6], qty);
    const lineTotalCents = parseMoney(match[7]);

    if (qty >= 1 && qty <= 999 && lineTotalCents > 0) {
      return {
        type: 'item',
        sku: itemCode,
        description: description,
        packSize: `${packNum}/${packUnit}`,
        qty: qty,
        unitPriceDollars: unitPriceProc.dollars,
        unitPriceCents: unitPriceProc.cents,
        lineTotalCents: lineTotalCents,
        computedTotalCents: unitPriceProc.computedCents,
        category: 'food_supplies',
        raw: line
      };
    }
  }

  // =====================================================
  // PATTERN 3: Fallback - extract from right (price, price, qty)
  // =====================================================
  match = trimmed.match(/^(.+?)\s+(\d+)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s*$/);
  if (match) {
    const fullDesc = match[1].trim();
    const qty = parseInt(match[2], 10);
    const unitPriceProc = processPrice(match[3], qty);
    const lineTotalCents = parseMoney(match[4]);

    // Try to extract item code from description
    let itemCode = null;
    let description = fullDesc;

    const codeMatch = fullDesc.match(/^(\d{6,8})\s+(.+)$/);
    if (codeMatch) {
      itemCode = codeMatch[1];
      description = codeMatch[2].trim();
    }

    if (qty >= 1 && qty <= 999 && lineTotalCents > 0 && description.length >= 3) {
      return {
        type: 'item',
        sku: itemCode,
        description: description,
        qty: qty,
        unitPriceDollars: unitPriceProc.dollars,
        unitPriceCents: unitPriceProc.cents,
        lineTotalCents: lineTotalCents,
        computedTotalCents: unitPriceProc.computedCents,
        category: 'food_supplies',
        raw: line
      };
    }
  }

  // =====================================================
  // PATTERN 4: Single price (unit = total)
  // =====================================================
  match = trimmed.match(/^(.+?)\s+(\d+)\s+\$?([\d,]+\.?\d*)\s*$/);
  if (match) {
    const fullDesc = match[1].trim();
    const qty = parseInt(match[2], 10);
    const lineTotalCents = parseMoney(match[3]);

    let itemCode = null;
    let description = fullDesc;

    const codeMatch = fullDesc.match(/^(\d{6,8})\s+(.+)$/);
    if (codeMatch) {
      itemCode = codeMatch[1];
      description = codeMatch[2].trim();
    }

    if (qty >= 1 && qty <= 99 && lineTotalCents > 0 && description.length >= 3) {
      // Calculate unit price with precision
      const unitPriceDollars = parseMoneyToDollars(lineTotalCents / 100 / qty, 3);
      const unitPriceCents = Math.round(unitPriceDollars * 100);
      const computedTotalCents = calculateLineTotalCents(qty, unitPriceDollars);

      return {
        type: 'item',
        sku: itemCode,
        description: description,
        qty: qty,
        unitPriceDollars: unitPriceDollars,
        unitPriceCents: unitPriceCents,
        lineTotalCents: lineTotalCents,
        computedTotalCents: computedTotalCents,
        category: 'food_supplies',
        raw: line
      };
    }
  }

  return null;
}

/**
 * Parse US Foods invoice header
 */
function parseUSFoodsHeader(text, lines) {
  const header = {
    vendorName: 'US Foods',
    invoiceNumber: null,
    invoiceDate: null,
    accountNumber: null,
    customerName: null,
    soldTo: null,
    billTo: null,
    shipTo: null
  };

  // Invoice number patterns
  const invPatterns = [
    /Invoice\s*#?[:\s]*(\d{8,12})/i,
    /Invoice\s+Number[:\s]*(\d+)/i,
    /INV[:\s#]*(\d{8,12})/i
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

  // Customer name
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

  // Account number
  const acctMatch = text.match(/(?:Account|Customer)\s*#?[:\s]*(\d{6,10})/i);
  if (acctMatch) {
    header.accountNumber = acctMatch[1];
  }

  return header;
}

/**
 * Extract totals from US Foods invoice
 */
function extractUSFoodsTotals(text, lines) {
  const totals = {
    subtotalCents: 0,
    taxCents: 0,
    totalCents: 0,
    currency: 'USD'
  };

  // Invoice Total (scan from bottom)
  const totalPatterns = [
    /INVOICE\s+TOTAL[\s:\n]*\$?([\d,]+\.?\d*)/gi,
    /TOTAL\s+DUE[\s:\n]*\$?([\d,]+\.?\d*)/gi,
    /AMOUNT\s+DUE[\s:\n]*\$?([\d,]+\.?\d*)/gi,
    /BALANCE\s+DUE[\s:\n]*\$?([\d,]+\.?\d*)/gi,
    /(?:^|\n)TOTAL[\s:]*\$?([\d,]+\.?\d*)(?:\s|$)/gim
  ];

  for (const pattern of totalPatterns) {
    const matches = [...text.matchAll(pattern)];
    if (matches.length > 0) {
      // Use the last match (typically the final total)
      const lastMatch = matches[matches.length - 1];
      totals.totalCents = parseMoney(lastMatch[1]);
      if (totals.totalCents > 0) break;
    }
  }

  // Subtotal
  const subtotalMatch = text.match(/(?:^|\n)SUBTOTAL[\s:]*\$?([\d,]+\.?\d*)/im);
  if (subtotalMatch) {
    totals.subtotalCents = parseMoney(subtotalMatch[1]);
  }

  // Tax
  const taxMatch = text.match(/(?:SALES\s+)?TAX[\s:]*\$?([\d,]+\.?\d*)/i);
  if (taxMatch) {
    totals.taxCents = parseMoney(taxMatch[1]);
  }

  return totals;
}

/**
 * Extract fees, charges, and adjustments from US Foods invoice
 * Similar to Sysco, US Foods may have fuel surcharges, delivery fees, etc.
 */
function extractUSFoodsAdjustments(text, lines) {
  const adjustments = [];

  // US Foods fee patterns
  const feePatterns = [
    { regex: /FUEL\s+SURCHARGE[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Fuel Surcharge' },
    { regex: /DELIVERY\s+(?:FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Delivery Fee' },
    { regex: /SERVICE\s+(?:FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Service Charge' },
    { regex: /HANDLING\s+(?:FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Handling Fee' },
    { regex: /SMALL\s+ORDER\s+(?:FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Small Order Fee' },
    { regex: /MINIMUM\s+ORDER\s+(?:FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Minimum Order Fee' },
    { regex: /BOTTLE\s+(?:FEE|DEPOSIT)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Bottle Deposit' },
    { regex: /ENVIRONMENTAL\s+(?:FEE|SURCHARGE)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Environmental Fee' },
    { regex: /COLD\s+(?:CHAIN|STORAGE)\s+(?:FEE|CHARGE)?[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Cold Chain Fee' },
    { regex: /PALLET\s+(?:FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Pallet Fee' },
    { regex: /RUSH\s+(?:FEE|DELIVERY)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Rush Fee' },
  ];

  // Credit/allowance patterns (reduce total)
  const creditPatterns = [
    { regex: /ALLOWANCE[:\s]*\$?([\d,]+\.?\d*)/i, type: 'credit', desc: 'Allowance' },
    { regex: /(?:VOLUME|ORDER)\s+DISCOUNT[:\s]*\$?([\d,]+\.?\d*)/i, type: 'credit', desc: 'Volume Discount' },
    { regex: /(?:CUSTOMER\s+)?CREDIT[:\s]*\-?\$?([\d,]+\.?\d*)/i, type: 'credit', desc: 'Credit' },
    { regex: /RETURN\s+(?:CREDIT|ALLOWANCE)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'credit', desc: 'Return Credit' },
    { regex: /PRICE\s+(?:ADJUSTMENT|CORRECTION)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'credit', desc: 'Price Adjustment' },
    { regex: /PROMOTIONAL?\s+(?:CREDIT|DISCOUNT)?[:\s]*\$?([\d,]+\.?\d*)/i, type: 'credit', desc: 'Promotional Credit' },
    { regex: /REBATE[:\s]*\$?([\d,]+\.?\d*)/i, type: 'credit', desc: 'Rebate' },
    { regex: /BOTTLE\s+(?:RETURN|CREDIT)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'credit', desc: 'Bottle Return' },
  ];

  // Search for fees
  for (const pattern of feePatterns) {
    const match = text.match(pattern.regex);
    if (match) {
      const value = parseMoney(match[1]);
      if (value > 0 && value < 50000) {
        adjustments.push({
          type: pattern.type,
          description: pattern.desc,
          amountCents: value,  // Positive - added to total
          raw: match[0]
        });
        console.log(`[USFOODS ADJ] Found ${pattern.desc}: $${(value/100).toFixed(2)}`);
      }
    }
  }

  // Search for credits
  for (const pattern of creditPatterns) {
    const match = text.match(pattern.regex);
    if (match) {
      const value = parseMoney(match[1]);
      if (value > 0 && value < 100000) {
        adjustments.push({
          type: pattern.type,
          description: pattern.desc,
          amountCents: -value,  // Negative - subtracted from total
          raw: match[0]
        });
        console.log(`[USFOODS ADJ] Found ${pattern.desc}: -$${(value/100).toFixed(2)} (credit)`);
      }
    }
  }

  // Calculate net adjustments
  const totalAdjustmentsCents = adjustments.reduce((sum, adj) => sum + adj.amountCents, 0);

  console.log(`[USFOODS ADJ] Total adjustments: ${adjustments.length} items, net: $${(totalAdjustmentsCents/100).toFixed(2)}`);

  return {
    adjustments,
    totalAdjustmentsCents
  };
}

/**
 * Main US Foods parser function
 */
function parseUSFoodsInvoice(normalizedText, options = {}) {
  const lines = normalizedText.split('\n');

  const header = parseUSFoodsHeader(normalizedText, lines);
  const totals = extractUSFoodsTotals(normalizedText, lines);
  const miscCharges = extractUSFoodsAdjustments(normalizedText, lines);

  // Add adjustments to totals
  totals.adjustmentsCents = miscCharges.totalAdjustmentsCents;
  totals.adjustments = miscCharges.adjustments;

  const lineItems = [];
  let inItemSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect start of item section
    if (!inItemSection) {
      if (/DESCRIPTION.*QTY|ITEM.*PRICE|PACK.*SIZE.*QTY/i.test(line)) {
        inItemSection = true;
        continue;
      }
      // Check if line looks like a US Foods item (starts with 6-8 digit code)
      if (/^\d{6,8}\s+[A-Z]/i.test(line.trim())) {
        inItemSection = true;
      }
    }

    if (inItemSection) {
      // Stop at totals section
      if (/^INVOICE\s+TOTAL/i.test(line.trim())) break;
      if (/^SUBTOTAL[\s:]*\d/i.test(line.trim())) break;
      if (/^AMOUNT\s+DUE/i.test(line.trim())) break;

      const item = parseUSFoodsLineItem(line);
      if (item) {
        // Validate qty isn't misclassified
        if (isLikelyMisclassifiedItemCode(item.qty, item.unitPriceCents, item.lineTotalCents)) {
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

  // Post-processing: validate and fix line items
  const validatedItems = validateAndFixLineItems(lineItems);

  const confidence = calculateUSFoodsConfidence(validatedItems, totals, miscCharges);

  return {
    vendorKey: 'usfoods',
    parserVersion: '2.2.0',  // Bumped for 3 decimal precision support
    header: header,
    totals: totals,
    lineItems: validatedItems,
    adjustments: miscCharges.adjustments,  // Include adjustments separately
    employees: [],
    departments: [],
    confidence: confidence,
    debug: {
      parseAttempts: ['usfoods'],
      rawLineCount: lines.length,
      itemLinesProcessed: validatedItems.length,
      mathCorrectedItems: validatedItems.filter(i => i.mathCorrected).length,
      adjustmentsFound: miscCharges.adjustments.length,
      netAdjustmentsCents: miscCharges.totalAdjustmentsCents
    }
  };
}

/**
 * Calculate confidence score for US Foods parse
 * Now considers adjustments for more accurate validation
 */
function calculateUSFoodsConfidence(lineItems, totals, miscCharges = { adjustments: [], totalAdjustmentsCents: 0 }) {
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

  // Reconciliation: items + tax + adjustments should equal total
  if (lineItems.length > 0 && totals.totalCents > 0) {
    const lineItemsSum = lineItems.reduce((sum, item) => sum + (item.lineTotalCents || 0), 0);
    const adjustmentsSum = miscCharges.totalAdjustmentsCents || 0;
    const taxCents = totals.taxCents || 0;

    // Calculate computed total
    const computedTotal = lineItemsSum + taxCents + adjustmentsSum;
    const diff = Math.abs(computedTotal - totals.totalCents);
    const pctDiff = totals.totalCents > 0 ? diff / totals.totalCents : 1;

    console.log(`[USFOODS CONF] Reconciliation: items=$${(lineItemsSum/100).toFixed(2)} + tax=$${(taxCents/100).toFixed(2)} + adj=$${(adjustmentsSum/100).toFixed(2)} = $${(computedTotal/100).toFixed(2)} vs invoice=$${(totals.totalCents/100).toFixed(2)} (diff=${(pctDiff*100).toFixed(1)}%)`);

    if (pctDiff <= 0.01) {
      score += 20;  // Excellent match
    } else if (pctDiff <= 0.02) {
      score += 15;
    } else if (pctDiff <= 0.05) {
      score += 10;
    } else if (pctDiff <= 0.10) {
      score += 5;
      warnings.push(`Computed total differs from invoice by ${(pctDiff * 100).toFixed(1)}%`);
    } else if (pctDiff <= 0.25) {
      warnings.push(`Items+tax+adjustments differs from total by ${(pctDiff * 100).toFixed(1)}%`);
    } else {
      issues.push(`Large mismatch: computed $${(computedTotal/100).toFixed(2)} vs invoice $${(totals.totalCents/100).toFixed(2)}`);
    }
  }

  // Bonus for finding adjustments
  if (miscCharges.adjustments.length > 0) {
    score += 5;
  }

  // Check math validation
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
  parseUSFoodsInvoice,
  parseUSFoodsLineItem,
  parseUSFoodsHeader,
  extractUSFoodsTotals,
  extractUSFoodsAdjustments,
  calculateUSFoodsConfidence
};
