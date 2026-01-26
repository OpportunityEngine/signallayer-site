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

const { parseMoney, parseMoneyToDollars, calculateLineTotalCents, parseQty, normalizeInvoiceText, isGroupSubtotal } = require('../utils');
const { validateLineItemMath, validateAndFixLineItems, isLikelyMisclassifiedItemCode } = require('../numberClassifier');
const { detectUOM, detectContinuationLine, enhanceLineItemWithUOM, parseSyscoSizeNotation } = require('../unitOfMeasure');
const { extractTotalCandidates, findReconcilableTotal } = require('../totalsCandidates');
const { extractAdjustments, calculateAdjustmentsSummary } = require('../adjustmentsExtractor');
const { findInvoiceTotal } = require('../universalTotalFinder');

/**
 * Process price string with 3 decimal precision
 * Returns both cents (rounded) and dollars (precise) for accurate calculations
 * @param {string} priceStr - Price string like "15.73" or "1.587"
 * @returns {Object} - { cents, dollars, computed }
 */
function processPrice(priceStr, qty = 1) {
  const dollars = parseMoneyToDollars(priceStr, 3);  // Full precision
  const cents = parseMoney(priceStr);                 // Rounded to cents
  const computedCents = calculateLineTotalCents(qty, dollars);  // Qty × dollars × 100, rounded
  return { dollars, cents, computedCents };
}

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

  // Skip address lines - these should NEVER be parsed as line items
  // Common patterns: "POCOMOKE CITY, MD 21851", "33300 PEACH ORCHARD ROAD", etc.
  if (/^\d{3,5}\s+[A-Z]+.*(?:ROAD|RD|STREET|ST|AVENUE|AVE|DRIVE|DR|LANE|LN|WAY|BLVD|HIGHWAY|HWY|PKWY|CT|PL)\b/i.test(trimmed)) return null;  // Street address
  if (/^[A-Z][A-Za-z\s]+,?\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/i.test(trimmed)) return null;  // City, State ZIP
  if (/POCOMOKE|CITY.*STATE|STATE.*ZIP|\d{5}-\d{4}/i.test(trimmed)) return null;  // Address fragments
  if (/^[A-Z][A-Za-z]+\s+CITY\b/i.test(trimmed)) return null;  // "City Name CITY" pattern
  if (/,\s*[A-Z]{2}\s+\d{5}/i.test(trimmed)) return null;  // ", MD 21851" pattern anywhere

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
    // Parse prices with 3 decimal precision for accuracy
    const unitPriceDollars = parseMoneyToDollars(match[7], 3);
    const unitPriceCents = parseMoney(match[7]);
    const lineTotalCents = parseMoney(match[8]);

    // Calculate what the line total SHOULD be with precision
    const computedTotalCents = calculateLineTotalCents(qty, unitPriceDollars);

    // Sanity check: reject absurdly high prices (likely order numbers misread as prices)
    // Max $10,000 per line item is generous for restaurant supplies
    const MAX_LINE_ITEM_CENTS = 2000000; // $20,000
    if (qty >= 1 && qty <= 999 && lineTotalCents > 0 && lineTotalCents < MAX_LINE_ITEM_CENTS && unitPriceCents < MAX_LINE_ITEM_CENTS) {
      return {
        type: 'item',
        sku: sku1,
        itemCode: itemCode,
        description: descPart,
        qty: qty,
        unit: unit,
        category: categoryCodeToName(category),
        unitPriceDollars: unitPriceDollars,  // Full precision
        unitPriceCents: unitPriceCents,
        lineTotalCents: lineTotalCents,
        computedTotalCents: computedTotalCents,  // For validation
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
    const unitPriceProc = processPrice(match[7], qty);
    const lineTotalCents = parseMoney(match[8]);

    // Sanity check: reject absurdly high prices
    const MAX_LINE_ITEM_CENTS = 2000000; // $20,000
    if (qty >= 1 && qty <= 999 && lineTotalCents > 0 && lineTotalCents < MAX_LINE_ITEM_CENTS && unitPriceProc.cents < MAX_LINE_ITEM_CENTS) {
      return {
        type: 'item',
        sku: sku1,
        itemCode: itemCode,
        description: descPart,
        qty: qty,
        unit: unit,
        category: categoryCodeToName(category),
        unitPriceDollars: unitPriceProc.dollars,
        unitPriceCents: unitPriceProc.cents,
        lineTotalCents: lineTotalCents,
        computedTotalCents: unitPriceProc.computedCents,
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
    const unitPriceProc = processPrice(match[6], qty);
    const lineTotalCents = parseMoney(match[7]);

    // Sanity check: reject absurdly high prices
    const MAX_LINE_ITEM_CENTS = 2000000; // $20,000
    if (qty >= 1 && qty <= 999 && lineTotalCents > 0 && lineTotalCents < MAX_LINE_ITEM_CENTS && unitPriceProc.cents < MAX_LINE_ITEM_CENTS) {
      return {
        type: 'item',
        sku: sku,
        description: descPart,
        qty: qty,
        unit: unit,
        category: categoryCodeToName(category),
        unitPriceDollars: unitPriceProc.dollars,
        unitPriceCents: unitPriceProc.cents,
        lineTotalCents: lineTotalCents,
        computedTotalCents: unitPriceProc.computedCents,
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
    const unitPriceProc = processPrice(match[6], qty);
    const lineTotalCents = parseMoney(match[7]);

    // Sanity check: reject absurdly high prices
    const MAX_LINE_ITEM_CENTS = 2000000; // $20,000
    if (qty >= 1 && qty <= 999 && lineTotalCents > 0 && lineTotalCents < MAX_LINE_ITEM_CENTS && unitPriceProc.cents < MAX_LINE_ITEM_CENTS) {
      return {
        type: 'item',
        sku: sku,
        description: descPart,
        qty: qty,
        unit: unit,
        category: categoryCodeToName(category),
        unitPriceDollars: unitPriceProc.dollars,
        unitPriceCents: unitPriceProc.cents,
        lineTotalCents: lineTotalCents,
        computedTotalCents: unitPriceProc.computedCents,
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
    const lineTotalCents = parseMoney(match[5]);

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

    const unitPriceProc = processPrice(match[4], qty);

    // Sanity check: reject absurdly high prices (likely order numbers)
    const MAX_LINE_ITEM_CENTS = 2000000; // $20,000
    if (description.length >= 3 && lineTotalCents > 0 && lineTotalCents < MAX_LINE_ITEM_CENTS && unitPriceProc.cents < MAX_LINE_ITEM_CENTS) {
      return {
        type: 'item',
        sku: sku1,
        itemCode: itemCode,
        description: description,
        qty: qty,
        unit: unit,
        category: category,
        unitPriceDollars: unitPriceProc.dollars,
        unitPriceCents: unitPriceProc.cents,
        lineTotalCents: lineTotalCents,
        computedTotalCents: unitPriceProc.computedCents,
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
    const lineTotalCents = parseMoney(match[4]);

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

    const unitPriceProc = processPrice(match[3], qty);

    // Sanity check: reject absurdly high prices (likely order numbers)
    const MAX_LINE_ITEM_CENTS = 2000000; // $20,000
    if (description.length >= 3 && lineTotalCents > 0 && lineTotalCents < MAX_LINE_ITEM_CENTS && unitPriceProc.cents < MAX_LINE_ITEM_CENTS) {
      return {
        type: 'item',
        sku: sku,
        description: description,
        qty: qty,
        unit: unit,
        category: category,
        unitPriceDollars: unitPriceProc.dollars,
        unitPriceCents: unitPriceProc.cents,
        lineTotalCents: lineTotalCents,
        computedTotalCents: unitPriceProc.computedCents,
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

  // Helper: Extract value at end of line (handles whitespace and trailing hyphen)
  function extractTrailingValue(line) {
    // Match value at end of line: "4.35-" or "5.90" with any amount of whitespace before
    // Pattern: whitespace, then digits with optional decimal and optional trailing hyphen
    const match = line.match(/\s([\d,]+\.?\d*)([\-])?\s*$/);
    if (match) {
      const value = parseMoney(match[1]);
      const isNegative = match[2] === '-';
      return { value, isNegative };
    }
    return null;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Detect MISC CHARGES section
    if (/MISC\s+CHARGES/i.test(line)) {
      inMiscSection = true;
      console.log(`[SYSCO MISC] Entered MISC CHARGES section at line ${i}: "${line.slice(0, 80)}..."`);

      // IMPORTANT: Check if ALLOWANCE is on the SAME line as MISC CHARGES
      // Format: "MISC CHARGES ALLOWANCE FOR DROP SIZE                    4.35-"
      if (/ALLOWANCE\s+FOR\s+DROP\s+SIZE/i.test(line)) {
        // Try extracting value from end of line
        const trailingValue = extractTrailingValue(line);
        if (trailingValue && trailingValue.value > 0 && trailingValue.value < 100000) {
          adjustments.push({
            type: 'allowance',
            description: 'Allowance for Drop Size',
            amountCents: -trailingValue.value,  // Allowances are credits (negative)
            raw: line
          });
          console.log(`[SYSCO MISC] Found Drop Size Allowance (same line as MISC CHARGES): $${(trailingValue.value/100).toFixed(2)} (credit)`);
        } else {
          // Fallback: try original pattern
          const sameLineMatch = line.match(/ALLOWANCE\s+FOR\s+DROP\s+SIZE\s+([\d,]+\.?\d*)([\-])?/i);
          if (sameLineMatch) {
            const value = parseMoney(sameLineMatch[1]);
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
      }

      // Also check for FUEL SURCHARGE on the same MISC CHARGES line (rare but possible)
      if (/FUEL\s+SURCHARGE/i.test(line) || /CHGS\s+FOR\s+FUEL/i.test(line)) {
        const trailingValue = extractTrailingValue(line);
        if (trailingValue && trailingValue.value > 0 && trailingValue.value < 10000) {
          adjustments.push({
            type: 'fee',
            description: 'Fuel Surcharge',
            amountCents: trailingValue.value,  // Surcharges are positive
            raw: line
          });
          console.log(`[SYSCO MISC] Found Fuel Surcharge (on MISC CHARGES line): $${(trailingValue.value/100).toFixed(2)}`);
        }
      }
      continue;
    }

    // Exit misc section when hitting ORDER SUMMARY or end markers
    if (inMiscSection) {
      if (/ORDER\s+SUMMARY/i.test(line) || /^CASES\s+SPLIT/i.test(line) || /OPEN:/i.test(line)) {
        console.log(`[SYSCO MISC] Exited MISC CHARGES section at line ${i}`);
        break;
      }

      // Look for ALLOWANCE FOR DROP SIZE
      // Format varies: "ALLOWANCE FOR DROP SIZE                    4.35-"
      if (/ALLOWANCE\s+FOR\s+DROP\s+SIZE/i.test(line)) {
        // First try extracting value from end of line
        const trailingValue = extractTrailingValue(line);
        if (trailingValue && trailingValue.value > 0 && trailingValue.value < 100000) {
          adjustments.push({
            type: 'allowance',
            description: 'Allowance for Drop Size',
            amountCents: -trailingValue.value,  // Credits are negative
            raw: line
          });
          console.log(`[SYSCO MISC] Found Drop Size Allowance: $${(trailingValue.value/100).toFixed(2)} (credit)`);
        } else {
          // Value might be on a following line - scan next few lines for a value with optional "-" suffix
          for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
            const nextLine = lines[j].trim();
            // Look for standalone number, possibly with trailing "-" for negative
            const valueMatch = nextLine.match(/^([\d,]+\.?\d*)([\-])?$/);
            if (valueMatch) {
              const value = parseMoney(valueMatch[1]);
              if (value > 0 && value < 100000) {
                adjustments.push({
                  type: 'allowance',
                  description: 'Allowance for Drop Size',
                  amountCents: -value,  // Credits are negative
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
      // Format: "CHGS FOR FUEL SURCHARGE                    5.90"
      if (/FUEL\s+SURCHARGE/i.test(line) || /CHGS\s+FOR\s+FUEL/i.test(line)) {
        // First try extracting value from end of line
        const trailingValue = extractTrailingValue(line);
        if (trailingValue && trailingValue.value > 0 && trailingValue.value < 10000) {
          adjustments.push({
            type: 'fee',
            description: 'Fuel Surcharge',
            amountCents: trailingValue.value,  // Surcharges are positive
            raw: line
          });
          console.log(`[SYSCO MISC] Found Fuel Surcharge: $${(trailingValue.value/100).toFixed(2)}`);
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

  // FALLBACK: If we didn't find adjustments in the section-based approach,
  // do a raw text search for these specific Sysco patterns
  if (adjustments.filter(a => a.type === 'allowance').length === 0) {
    // Look for "ALLOWANCE FOR DROP SIZE" anywhere with trailing value
    const dropSizeMatch = text.match(/ALLOWANCE\s+FOR\s+DROP\s+SIZE\s+[\s\S]*?([\d,]+\.?\d*)([\-])?(?:\s|$)/i);
    if (dropSizeMatch) {
      const value = parseMoney(dropSizeMatch[1]);
      if (value > 0 && value < 100000) {
        adjustments.push({
          type: 'allowance',
          description: 'Allowance for Drop Size',
          amountCents: -value,
          raw: dropSizeMatch[0].trim(),
          source: 'fallback_raw_text'
        });
        console.log(`[SYSCO MISC] Found Drop Size Allowance (fallback): $${(value/100).toFixed(2)} (credit)`);
      }
    }
  }

  if (adjustments.filter(a => a.description === 'Fuel Surcharge').length === 0) {
    // Look for "CHGS FOR FUEL SURCHARGE" or "FUEL SURCHARGE" with trailing value
    const fuelMatch = text.match(/(?:CHGS\s+FOR\s+)?FUEL\s+SURCHARGE\s+[\s\S]*?([\d,]+\.?\d*)(?:\s|$)/i);
    if (fuelMatch) {
      const value = parseMoney(fuelMatch[1]);
      if (value > 0 && value < 10000) {
        adjustments.push({
          type: 'fee',
          description: 'Fuel Surcharge',
          amountCents: value,
          raw: fuelMatch[0].trim(),
          source: 'fallback_raw_text'
        });
        console.log(`[SYSCO MISC] Found Fuel Surcharge (fallback): $${(value/100).toFixed(2)}`);
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
 * Uses TWO-PASS STRATEGY for bulletproof INVOICE TOTAL detection
 * CRITICAL: Must correctly identify INVOICE TOTAL and REJECT GROUP TOTAL
 *
 * PASS A (Hard anchor): Find "INVOICE TOTAL" patterns specifically
 * PASS B (Fallback): Generic TOTAL candidates, but NEVER GROUP TOTAL
 */
function extractSyscoTotals(text, lines) {
  const totals = {
    subtotalCents: 0,
    taxCents: 0,
    totalCents: 0,
    currency: 'USD',
    candidates: [],
    totalEvidence: null
  };

  console.log(`[SYSCO TOTALS] ========== BULLETPROOF TWO-PASS STRATEGY ==========`);
  console.log(`[SYSCO TOTALS] Scanning ${lines.length} lines for INVOICE TOTAL...`);

  // Normalize lines for better matching (handle ALL spacing/formatting edge cases)
  const normalizedLines = lines.map(l => {
    return String(l || '')
      .replace(/\r/g, '')
      // Unicode space normalization (non-breaking spaces, em spaces, etc.)
      .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
      // Tab to space
      .replace(/\t/g, ' ')
      // Normalize dashes (en-dash, em-dash, etc. to regular hyphen)
      .replace(/[\u2010-\u2015\u2212]/g, '-')
      // Fix split numbers: "1 748" -> "1748"
      .replace(/(\d)\s+(?=\d)/g, '$1')
      // Fix split decimals: "1748 .85" -> "1748.85"
      .replace(/(\d)\s+\.(?=\d)/g, '$1.')
      // Fix split decimals: "1748. 85" -> "1748.85"
      .replace(/\.\s+(?=\d)/g, '.')
      // Fix split commas: "1, 748" -> "1,748"
      .replace(/,\s+(?=\d)/g, ',')
      // Collapse multiple spaces to single
      .replace(/\s{2,}/g, ' ')
      .trim();
  });

  // ALSO normalize the raw text for regex patterns
  const normalizedText = text
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/(\d)\s+(?=\d)/g, '$1')
    .replace(/(\d)\s+\.(?=\d)/g, '$1.')
    .replace(/\.\s+(?=\d)/g, '.')
    .replace(/,\s+(?=\d)/g, ',');

  // CRITICAL: Helper to detect BAD total lines (GROUP, CATEGORY, SECTION, DEPT, SUBTOTAL)
  const isBadTotalLine = (s) => /GROUP\s*TOTAL|CATEGORY\s*TOTAL|SECTION\s*TOTAL|DEPT\.?\s*TOTAL|DEPARTMENT\s*TOTAL|\bSUBTOTAL\b/i.test(s);

  // ========== PRIORITY PASS 0: BOTTOM-RIGHT CORNER FORMAT ==========
  // Sysco invoices have totals in bottom-right corner with lots of whitespace:
  // SUB TOTAL    4389.56
  // TAX TOTAL
  // INVOICE TOTAL    4389.56
  // This format has 4+ spaces between label and value
  console.log(`[SYSCO TOTALS] Checking for bottom-right corner format...`);

  // Look for INVOICE TOTAL with whitespace and value on SAME LINE
  for (let i = normalizedLines.length - 1; i >= Math.max(0, normalizedLines.length - 100); i--) {
    const line = normalizedLines[i];

    // Pattern: "INVOICE TOTAL" followed by lots of spaces then a number
    // Handles: "INVOICE TOTAL    4389.56" or "INVOICE TOTAL 4,389.56"
    const invoiceTotalMatch = line.match(/INVOICE\s+TOTAL\s{2,}([\d,]+\.?\d*)/i);
    if (invoiceTotalMatch) {
      const cents = parseMoney(invoiceTotalMatch[1]);
      if (cents > 1000) {  // Must be > $10.00
        totals.totalCents = cents;
        totals.totalEvidence = `SYSCO_CORNER: "${line}"`;
        console.log(`[SYSCO TOTALS] ✓ CORNER FORMAT: INVOICE TOTAL = $${(cents/100).toFixed(2)}`);

        // Also look for SUB TOTAL nearby
        for (let j = Math.max(0, i - 5); j < i; j++) {
          const prevLine = normalizedLines[j];
          const subMatch = prevLine.match(/SUB\s+TOTAL\s{2,}([\d,]+\.?\d*)/i);
          if (subMatch) {
            totals.subtotalCents = parseMoney(subMatch[1]);
            console.log(`[SYSCO TOTALS] ✓ CORNER: SUB TOTAL = $${(totals.subtotalCents/100).toFixed(2)}`);
          }
          const taxMatch = prevLine.match(/TAX\s+TOTAL\s{2,}([\d,]+\.?\d*)/i);
          if (taxMatch) {
            totals.taxCents = parseMoney(taxMatch[1]);
            console.log(`[SYSCO TOTALS] ✓ CORNER: TAX TOTAL = $${(totals.taxCents/100).toFixed(2)}`);
          }
        }
        return totals;
      }
    }
  }

  // ========== PASS A: INVOICE TOTAL ANCHOR PATTERNS (HIGHEST PRIORITY) ==========
  // These patterns SPECIFICALLY look for "INVOICE TOTAL" and return immediately when found
  // EXPANDED: Scan last 500 lines instead of 250 to handle longer invoices
  const start = Math.max(0, normalizedLines.length - 500);

  for (let i = normalizedLines.length - 1; i >= start; i--) {
    const prev = i > 0 ? normalizedLines[i - 1] : '';
    const cur = normalizedLines[i];
    const next = i + 1 < normalizedLines.length ? normalizedLines[i + 1] : '';

    // Skip if current line is a bad total type
    if (isBadTotalLine(cur)) continue;

    // A1: "INVOICE" then "TOTAL <value>" on next line
    if (/^INVOICE$/i.test(prev) && /^TOTAL\b/i.test(cur) && !isBadTotalLine(cur)) {
      const m = cur.match(/^TOTAL\b[\s:\-]*\$?\s*([\d,]+(?:\.\d{1,3})?)\s*$/i);
      if (m) {
        const cents = parseMoney(m[1]);
        if (cents > 0) {
          totals.totalCents = cents;
          totals.totalEvidence = `SYSCO_A1: prev="${prev}" cur="${cur}"`;
          console.log(`[SYSCO TOTALS] ✓ PASS A1: INVOICE→TOTAL $${(cents/100).toFixed(2)}`);
          return totals;
        }
      }
    }

    // A2: "INVOICE TOTAL <value>" on same line
    if (/INVOICE\s*TOTAL/i.test(cur) && !isBadTotalLine(cur)) {
      const m = cur.match(/INVOICE\s*TOTAL[\s:\-]*\$?\s*([\d,]+(?:\.\d{1,3})?)/i);
      if (m) {
        const cents = parseMoney(m[1]);
        if (cents > 0) {
          totals.totalCents = cents;
          totals.totalEvidence = `SYSCO_A2: cur="${cur}"`;
          console.log(`[SYSCO TOTALS] ✓ PASS A2: INVOICE TOTAL same-line $${(cents/100).toFixed(2)}`);
          return totals;
        }
      }
    }

    // A3: "INVOICE TOTAL" then value on next line
    if (/^INVOICE\s*TOTAL\s*$/i.test(cur)) {
      const m = next.match(/^\$?\s*([\d,]+(?:\.\d{1,3})?)\s*$/);
      if (m) {
        const cents = parseMoney(m[1]);
        if (cents > 0) {
          totals.totalCents = cents;
          totals.totalEvidence = `SYSCO_A3: cur="${cur}" next="${next}"`;
          console.log(`[SYSCO TOTALS] ✓ PASS A3: INVOICE TOTAL→value $${(cents/100).toFixed(2)}`);
          return totals;
        }
      }
    }

    // A4: "INVOICE" alone, "TOTAL" alone, value on third line (triple-split)
    if (/^INVOICE$/i.test(prev) && /^TOTAL$/i.test(cur) && !isBadTotalLine(cur)) {
      const m = next.match(/^\$?\s*([\d,]+(?:\.\d{1,3})?)\s*$/);
      if (m) {
        const cents = parseMoney(m[1]);
        if (cents > 0) {
          totals.totalCents = cents;
          totals.totalEvidence = `SYSCO_A4: INVOICE→TOTAL→value triple-split`;
          console.log(`[SYSCO TOTALS] ✓ PASS A4: triple-split $${(cents/100).toFixed(2)}`);
          return totals;
        }
      }
    }

    // A5: Just "TOTAL" alone in very bottom 15 lines, value on next line
    // Only if previous line was INVOICE or we're in last 10 lines
    if (/^TOTAL$/i.test(cur) && !isBadTotalLine(cur) && i >= normalizedLines.length - 15) {
      const isPrevInvoice = /INVOICE/i.test(prev);
      const isVeryBottom = i >= normalizedLines.length - 10;
      if (isPrevInvoice || isVeryBottom) {
        const m = next.match(/^\$?\s*([\d,]+(?:\.\d{1,3})?)\s*$/);
        if (m) {
          const cents = parseMoney(m[1]);
          if (cents > 0) {
            totals.totalCents = cents;
            totals.totalEvidence = `SYSCO_A5: TOTAL→value at line ${i}`;
            console.log(`[SYSCO TOTALS] ✓ PASS A5: TOTAL→value $${(cents/100).toFixed(2)}`);
            return totals;
          }
        }
      }
    }
  }

  console.log(`[SYSCO TOTALS] PASS A found nothing, trying raw text patterns...`);

  // ========== PASS A.5: Raw text regex (catches multi-line joins and whitespace) ==========
  // CRITICAL: These patterns handle various PDF extraction quirks
  const rawPatterns = [
    // Pattern 1: INVOICE TOTAL with LOTS of whitespace (corner format)
    /INVOICE\s+TOTAL\s{2,}([\d,]+\.?\d*)/gi,
    // Pattern 2: INVOICE TOTAL with any whitespace/newlines
    /INVOICE\s*TOTAL[\s:\r\n]*\$?([\d,]+\.\d{2})/gi,
    // Pattern 3: INVOICE and TOTAL split by newline
    /INVOICE[\s\r\n]+TOTAL[\s:\r\n]*\$?([\d,]+\.\d{2})/gi,
    // Pattern 4: SUB TOTAL then TAX TOTAL then INVOICE TOTAL (Sysco corner pattern)
    /SUB\s+TOTAL[\s\S]{0,50}INVOICE\s+TOTAL\s+([\d,]+\.?\d*)/gi,
    // Pattern 5: Just looking for INVOICE TOTAL anywhere with value
    /INVOICE\s+TOTAL\s*[\s:]*\$?\s*([\d,]+\.?\d{2})/gi,
  ];

  for (const pattern of rawPatterns) {
    pattern.lastIndex = 0;
    const matches = [...text.matchAll(pattern)];
    if (matches.length > 0) {
      // Take the LAST match (closest to end of document)
      const lastMatch = matches[matches.length - 1];
      const cents = parseMoney(lastMatch[1]);
      if (cents > 1000) {  // Must be > $10.00 to avoid false positives
        totals.totalCents = cents;
        totals.totalEvidence = `SYSCO_RAW: "${lastMatch[0].replace(/[\r\n]+/g, ' ').slice(0, 50)}"`;
        console.log(`[SYSCO TOTALS] ✓ PASS A.5 RAW: $${(cents/100).toFixed(2)}`);
        return totals;
      }
    }
  }

  // ========== PASS A.6: Scan for corner format in raw text ==========
  // Specifically look for the REMIT TO block with totals
  const cornerMatch = text.match(/REMIT\s+TO[\s\S]{0,200}INVOICE\s+TOTAL\s+([\d,]+\.?\d*)/i);
  if (cornerMatch) {
    const cents = parseMoney(cornerMatch[1]);
    if (cents > 1000) {
      totals.totalCents = cents;
      totals.totalEvidence = `SYSCO_REMIT_CORNER: found near REMIT TO`;
      console.log(`[SYSCO TOTALS] ✓ PASS A.6 REMIT CORNER: $${(cents/100).toFixed(2)}`);
      return totals;
    }
  }

  // ========== PATTERN: LAST PAGE indicator ==========
  if (totals.totalCents === 0) {
    console.log(`[SYSCO TOTALS] Checking for LAST PAGE pattern...`);
    const lastPageIdx = normalizedLines.findIndex(l => /LAST\s+PAGE/i.test(l));
    if (lastPageIdx > 10) {
      for (let i = lastPageIdx - 1; i >= Math.max(0, lastPageIdx - 10); i--) {
        const line = normalizedLines[i];
        const moneyOnlyMatch = line.match(/^\$?([\d,]+\.\d{2})$/);
        if (moneyOnlyMatch) {
          const context = normalizedLines.slice(Math.max(0, i - 3), i + 1).join(' ');
          if (/INVOICE\s*TOTAL/i.test(context) && !isBadTotalLine(context)) {
            const cents = parseMoney(moneyOnlyMatch[1]);
            if (cents > 0) {
              totals.totalCents = cents;
              totals.totalEvidence = `SYSCO_LASTPAGE: near LAST PAGE at line ${i}`;
              console.log(`[SYSCO TOTALS] ✓ LAST PAGE: $${(cents/100).toFixed(2)}`);
              return totals;
            }
          }
        }
      }
    }
  }

  // ========== UNIVERSAL TOTAL FINDER (FALLBACK) ==========
  // Only use if we didn't find INVOICE TOTAL above
  if (totals.totalCents === 0) {
    console.log(`[SYSCO TOTALS] INVOICE TOTAL not found, running Universal Total Finder...`);
    const universalResult = findInvoiceTotal(text);

    if (universalResult.found && universalResult.confidence >= 40) {
      totals.totalCents = universalResult.totalCents;
      totals.debug = {
        universalFinder: {
          confidence: universalResult.confidence,
          strategy: universalResult.strategy,
          candidates: universalResult.debug.candidateCount
        }
      };
      console.log(`[SYSCO TOTALS] Universal Finder SUCCESS: $${universalResult.totalDollars.toFixed(2)} (${universalResult.confidence}% confidence via ${universalResult.strategy})`);
    }
  } else {
    console.log(`[SYSCO TOTALS] Skipping Universal Finder - already found INVOICE TOTAL`);
  }

  // ========== LEGACY EXTRACTION (FALLBACK) ==========
  // Only use if universal finder didn't find with good confidence
  if (totals.totalCents === 0) {
    console.log(`[SYSCO TOTALS] Universal finder no result, using shared candidates extractor...`);

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
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i].trim();
        const nextLine = lines[i + 1].trim();

        if (/GROUP|CATEGORY|DEPT|SECTION/i.test(line)) continue;

        if (/^(?:INVOICE\s+)?TOTAL\s*[:.]?\s*$/i.test(line) ||
            (/TOTAL\s*$/i.test(line) && !/GROUP|SUBTOTAL/i.test(line) && line.length < 30)) {

          const moneyMatch = nextLine.match(/^\s*\$?([\d,]+\.?\d{0,3})\s*$/);
          if (moneyMatch) {
            const lineTotal = parseMoney(moneyMatch[1]);
            if (lineTotal > 100 && lineTotal < 100000000) {
              console.log(`[SYSCO TOTALS] Legacy multi-line found: "${line}" + "${nextLine}" = $${(lineTotal/100).toFixed(2)}`);
              if (lineTotal > totals.totalCents) {
                totals.totalCents = lineTotal;
              }
            }
          }
        }
      }

      // Pattern 1: Direct regex for "INVOICE TOTAL" across line boundaries
      if (totals.totalCents === 0) {
        const invoiceTotalRegex = /INVOICE[\s\r\n]*TOTAL[\s:\r\n]*\$?([\d,]+\.?\d{0,3})/gi;
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
        const lastPageMatch = text.match(/LAST\s+PAGE[\s\S]{0,50}?([\d,]+\.?\d{0,3})\s*$/im);
        if (lastPageMatch) {
          const lastPageTotal = parseMoney(lastPageMatch[1]);
          if (lastPageTotal > totals.totalCents) {
            totals.totalCents = lastPageTotal;
            console.log(`[SYSCO TOTALS] Legacy LAST PAGE found: $${(lastPageTotal/100).toFixed(2)}`);
          }
        }
      }

      // Pattern 3: Scan bottom 30 lines for standalone large number after "TOTAL"
      if (totals.totalCents === 0) {
        for (let i = lines.length - 1; i >= Math.max(0, lines.length - 30); i--) {
          const line = lines[i].trim();
          if (/GROUP\s+TOTAL/i.test(line)) continue;

          const match = line.match(/(?:INVOICE\s+)?TOTAL[\s:]*\$?([\d,]+\.?\d{0,3})/i);
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
  }  // End of fallback block for universal finder

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

  // ========== NUCLEAR FALLBACK: Use shared totals.js extractor ==========
  // If we STILL have no total, use the battle-tested shared extractor
  if (totals.totalCents === 0) {
    console.log(`[SYSCO TOTALS] NUCLEAR FALLBACK: Using shared extractTotalsByLineScan...`);
    try {
      const { extractTotalsByLineScan } = require('../totals');
      const sharedResult = extractTotalsByLineScan(text);
      if (sharedResult.totalCents > 1000) {  // Must be > $10.00
        totals.totalCents = sharedResult.totalCents;
        totals.subtotalCents = sharedResult.subtotalCents || totals.subtotalCents;
        totals.taxCents = sharedResult.taxCents || totals.taxCents;
        totals.totalEvidence = `SYSCO_NUCLEAR: from shared totals.js`;
        console.log(`[SYSCO TOTALS] ✓ NUCLEAR: $${(totals.totalCents/100).toFixed(2)} (subtotal: $${(totals.subtotalCents/100).toFixed(2)}, tax: $${(totals.taxCents/100).toFixed(2)})`);
      }
    } catch (e) {
      console.log(`[SYSCO TOTALS] NUCLEAR fallback failed: ${e.message}`);
    }
  }

  // ========== LAST RESORT: Scan for ANY large money value near INVOICE TOTAL ==========
  if (totals.totalCents === 0) {
    console.log(`[SYSCO TOTALS] LAST RESORT: Scanning for any money value near 'INVOICE TOTAL'...`);

    // Find INVOICE TOTAL text position and grab nearby money values
    const invoiceTotalPos = text.toUpperCase().lastIndexOf('INVOICE TOTAL');
    if (invoiceTotalPos > 0) {
      // Get 200 chars after INVOICE TOTAL
      const afterText = text.slice(invoiceTotalPos, invoiceTotalPos + 200);
      const moneyMatches = afterText.match(/[\d,]+\.?\d{0,2}/g);
      if (moneyMatches) {
        for (const m of moneyMatches) {
          const cents = parseMoney(m);
          if (cents > 1000 && cents < 100000000) {  // $10 to $1M range
            totals.totalCents = cents;
            totals.totalEvidence = `SYSCO_LASTRESORT: "${m}" near INVOICE TOTAL`;
            console.log(`[SYSCO TOTALS] ✓ LAST RESORT: $${(cents/100).toFixed(2)}`);
            break;
          }
        }
      }
    }
  }

  console.log(`[SYSCO TOTALS] FINAL: total=$${(totals.totalCents/100).toFixed(2)}, subtotal=$${(totals.subtotalCents/100).toFixed(2)}, tax=$${(totals.taxCents/100).toFixed(2)}`);

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
