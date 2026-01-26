/**
 * Invoice Parsing V2 - Generic Parser
 * Fallback parser for unknown vendors using heuristic approaches
 * Now enhanced with adaptive parsing and layout analysis
 */

const {
  parseMoney,
  parseMoneyToDollars,
  calculateLineTotalCents,
  parseQty,
  scanFromBottom,
  normalizeInvoiceText,
  extractTailNumbers,
  isTableHeader,
  isGroupSubtotal
} = require('./utils');
const { parseAdaptive } = require('./adaptiveParser');
const { analyzeLayout, generateParsingHints } = require('./layoutAnalyzer');
const { validateAndFixLineItems } = require('./numberClassifier');
const { findInvoiceTotal, extractTotalWithUniversalFinder } = require('./universalTotalFinder');
const { UNIVERSAL_SKU_PATTERN, extractSku, looksLikeSku, extractAllSkus, isLikelyPrice, isLikelyDate } = require('./skuPatterns');
const { validateParserTotals } = require('./coreExtractor');

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
 * Extract header information from generic invoice
 */
function parseGenericHeader(text, lines) {
  const header = {
    vendorName: null,
    invoiceNumber: null,
    invoiceDate: null,
    accountNumber: null,
    customerName: null,
    soldTo: null,
    billTo: null,
    shipTo: null
  };

  // Invoice number patterns (common across vendors)
  const invoicePatterns = [
    /Invoice\s*(?:#|No\.?|Number)?[:\s]*([A-Z0-9\-]{5,20})/i,
    /INV[:\s#]*([A-Z0-9\-]{5,20})/i,
    /(?:^|\s)#(\d{6,12})(?:\s|$)/m
  ];

  for (const pattern of invoicePatterns) {
    const match = text.match(pattern);
    if (match) {
      header.invoiceNumber = match[1];
      break;
    }
  }

  // Invoice date patterns
  const datePatterns = [
    /(?:Invoice\s+)?Date[:\s]*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i,
    /(\d{1,2}[-\/]\d{1,2}[-\/]\d{4})/
  ];

  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (match) {
      header.invoiceDate = match[1];
      break;
    }
  }

  // Vendor name - usually at top, often in larger text or first few lines
  // Note: vendorName from header is secondary - we prefer detected vendor from vendorDetector
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const line = lines[i].trim();
    // Skip empty and very short lines
    if (line.length < 3 || line.length > 60) continue;
    // Skip lines that look like addresses or dates
    if (/^\d+\s+\w+\s+(st|ave|rd|blvd|dr|ln)/i.test(line)) continue;
    if (/\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}/.test(line)) continue;
    // Skip lines that look like legal text/disclaimers
    if (/\b(TRUST|CLAIM|COMMODITY|RETAINS|PURSUANT|AGREEMENT|SELLER|BUYER)\b/i.test(line)) continue;
    if (/\b(LIABILITY|DISCLAIMER|TERMS|CONDITIONS|PAYMENT|MERCHANDISE)\b/i.test(line)) continue;
    // Skip lines that are all-caps sentences (likely legal text)
    if (line === line.toUpperCase() && line.split(' ').length > 6) continue;

    // Likely vendor name if it's a proper-looking company name
    if (/^[A-Z][A-Za-z0-9\s\.,&'\-]+$/.test(line)) {
      header.vendorName = line;
      break;
    }
  }

  // Customer/Bill To
  const billToMatch = text.match(/(?:BILL|SOLD|SHIP)\s*TO[:\s]*\n?([A-Z][A-Z0-9\s\.,&'\-]+?)(?:\n|$)/im);
  if (billToMatch) {
    header.customerName = billToMatch[1].trim();
  }

  return header;
}

/**
 * Extract totals from generic invoice using UNIVERSAL TOTAL FINDER
 * This combines 7 different strategies to find the invoice total NO MATTER WHERE it is
 */
function extractGenericTotals(text, lines) {
  const totals = {
    subtotalCents: 0,
    taxCents: 0,
    totalCents: 0,
    currency: 'USD',
    debug: {}
  };

  // ========== UNIVERSAL TOTAL FINDER ==========
  // Run ALL 7 strategies to exhaustively find the invoice total
  console.log(`[GENERIC TOTALS] Running Universal Total Finder...`);
  const universalResult = findInvoiceTotal(text);

  if (universalResult.found && universalResult.confidence >= 30) {
    totals.totalCents = universalResult.totalCents;
    totals.debug.universalFinder = {
      confidence: universalResult.confidence,
      strategy: universalResult.strategy,
      candidates: universalResult.debug.candidateCount
    };
    console.log(`[GENERIC TOTALS] Universal Finder SUCCESS: $${universalResult.totalDollars.toFixed(2)} (${universalResult.confidence}% confidence via ${universalResult.strategy})`);
  } else {
    console.log(`[GENERIC TOTALS] Universal Finder: No confident result, trying legacy patterns...`);
  }

  // ========== LEGACY PATTERNS (Fallback) ==========
  // If universal finder didn't find anything with good confidence, try legacy patterns
  if (totals.totalCents === 0) {
    // First, try to find "INVOICE TOTAL" specifically (handles line breaks)
    const invoiceTotalMatch = text.match(/INVOICE[\s\n]*TOTAL[\s:\n]*\$?([\d,]+\.?\d*)/gi);
    if (invoiceTotalMatch && invoiceTotalMatch.length > 0) {
      const lastMatch = invoiceTotalMatch[invoiceTotalMatch.length - 1];
      const valueMatch = lastMatch.match(/\$?([\d,]+\.?\d*)\s*$/);
      if (valueMatch) {
        const total = parseMoney(valueMatch[1]);
        if (total > 0) {
          totals.totalCents = total;
          console.log(`[GENERIC TOTALS] Found INVOICE TOTAL (legacy inline): $${(total/100).toFixed(2)}`);
        }
      }
    }
  }

  // Pattern 2: Multi-line INVOICE TOTAL (PDF columns split across lines)
  if (totals.totalCents === 0) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim().toUpperCase();
      if (line.includes('INVOICE') && (line.includes('TOTAL') || (i + 1 < lines.length && lines[i + 1].trim().toUpperCase().includes('TOTAL')))) {
        for (let j = i; j < Math.min(i + 5, lines.length); j++) {
          const searchLine = lines[j].trim();
          const valueMatch = searchLine.match(/^\$?([\d,]+\.\d{2})$/);
          if (valueMatch) {
            const value = parseMoney(valueMatch[1]);
            if (value > 100 && value < 100000000) {
              totals.totalCents = value;
              console.log(`[GENERIC TOTALS] Found INVOICE TOTAL (legacy multi-line): $${(value/100).toFixed(2)}`);
              break;
            }
          }
        }
        if (totals.totalCents > 0) break;
      }
    }
  }

  // ========== SUBTOTAL AND TAX EXTRACTION ==========
  const subtotalPatterns = [
    /SUB[\s\-]?TOTAL[:\s]*\$?([\d,]+\.?\d*)/i,
    /SUBTOTAL[:\s]*\$?([\d,]+\.?\d*)/i
  ];

  const taxPatterns = [
    /(?:SALES\s+)?TAX[:\s]*\$?([\d,]+\.?\d*)/i,
    /VAT[:\s]*\$?([\d,]+\.?\d*)/i
  ];

  // Scan from bottom for subtotals and tax
  const matches = scanFromBottom(lines, [...subtotalPatterns, ...taxPatterns], 80);

  for (const { line, match, pattern } of matches) {
    if (isGroupSubtotal(line)) continue;
    const value = parseMoney(match[1]);
    if (value <= 0) continue;

    if (subtotalPatterns.some(p => p.source === pattern.source) && totals.subtotalCents === 0) {
      totals.subtotalCents = value;
    }
    if (taxPatterns.some(p => p.source === pattern.source) && totals.taxCents === 0) {
      totals.taxCents = value;
    }
  }

  // If we have total but no subtotal, try to derive
  if (totals.totalCents > 0 && totals.subtotalCents === 0 && totals.taxCents > 0) {
    totals.subtotalCents = totals.totalCents - totals.taxCents;
  }

  return totals;
}

/**
 * Extract fees, charges, and adjustments from generic invoice
 * These are things like fuel surcharges, delivery fees, allowances/credits
 * that affect the invoice total but aren't product line items
 */
function extractGenericAdjustments(text, lines) {
  const adjustments = [];

  // Comprehensive fee/charge patterns for all invoice types
  const feePatterns = [
    // Fuel & Delivery
    { regex: /FUEL\s+SURCHARGE[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Fuel Surcharge' },
    { regex: /CHGS\s+FOR\s+FUEL[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Fuel Surcharge' },
    { regex: /DELIVERY\s+(?:FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Delivery Fee' },
    { regex: /SHIPPING[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Shipping' },
    { regex: /FREIGHT[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Freight' },
    { regex: /RUSH\s+(?:FEE|DELIVERY|ORDER)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Rush Fee' },
    { regex: /EXPEDITED?\s+(?:FEE|DELIVERY|SHIPPING)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Expedited Fee' },

    // Service & Handling
    { regex: /SERVICE\s+(?:FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Service Charge' },
    { regex: /HANDLING\s+(?:FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Handling Fee' },
    { regex: /PROCESSING\s+(?:FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Processing Fee' },

    // Environmental & Compliance
    { regex: /ENVIRONMENTAL\s+(?:FEE|SURCHARGE)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Environmental Fee' },
    { regex: /HAZMAT\s+(?:FEE|CHARGE|SURCHARGE)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Hazmat Fee' },
    { regex: /COMPLIANCE\s+(?:FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Compliance Fee' },
    { regex: /REGULATORY\s+(?:FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Regulatory Fee' },

    // Order-related fees
    { regex: /SMALL\s+ORDER\s+(?:FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Small Order Fee' },
    { regex: /MINIMUM\s+ORDER\s+(?:FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Minimum Order Fee' },
    { regex: /BELOW\s+MINIMUM[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Below Minimum Fee' },
    { regex: /RESTOCKING\s+(?:FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Restocking Fee' },

    // Container/Deposit fees (common in food/beverage)
    { regex: /BOTTLE\s+(?:FEE|DEPOSIT)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Bottle Deposit' },
    { regex: /CONTAINER\s+(?:FEE|CHARGE|DEPOSIT)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Container Fee' },
    { regex: /PALLET\s+(?:FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Pallet Fee' },
    { regex: /DRUM\s+(?:FEE|CHARGE|DEPOSIT)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Drum Deposit' },
    { regex: /CRV[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'CA Redemption Value' },  // California beverage

    // Cold chain (food service)
    { regex: /REFRIGERAT(?:ION|ED)\s+(?:FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Refrigeration Fee' },
    { regex: /COLD\s+(?:CHAIN|STORAGE)\s+(?:FEE|CHARGE)?[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Cold Chain Fee' },
    { regex: /FREEZER\s+(?:FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Freezer Fee' },

    // Insurance & Other
    { regex: /INSURANCE[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Insurance' },
    { regex: /ADMIN(?:ISTRATION|ISTRATIVE)?\s+(?:FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Admin Fee' },
    { regex: /(?:LATE\s+)?PAYMENT\s+(?:FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Payment Fee' },
    { regex: /FINANCE\s+CHARGE[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Finance Charge' },

    // Cintas/Uniform service specific
    { regex: /ENERGY\s+(?:FEE|SURCHARGE)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Energy Surcharge' },
    { regex: /ROUTE\s+(?:FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Route Fee' },
    { regex: /STOP\s+CHARGE[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Stop Charge' },
    { regex: /GARMENT\s+(?:FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Garment Fee' },
    { regex: /LOST\s+(?:GARMENT|ITEM)\s+(?:FEE|CHARGE)?[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Lost Item Fee' },
  ];

  // Credit/allowance patterns (these are typically negative - reduce total)
  const creditPatterns = [
    // Drop size / volume allowances (common in food service)
    { regex: /ALLOWANCE\s+FOR\s+DROP\s+SIZE[:\s]*([\d,]+\.?\d*)([\-])?/i, type: 'credit', desc: 'Allowance for Drop Size' },
    { regex: /DROP\s+SIZE\s+(?:ALLOWANCE|CREDIT)[:\s]*([\d,]+\.?\d*)([\-])?/i, type: 'credit', desc: 'Drop Size Allowance' },
    { regex: /VOLUME\s+(?:ALLOWANCE|DISCOUNT|CREDIT)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'credit', desc: 'Volume Allowance' },

    // Standard discounts
    { regex: /(?:CASH\s+)?DISCOUNT[:\s]*\$?([\d,]+\.?\d*)/i, type: 'credit', desc: 'Discount' },
    { regex: /EARLY\s+(?:PAY(?:MENT)?|ORDER)\s+DISCOUNT[:\s]*\$?([\d,]+\.?\d*)/i, type: 'credit', desc: 'Early Payment Discount' },
    { regex: /PREPAY(?:MENT)?\s+DISCOUNT[:\s]*\$?([\d,]+\.?\d*)/i, type: 'credit', desc: 'Prepayment Discount' },

    // Credits
    { regex: /(?:CUSTOMER\s+)?CREDIT[:\s]*\-?\$?([\d,]+\.?\d*)/i, type: 'credit', desc: 'Credit' },
    { regex: /RETURN\s+(?:CREDIT|ALLOWANCE)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'credit', desc: 'Return Credit' },
    { regex: /PRICE\s+(?:ADJUSTMENT|CORRECTION)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'credit', desc: 'Price Adjustment' },
    { regex: /OVERCHARGE\s+(?:CREDIT|REFUND)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'credit', desc: 'Overcharge Credit' },

    // Promotional
    { regex: /REBATE[:\s]*\$?([\d,]+\.?\d*)/i, type: 'credit', desc: 'Rebate' },
    { regex: /PROMOTION(?:AL)?\s+(?:CREDIT|DISCOUNT)?[:\s]*\$?([\d,]+\.?\d*)/i, type: 'credit', desc: 'Promotional Credit' },
    { regex: /COUPON[:\s]*\$?([\d,]+\.?\d*)/i, type: 'credit', desc: 'Coupon' },

    // Loyalty/rewards
    { regex: /(?:LOYALTY|REWARDS?)\s+(?:CREDIT|DISCOUNT)?[:\s]*\$?([\d,]+\.?\d*)/i, type: 'credit', desc: 'Loyalty Credit' },
    { regex: /(?:MEMBER|CUSTOMER)\s+(?:SAVINGS|DISCOUNT)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'credit', desc: 'Member Savings' },

    // Deposit returns (negative fees become credits)
    { regex: /BOTTLE\s+(?:RETURN|CREDIT)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'credit', desc: 'Bottle Return' },
    { regex: /CONTAINER\s+(?:RETURN|CREDIT)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'credit', desc: 'Container Return' },
    { regex: /PALLET\s+(?:RETURN|CREDIT)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'credit', desc: 'Pallet Return' },
  ];

  // Search for fees
  for (const pattern of feePatterns) {
    const match = text.match(pattern.regex);
    if (match) {
      const value = parseMoney(match[1]);
      if (value > 0 && value < 50000) {  // Reasonable fee range (< $500)
        adjustments.push({
          type: pattern.type,
          description: pattern.desc,
          amountCents: value,  // Positive - added to total
          raw: match[0]
        });
        console.log(`[GENERIC ADJ] Found ${pattern.desc}: $${(value/100).toFixed(2)}`);
      }
    }
  }

  // Search for credits/allowances
  for (const pattern of creditPatterns) {
    const match = text.match(pattern.regex);
    if (match) {
      const value = parseMoney(match[1]);
      const isExplicitlyNegative = match[2] === '-' || match[0].includes('-');
      if (value > 0 && value < 100000) {  // Reasonable credit range (< $1000)
        adjustments.push({
          type: pattern.type,
          description: pattern.desc,
          amountCents: -value,  // Negative - subtracted from total (credits)
          raw: match[0]
        });
        console.log(`[GENERIC ADJ] Found ${pattern.desc}: -$${(value/100).toFixed(2)} (credit)`);
      }
    }
  }

  // Also scan for MISC CHARGES section (common in food service invoices)
  let inMiscSection = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (/MISC\s+CHARGES/i.test(line)) {
      inMiscSection = true;
      console.log(`[GENERIC ADJ] Entered MISC CHARGES section at line ${i}: "${line.slice(0, 60)}"`);

      // Check if ALLOWANCE is on the SAME line as MISC CHARGES (Sysco format)
      if (/ALLOWANCE/i.test(line)) {
        const valueMatch = line.match(/([\d,]+\.?\d{2})([\-])?$/);
        if (valueMatch) {
          const value = parseMoney(valueMatch[1]);
          if (value > 0 && value < 100000) {
            adjustments.push({
              type: 'credit',
              description: 'Allowance for Drop Size',
              amountCents: -value,
              raw: line
            });
            console.log(`[GENERIC ADJ] Found Allowance (same line as MISC CHARGES): -$${(value/100).toFixed(2)}`);
          }
        }
      }
      continue;
    }

    if (inMiscSection) {
      // Exit at ORDER SUMMARY or similar markers
      if (/ORDER\s+SUMMARY/i.test(line) || /^CASES\s+SPLIT/i.test(line) || /OPEN:/i.test(line) || /^DRIVER/i.test(line)) {
        console.log(`[GENERIC ADJ] Exited MISC CHARGES section at line ${i}`);
        break;
      }

      // Look for values in MISC section that weren't caught above
      const valueMatch = line.match(/([\d,]+\.?\d{2})([\-])?$/);
      if (valueMatch && !adjustments.some(a => a.raw && a.raw.includes(valueMatch[0]))) {
        const value = parseMoney(valueMatch[1]);
        const isNegative = valueMatch[2] === '-';

        // Try to identify what this charge is
        if ((/ALLOWANCE|DROP\s+SIZE/i.test(line)) && value > 0 && value < 100000) {
          adjustments.push({
            type: 'credit',
            description: 'Allowance',
            amountCents: -value,
            raw: line
          });
          console.log(`[GENERIC ADJ] Found Allowance in MISC section: -$${(value/100).toFixed(2)} from "${line.slice(0, 50)}"`);
        } else if ((/SURCHARGE|FEE|CHARGE|FUEL/i.test(line)) && value > 0 && value < 50000) {
          adjustments.push({
            type: 'fee',
            description: line.includes('FUEL') ? 'Fuel Surcharge' : 'Surcharge',
            amountCents: value,
            raw: line
          });
          console.log(`[GENERIC ADJ] Found Fee in MISC section: $${(value/100).toFixed(2)} from "${line.slice(0, 50)}"`);
        }
      }
    }
  }

  // Final fallback: Scan entire text for specific Sysco-style adjustments
  // These patterns handle multi-column PDF extraction where values may be far from labels
  if (adjustments.length === 0) {
    // Look for FUEL SURCHARGE anywhere with value nearby
    const fuelMatch = text.match(/(?:CHGS\s+FOR\s+)?FUEL\s+SURCHARGE[\s\S]{0,30}?([\d,]+\.\d{2})/i);
    if (fuelMatch) {
      const value = parseMoney(fuelMatch[1]);
      if (value > 0 && value < 10000) {
        adjustments.push({
          type: 'fee',
          description: 'Fuel Surcharge',
          amountCents: value,
          raw: fuelMatch[0]
        });
        console.log(`[GENERIC ADJ] Fallback found Fuel Surcharge: $${(value/100).toFixed(2)}`);
      }
    }

    // Look for DROP SIZE ALLOWANCE anywhere with value nearby
    const dropMatch = text.match(/(?:ALLOWANCE\s+FOR\s+)?DROP\s+SIZE[\s\S]{0,30}?([\d,]+\.\d{2})([\-])?/i);
    if (dropMatch) {
      const value = parseMoney(dropMatch[1]);
      if (value > 0 && value < 100000) {
        adjustments.push({
          type: 'credit',
          description: 'Drop Size Allowance',
          amountCents: -value,
          raw: dropMatch[0]
        });
        console.log(`[GENERIC ADJ] Fallback found Drop Size Allowance: -$${(value/100).toFixed(2)}`);
      }
    }
  }

  // Calculate net adjustments
  const totalAdjustmentsCents = adjustments.reduce((sum, adj) => sum + adj.amountCents, 0);

  console.log(`[GENERIC ADJ] Total adjustments: ${adjustments.length} items, net: $${(totalAdjustmentsCents/100).toFixed(2)}`);

  return {
    adjustments,
    totalAdjustmentsCents
  };
}

/**
 * Extract line items from generic invoice using table detection
 */
function extractGenericLineItems(text, lines) {
  const items = [];

  // Find table header
  let tableStartIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isTableHeader(lines[i])) {
      tableStartIdx = i;
      break;
    }
  }

  // If no clear table header, look for patterns
  if (tableStartIdx === -1) {
    // Look for first line with item-like structure
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Line with description and numbers at the end
      if (/[A-Za-z].+\d+\.?\d*\s*$/.test(line) && line.length > 20) {
        tableStartIdx = i;
        break;
      }
    }
  }

  if (tableStartIdx === -1) return items;

  // Max reasonable line item price: $20,000 for restaurant supplies
  const MAX_LINE_ITEM_CENTS = 2000000;

  // Parse lines from table start
  for (let i = tableStartIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Stop at invoice-level totals section
    if (/^(SUB)?TOTAL\s*(USD|DUE)?/i.test(line) || /^TAX\s*\$/i.test(line)) break;
    if (/^INVOICE\s+TOTAL/i.test(line)) break;

    // Skip headers and group subtotals (including Sysco's GROUP TOTAL****)
    if (isTableHeader(line) || isGroupSubtotal(line)) continue;
    if (/GROUP\s+TOTAL/i.test(line)) continue;  // Explicit Sysco GROUP TOTAL filter

    // Skip ORDER SUMMARY section - order numbers look like prices (7-digit numbers)
    if (/ORDER\s*SUMMARY/i.test(line)) continue;
    if (/\d{7}\s+\d{7}/i.test(line)) continue;  // Multiple 7-digit numbers = order numbers

    // Skip MISC CHARGES section - these are fees, not line items
    if (/MISC\s*CHARGES/i.test(line)) continue;
    if (/ALLOWANCE\s+FOR/i.test(line)) continue;
    if (/DROP\s+SIZE/i.test(line)) continue;

    // Skip fuel surcharge lines
    if (/FUEL\s*SURCHARGE/i.test(line)) continue;
    if (/CHGS\s+FOR/i.test(line)) continue;

    // Try to parse as item row (right-anchored numbers)
    const numbers = extractTailNumbers(line);
    if (numbers.length >= 1) {
      const lastNum = numbers[numbers.length - 1];
      const lineTotal = lastNum.value;

      // Get description (everything before the numbers)
      const descEnd = numbers[0].index;
      const description = line.slice(0, descEnd).trim();

      if (description && lineTotal > 0) {
        // Try to extract qty and unit price if we have multiple numbers
        let qty = 1;
        let unitPrice = lineTotal;

        if (numbers.length >= 2) {
          unitPrice = numbers[numbers.length - 2].value;
        }
        if (numbers.length >= 3) {
          const possibleQty = numbers[numbers.length - 3].value;
          if (possibleQty >= 1 && possibleQty <= 9999 && Number.isInteger(possibleQty)) {
            qty = possibleQty;
          }
        }

        // Use precision processing for accurate calculations
        const unitPriceDollars = parseMoneyToDollars(unitPrice, 3);
        const unitPriceCents = Math.round(unitPriceDollars * 100);
        const lineTotalCents = Math.round(lineTotal * 100);
        const computedTotalCents = calculateLineTotalCents(qty, unitPriceDollars);

        // Sanity check: reject absurdly high prices (likely order numbers misread as prices)
        if (unitPriceCents < MAX_LINE_ITEM_CENTS && lineTotalCents < MAX_LINE_ITEM_CENTS) {
          // Extract SKU using universal patterns (handles dashed, alphanumeric, pure digits)
          const sku = extractSku(description) || extractSku(line);

          items.push({
            type: 'item',
            sku: sku,
            description: description,
            qty: qty,
            unitPriceDollars: unitPriceDollars,
            unitPriceCents: unitPriceCents,
            lineTotalCents: lineTotalCents,
            computedTotalCents: computedTotalCents,
            taxFlag: null,
            raw: line
          });
        }
      }
    }
  }

  return items;
}

/**
 * Main generic parser function
 * Now uses adaptive parsing when traditional approach yields poor results
 */
function parseGenericInvoice(normalizedText, options = {}) {
  const lines = normalizedText.split('\n');

  // First, analyze the layout to understand the invoice structure
  const layout = analyzeLayout(normalizedText);
  const hints = generateParsingHints(layout);

  // Extract header and totals first (these are relatively reliable)
  const header = parseGenericHeader(normalizedText, lines);
  let totals = extractGenericTotals(normalizedText, lines);

  // Extract fees and adjustments (fuel surcharge, allowances, credits, etc.)
  const miscCharges = extractGenericAdjustments(normalizedText, lines);

  // CRITICAL: Validate totals using core extraction
  // This ensures we get the correct INVOICE TOTAL
  console.log(`[GENERIC PARSER] Validating totals with core extractor...`);
  totals = validateParserTotals(totals, normalizedText, 'generic');

  // Try traditional line item extraction first
  let lineItems = extractGenericLineItems(normalizedText, lines);
  let parsingMethod = 'traditional';

  // If traditional parsing yields poor results, try adaptive parsing
  if (lineItems.length < 2 || !hasValidItems(lineItems)) {
    try {
      const adaptiveResult = parseAdaptive(normalizedText, { totals });

      if (adaptiveResult.success && adaptiveResult.lineItems.length > 0) {
        // Check if adaptive result is better
        const adaptiveValid = countValidItems(adaptiveResult.lineItems);
        const traditionalValid = countValidItems(lineItems);

        if (adaptiveValid > traditionalValid) {
          lineItems = adaptiveResult.lineItems;
          parsingMethod = adaptiveResult.strategy || 'adaptive';
        }
      }
    } catch (err) {
      console.error('[GENERIC PARSER] Adaptive parsing error:', err.message);
    }
  }

  // Validate and fix line items
  const validatedItems = validateAndFixLineItems(lineItems);

  // Add adjustments to totals for validation
  totals.adjustmentsCents = miscCharges.totalAdjustmentsCents;
  totals.adjustments = miscCharges.adjustments;

  // Calculate confidence (now considering adjustments for accuracy)
  const confidence = calculateGenericConfidence(validatedItems, totals, layout, miscCharges);

  const result = {
    vendorKey: 'generic',
    parserVersion: '2.3.0',  // Bumped for 3 decimal precision support
    header: header,
    totals: totals,
    lineItems: validatedItems,
    adjustments: miscCharges.adjustments,  // Include adjustments separately
    employees: [],
    departments: [],
    confidence: confidence,
    debug: {
      parseAttempts: ['generic', parsingMethod],
      rawLineCount: lines.length,
      layout: {
        itemSection: layout.itemSection,
        pricePattern: layout.pricePattern?.type,
        columnPattern: layout.columnPattern?.type
      },
      parsingHints: hints.strategies,
      mathCorrectedItems: validatedItems.filter(i => i.mathCorrected).length,
      adjustmentsFound: miscCharges.adjustments.length,
      netAdjustmentsCents: miscCharges.totalAdjustmentsCents
    }
  };

  return result;
}

/**
 * Check if items have valid structure
 */
function hasValidItems(items) {
  if (!items || items.length === 0) return false;

  const validCount = countValidItems(items);
  return validCount >= Math.max(1, items.length * 0.5);
}

/**
 * Count items with valid math (qty × price ≈ total)
 */
function countValidItems(items) {
  let valid = 0;
  for (const item of items) {
    const qty = item.qty || item.quantity || 1;
    const unitPrice = item.unitPriceCents || 0;
    const lineTotal = item.lineTotalCents || 0;

    if (lineTotal > 0) {
      const computed = qty * unitPrice;
      const diff = Math.abs(computed - lineTotal);
      if (diff <= 10 || diff / lineTotal <= 0.01) {
        valid++;
      }
    }
  }
  return valid;
}

/**
 * Calculate confidence score for generic parse
 * Now considers adjustments for more accurate validation
 */
function calculateGenericConfidence(lineItems, totals, layout, miscCharges = { adjustments: [], totalAdjustmentsCents: 0 }) {
  let score = 40;  // Lower base for generic
  const issues = [];
  const warnings = [];

  // Item count
  if (lineItems.length === 0) {
    score -= 25;
    issues.push('No line items extracted');
  } else {
    score += Math.min(15, lineItems.length * 1.5);
  }

  // Totals found
  if (totals.totalCents > 0) {
    score += 15;
  } else {
    issues.push('No invoice total found');
  }

  // Math validation
  const validItems = countValidItems(lineItems);
  if (lineItems.length > 0) {
    const validRate = validItems / lineItems.length;
    if (validRate >= 0.8) {
      score += 15;
    } else if (validRate >= 0.5) {
      score += 8;
    } else {
      score -= 10;
      warnings.push(`Only ${Math.round(validRate * 100)}% of items have valid math`);
    }
  }

  // Sum vs total reconciliation - NOW INCLUDING ADJUSTMENTS
  // Formula: lineItemsSum + tax + adjustments ≈ total
  if (lineItems.length > 0 && totals.totalCents > 0) {
    const lineItemsSum = lineItems.reduce((s, i) => s + (i.lineTotalCents || 0), 0);
    const adjustmentsSum = miscCharges.totalAdjustmentsCents || 0;
    const taxCents = totals.taxCents || 0;

    // Calculate what the total SHOULD be
    const computedTotal = lineItemsSum + taxCents + adjustmentsSum;
    const diff = Math.abs(computedTotal - totals.totalCents);
    const pct = totals.totalCents > 0 ? diff / totals.totalCents : 1;

    console.log(`[GENERIC CONF] Reconciliation: items=$${(lineItemsSum/100).toFixed(2)} + tax=$${(taxCents/100).toFixed(2)} + adj=$${(adjustmentsSum/100).toFixed(2)} = $${(computedTotal/100).toFixed(2)} vs invoice=$${(totals.totalCents/100).toFixed(2)} (diff=${(pct*100).toFixed(1)}%)`);

    if (pct <= 0.01) {
      score += 20;  // Excellent match - bonus for adjustments helping
    } else if (pct <= 0.02) {
      score += 15;
    } else if (pct <= 0.05) {
      score += 10;
    } else if (pct <= 0.10) {
      score += 5;
      warnings.push(`Computed total differs from invoice by ${(pct * 100).toFixed(1)}%`);
    } else if (pct <= 0.25) {
      warnings.push(`Items+tax+adjustments differs from total by ${(pct * 100).toFixed(1)}%`);
    } else {
      issues.push(`Large mismatch: computed $${(computedTotal/100).toFixed(2)} vs invoice $${(totals.totalCents/100).toFixed(2)}`);
    }
  }

  // Bonus for finding adjustments (more complete parsing)
  if (miscCharges.adjustments.length > 0) {
    score += 5;
    console.log(`[GENERIC CONF] Found ${miscCharges.adjustments.length} adjustments worth $${(miscCharges.totalAdjustmentsCents/100).toFixed(2)}`);
  }

  // Layout detection bonus
  if (layout.itemSection.startLine !== null) {
    score += 5;
  }

  // Penalty for unknown vendor
  warnings.push('Using generic parser - manual review recommended');

  return {
    score: Math.max(0, Math.min(100, score)),
    issues,
    warnings
  };
}

module.exports = {
  parseGenericInvoice,
  parseGenericHeader,
  extractGenericTotals,
  extractGenericLineItems,
  extractGenericAdjustments,
  calculateGenericConfidence,
  hasValidItems,
  countValidItems
};
