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
const { extractTotalCandidates, findReconcilableTotal } = require('../totalsCandidates');
const { extractAdjustments, calculateAdjustmentsSummary } = require('../adjustmentsExtractor');

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
 * Extract MISC CHARGES section from Sysco invoice
 * This includes:
 * - ALLOWANCE FOR DROP SIZE (can be negative - a credit/discount)
 * - CHGS FOR FUEL SURCHARGE (typically positive)
 * - TAX (sales tax, if present)
 *
 * These adjustments affect the final invoice total but are not line items
 */
function extractSyscoMiscCharges(text, lines) {
  const adjustments = [];
  let inMiscSection = false;

  // First, use the shared adjustments extractor for TAX
  // This has more robust patterns than simple regex
  const sharedAdjustments = extractAdjustments(text);

  // Add tax from shared extractor if found
  if (sharedAdjustments.summary.taxCents > 0) {
    adjustments.push({
      type: 'tax',
      description: 'Tax',
      amountCents: sharedAdjustments.summary.taxCents,
      raw: 'Extracted via shared adjustments extractor',
      source: 'shared_extractor'
    });
    console.log(`[SYSCO MISC] Found Tax via shared extractor: $${(sharedAdjustments.summary.taxCents/100).toFixed(2)}`);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Detect MISC CHARGES section
    if (/MISC\s+CHARGES/i.test(line)) {
      inMiscSection = true;

      // IMPORTANT: Check if ALLOWANCE is on the SAME line as MISC CHARGES
      // Format: "MISC CHARGES ALLOWANCE FOR DROP SIZE 64.03-"
      if (/ALLOWANCE\s+FOR\s+DROP\s+SIZE/i.test(line)) {
        const sameLineMatch = line.match(/ALLOWANCE\s+FOR\s+DROP\s+SIZE\s+([\d,]+\.?\d*)([\-])?/i);
        if (sameLineMatch) {
          const value = parseMoney(sameLineMatch[1]);
          const isNegative = sameLineMatch[2] === '-';
          if (value > 0 && value < 100000) {
            adjustments.push({
              type: 'allowance',
              description: 'Allowance for Drop Size',
              amountCents: -value,  // Allowances are credits (negative)
              raw: line
            });
            console.log(`[SYSCO MISC] Found Drop Size Allowance (same line): $${(value/100).toFixed(2)} (credit)`);
          }
        }
      }
      continue;
    }

    // Exit misc section when hitting ORDER SUMMARY or end markers
    if (inMiscSection) {
      if (/ORDER\s+SUMMARY/i.test(line) || /^CASES\s+SPLIT/i.test(line) || /OPEN:/i.test(line)) {
        break;
      }

      // Look for ALLOWANCE FOR DROP SIZE
      // Format varies: "ALLOWANCE FOR DROP SIZE  64.03-" or spread across lines
      if (/ALLOWANCE\s+FOR\s+DROP\s+SIZE/i.test(line)) {
        // Try to find value on same line
        const sameLineMatch = line.match(/ALLOWANCE\s+FOR\s+DROP\s+SIZE\s+([\d,]+\.?\d*)([\-])?/i);
        if (sameLineMatch) {
          const value = parseMoney(sameLineMatch[1]);
          const isNegative = sameLineMatch[2] === '-';
          adjustments.push({
            type: 'allowance',
            description: 'Allowance for Drop Size',
            amountCents: isNegative ? -value : -value,  // Allowances are typically credits (negative)
            raw: line
          });
          console.log(`[SYSCO MISC] Found Drop Size Allowance: $${(value/100).toFixed(2)} (credit)`);
        } else {
          // Value might be on a following line - scan next few lines for a value with "-" suffix
          for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
            const nextLine = lines[j].trim();
            // Look for standalone number, possibly with trailing "-" for negative
            const valueMatch = nextLine.match(/^([\d,]+\.?\d*)([\-])?$/);
            if (valueMatch) {
              const value = parseMoney(valueMatch[1]);
              const isNegative = valueMatch[2] === '-';
              if (value > 0 && value < 100000) {  // Reasonable range for credits
                adjustments.push({
                  type: 'allowance',
                  description: 'Allowance for Drop Size',
                  amountCents: isNegative ? -value : -value,  // Credits are negative
                  raw: `${line} -> ${nextLine}`
                });
                console.log(`[SYSCO MISC] Found Drop Size Allowance (next line): $${(value/100).toFixed(2)} (credit)`);
                break;
              }
            }
          }
        }
        continue;
      }

      // Look for FUEL SURCHARGE
      // Format: "CHGS FOR FUEL SURCHARGE  5.90" or just values after header
      if (/FUEL\s+SURCHARGE/i.test(line) || /CHGS\s+FOR\s+FUEL/i.test(line)) {
        const fuelMatch = line.match(/(?:FUEL\s+SURCHARGE|CHGS\s+FOR\s+FUEL\s+SURCHARGE?)\s+([\d,]+\.?\d*)/i);
        if (fuelMatch) {
          const value = parseMoney(fuelMatch[1]);
          if (value > 0 && value < 10000) {  // Reasonable fuel surcharge (< $100)
            adjustments.push({
              type: 'fee',
              description: 'Fuel Surcharge',
              amountCents: value,  // Surcharges are positive (added to total)
              raw: line
            });
            console.log(`[SYSCO MISC] Found Fuel Surcharge: $${(value/100).toFixed(2)}`);
          }
        } else {
          // Look for value on next line
          if (i + 1 < lines.length) {
            const nextLine = lines[i + 1].trim();
            const valueMatch = nextLine.match(/^([\d,]+\.?\d*)$/);
            if (valueMatch) {
              const value = parseMoney(valueMatch[1]);
              if (value > 0 && value < 10000) {
                adjustments.push({
                  type: 'fee',
                  description: 'Fuel Surcharge',
                  amountCents: value,
                  raw: `${line} -> ${nextLine}`
                });
                console.log(`[SYSCO MISC] Found Fuel Surcharge (next line): $${(value/100).toFixed(2)}`);
              }
            }
          }
        }
        continue;
      }
    }
  }

  // Calculate net adjustments
  const totalAdjustmentsCents = adjustments.reduce((sum, adj) => sum + adj.amountCents, 0);

  console.log(`[SYSCO MISC] Total adjustments: ${adjustments.length} items, net: $${(totalAdjustmentsCents/100).toFixed(2)}`);

  return {
    adjustments,
    totalAdjustmentsCents,
    sharedAdjustmentsSummary: sharedAdjustments.summary  // Include full summary for debugging
  };
}

/**
 * Extract totals from Sysco invoice
 * Uses shared totalsCandidates module for robust candidate ranking
 */
function extractSyscoTotals(text, lines) {
  const totals = {
    subtotalCents: 0,
    taxCents: 0,
    totalCents: 0,
    currency: 'USD',
    candidates: []
  };

  // Use the shared totals candidates extractor for robust ranking
  // This handles GROUP TOTAL filtering and position-based scoring
  const candidatesResult = extractTotalCandidates(text);

  if (candidatesResult.candidates.length > 0) {
    // Log all candidates for debugging
    console.log(`[SYSCO TOTALS] Found ${candidatesResult.candidates.length} total candidates:`);
    candidatesResult.candidates.slice(0, 5).forEach((c, i) => {
      console.log(`  ${i + 1}. ${c.label}: $${(c.valueCents/100).toFixed(2)} (score: ${c.score}, isGroupTotal: ${c.isGroupTotal})`);
    });

    // Store candidates for debugging
    totals.candidates = candidatesResult.candidates.slice(0, 5).map(c => ({
      label: c.label,
      valueCents: c.valueCents,
      score: c.score,
      isGroupTotal: c.isGroupTotal
    }));

    // Get best candidate (already filtered and ranked by score)
    const bestCandidate = candidatesResult.bestCandidate;
    if (bestCandidate && !bestCandidate.isGroupTotal) {
      totals.totalCents = bestCandidate.valueCents;
      console.log(`[SYSCO TOTALS] Selected: ${bestCandidate.label} = $${(bestCandidate.valueCents/100).toFixed(2)} (score: ${bestCandidate.score})`);
    }
  }

  // Fallback: If no good candidate found, use legacy extraction
  if (totals.totalCents === 0) {
    console.log(`[SYSCO TOTALS] No candidate found, using legacy extraction...`);

    // SYSCO-SPECIFIC: Multi-line scan (TOTAL on one line, value on next)
    // This is the most common Sysco format after PDF text extraction
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i].trim();
      const nextLine = lines[i + 1].trim();

      // Skip GROUP TOTAL, CATEGORY TOTAL, etc.
      if (/GROUP|CATEGORY|DEPT|SECTION/i.test(line)) continue;

      // Check for TOTAL alone on a line (or with INVOICE prefix)
      // Be flexible: allow "TOTAL", "TOTAL:", "INVOICE TOTAL", etc.
      if (/^(?:INVOICE\s+)?TOTAL\s*[:.]?\s*$/i.test(line) ||
          (/TOTAL\s*$/i.test(line) && !/GROUP|SUBTOTAL/i.test(line) && line.length < 30)) {

        // Next line should be a money value
        // Allow various decimal formats: 4207.02, 4207.0, 4207, 4,207.02
        const moneyMatch = nextLine.match(/^\s*\$?([\d,]+\.?\d{0,2})\s*$/);
        if (moneyMatch) {
          const lineTotal = parseMoney(moneyMatch[1]);
          if (lineTotal > 100 && lineTotal < 100000000) {  // Reasonable range: $1 - $1M
            console.log(`[SYSCO TOTALS] Legacy multi-line found: "${line}" + "${nextLine}" = $${(lineTotal/100).toFixed(2)}`);
            // Use this if it's larger than current (invoice total > subtotals)
            if (lineTotal > totals.totalCents) {
              totals.totalCents = lineTotal;
            }
          }
        }
      }
    }

    // Pattern 1: Direct regex for "INVOICE TOTAL" across line boundaries
    if (totals.totalCents === 0) {
      const invoiceTotalRegex = /INVOICE[\s\r\n]*TOTAL[\s:\r\n]*\$?([\d,]+\.?\d{0,2})/gi;
      let match;
      while ((match = invoiceTotalRegex.exec(text)) !== null) {
        const value = parseMoney(match[1]);
        if (value > totals.totalCents && value < 100000000) {
          totals.totalCents = value;
          console.log(`[SYSCO TOTALS] Legacy regex found INVOICE TOTAL: $${(value/100).toFixed(2)}`);
        }
      }
    }

    // Pattern 2: Look for total value near "LAST PAGE" marker (Sysco specific)
    if (totals.totalCents === 0) {
      const lastPageMatch = text.match(/LAST\s+PAGE[\s\S]{0,50}?([\d,]+\.?\d{0,2})\s*$/im);
      if (lastPageMatch) {
        const lastPageTotal = parseMoney(lastPageMatch[1]);
        if (lastPageTotal > totals.totalCents) {
          totals.totalCents = lastPageTotal;
          console.log(`[SYSCO TOTALS] Legacy LAST PAGE found: $${(lastPageTotal/100).toFixed(2)}`);
        }
      }
    }

    // Pattern 3: Scan bottom 30 lines for any standalone large number after "TOTAL"
    if (totals.totalCents === 0) {
      for (let i = lines.length - 1; i >= Math.max(0, lines.length - 30); i--) {
        const line = lines[i].trim();
        if (/GROUP\s+TOTAL/i.test(line)) continue;

        // Same-line total pattern
        const match = line.match(/(?:INVOICE\s+)?TOTAL[\s:]*\$?([\d,]+\.?\d{0,2})/i);
        if (match) {
          const lineTotal = parseMoney(match[1]);
          if (lineTotal > totals.totalCents) {
            totals.totalCents = lineTotal;
            console.log(`[SYSCO TOTALS] Legacy line scan found: $${(lineTotal/100).toFixed(2)}`);
          }
        }
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

  // Find TAX using shared adjustments extractor (more robust)
  const sharedAdjustments = extractAdjustments(text);
  if (sharedAdjustments.summary.taxCents > 0) {
    totals.taxCents = sharedAdjustments.summary.taxCents;
    console.log(`[SYSCO TOTALS] Tax from shared extractor: $${(totals.taxCents/100).toFixed(2)}`);
  } else {
    // Fallback to simple pattern
    const taxMatch = text.match(/(?:SALES\s+)?TAX[\s:]*\$?([\d,]+\.?\d*)/i);
    if (taxMatch) {
      totals.taxCents = parseMoney(taxMatch[1]);
    }
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
  const miscCharges = extractSyscoMiscCharges(normalizedText, lines);

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

  // Count how many items were corrected
  const correctedCount = validatedItems.filter(item => item.mathCorrected).length;
  const weightCorrectedCount = validatedItems.filter(item => item.weightCorrected).length;

  // Calculate sum of line items for reconciliation
  const lineItemsSum = validatedItems.reduce((sum, item) => sum + (item.lineTotalCents || 0), 0);

  // Build final adjustments array (including tax from shared extractor)
  const finalAdjustments = [...miscCharges.adjustments];

  // Calculate expected total: line items + all adjustments
  const totalAdjustmentsCents = finalAdjustments.reduce((sum, adj) => sum + adj.amountCents, 0);
  const computedTotal = lineItemsSum + totalAdjustmentsCents;

  console.log(`[SYSCO RECONCILIATION] Line items sum: $${(lineItemsSum/100).toFixed(2)}, Adjustments: $${(totalAdjustmentsCents/100).toFixed(2)}, Computed: $${(computedTotal/100).toFixed(2)}, Printed: $${(totals.totalCents/100).toFixed(2)}`);

  // Check for unexplained delta - add synthetic adjustment if difference exists
  let syntheticDelta = null;
  if (totals.totalCents > 0) {
    const delta = totals.totalCents - computedTotal;
    const absDelta = Math.abs(delta);
    const pctDelta = totals.totalCents > 0 ? absDelta / totals.totalCents : 0;

    // If delta is significant (> $0.10 and < 20% of total), create synthetic adjustment
    if (absDelta > 10 && pctDelta < 0.20) {
      syntheticDelta = {
        type: delta > 0 ? 'unclassified_charge' : 'unclassified_credit',
        description: delta > 0 ? 'Unclassified Charge (Possible Tax/Fee)' : 'Unclassified Credit',
        amountCents: delta,
        raw: `Synthetic: $${(totals.totalCents/100).toFixed(2)} - $${(computedTotal/100).toFixed(2)} = $${(delta/100).toFixed(2)}`,
        isSynthetic: true,
        note: 'Auto-generated to reconcile printed total with line items + known adjustments'
      };
      finalAdjustments.push(syntheticDelta);
      console.log(`[SYSCO RECONCILIATION] Added synthetic delta: $${(delta/100).toFixed(2)} (${(pctDelta * 100).toFixed(1)}% of total)`);
    } else if (absDelta > 10) {
      console.log(`[SYSCO RECONCILIATION] WARNING: Large unexplained delta: $${(delta/100).toFixed(2)} (${(pctDelta * 100).toFixed(1)}% of total) - not adding synthetic`);
    }
  }

  // Recalculate total adjustments including synthetic
  const finalTotalAdjustmentsCents = finalAdjustments.reduce((sum, adj) => sum + adj.amountCents, 0);

  // Add adjustments to totals for easier access
  totals.adjustmentsCents = finalTotalAdjustmentsCents;
  totals.adjustments = finalAdjustments;

  const confidence = calculateSyscoConfidence(validatedItems, totals);

  console.log(`[SYSCO] Parsed ${validatedItems.length} items, total: $${(totals.totalCents/100).toFixed(2)}, weight-corrected: ${weightCorrectedCount}, adjustments: ${finalAdjustments.length}`);

  return {
    vendorKey: 'sysco',
    parserVersion: '2.6.0',  // Bumped version for synthetic delta and shared extractors
    header: header,
    totals: totals,
    lineItems: validatedItems,
    adjustments: finalAdjustments,  // Include all adjustments (including synthetic)
    employees: [],
    departments: [],
    confidence: confidence,
    debug: {
      parseAttempts: ['sysco'],
      rawLineCount: lines.length,
      itemLinesProcessed: validatedItems.length,
      mathCorrectedItems: correctedCount,
      weightCorrectedItems: weightCorrectedCount,
      adjustmentsFound: miscCharges.adjustments.length,
      netAdjustmentsCents: finalTotalAdjustmentsCents,
      reconciliation: {
        lineItemsSum,
        knownAdjustments: totalAdjustmentsCents,
        computedTotal,
        printedTotal: totals.totalCents,
        delta: totals.totalCents - computedTotal,
        hasSyntheticDelta: !!syntheticDelta
      },
      totalsCandidates: totals.candidates || []
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
  extractSyscoMiscCharges,
  calculateSyscoConfidence
};
