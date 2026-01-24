/**
 * Invoice Parsing V2 - Generic Parser
 * Fallback parser for unknown vendors using heuristic approaches
 * Now enhanced with adaptive parsing and layout analysis
 */

const {
  parseMoney,
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
 * Extract totals from generic invoice using bottom-up scanning
 */
function extractGenericTotals(text, lines) {
  const totals = {
    subtotalCents: 0,
    taxCents: 0,
    totalCents: 0,
    currency: 'USD',
    debug: {}
  };

  // First, try to find "INVOICE TOTAL" specifically (handles line breaks)
  // This is most reliable for Sysco invoices
  const invoiceTotalMatch = text.match(/INVOICE[\s\n]*TOTAL[\s:\n]*\$?([\d,]+\.?\d*)/gi);
  if (invoiceTotalMatch && invoiceTotalMatch.length > 0) {
    // Get the last match (final INVOICE TOTAL on the document)
    const lastMatch = invoiceTotalMatch[invoiceTotalMatch.length - 1];
    const valueMatch = lastMatch.match(/\$?([\d,]+\.?\d*)\s*$/);
    if (valueMatch) {
      const total = parseMoney(valueMatch[1]);
      if (total > 0) {
        totals.totalCents = total;
        // Continue to find subtotal and tax but don't overwrite total
      }
    }
  }

  // Common total patterns - ordered by specificity (most specific first)
  const totalPatterns = [
    /INVOICE[\s\n]+TOTAL[:\s]*\$?([\d,]+\.?\d*)/i,  // Sysco uses "INVOICE TOTAL"
    /GRAND\s+TOTAL[:\s]*\$?([\d,]+\.?\d*)/i,
    /TOTAL\s+DUE[:\s]*\$?([\d,]+\.?\d*)/i,
    /AMOUNT\s+DUE[:\s]*\$?([\d,]+\.?\d*)/i,
    /BALANCE\s+DUE[:\s]*\$?([\d,]+\.?\d*)/i,
    /TOTAL\s*(?:AMOUNT|USD)?[:\s]*\$?([\d,]+\.?\d*)/i
  ];

  const subtotalPatterns = [
    /SUB[\s\-]?TOTAL[:\s]*\$?([\d,]+\.?\d*)/i,
    /SUBTOTAL[:\s]*\$?([\d,]+\.?\d*)/i
  ];

  const taxPatterns = [
    /(?:SALES\s+)?TAX[:\s]*\$?([\d,]+\.?\d*)/i,
    /VAT[:\s]*\$?([\d,]+\.?\d*)/i
  ];

  // Scan from bottom
  const matches = scanFromBottom(lines, [...totalPatterns, ...subtotalPatterns, ...taxPatterns], 80);

  for (const { line, match, pattern } of matches) {
    // Skip group subtotals
    if (isGroupSubtotal(line)) continue;

    const value = parseMoney(match[1]);
    if (value <= 0) continue;

    // Categorize the match (don't overwrite if already found via INVOICE TOTAL)
    if (totalPatterns.some(p => p.source === pattern.source) && totals.totalCents === 0) {
      totals.totalCents = value;
    }
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

        const unitPriceCents = Math.round(unitPrice * 100);
        const lineTotalCents = Math.round(lineTotal * 100);

        // Sanity check: reject absurdly high prices (likely order numbers misread as prices)
        if (unitPriceCents < MAX_LINE_ITEM_CENTS && lineTotalCents < MAX_LINE_ITEM_CENTS) {
          items.push({
            type: 'item',
            sku: null,
            description: description,
            qty: qty,
            unitPriceCents: unitPriceCents,
            lineTotalCents: lineTotalCents,
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
  const totals = extractGenericTotals(normalizedText, lines);

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

  // Calculate confidence
  const confidence = calculateGenericConfidence(validatedItems, totals, layout);

  const result = {
    vendorKey: 'generic',
    parserVersion: '2.1.0',
    header: header,
    totals: totals,
    lineItems: validatedItems,
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
      mathCorrectedItems: validatedItems.filter(i => i.mathCorrected).length
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
 */
function calculateGenericConfidence(lineItems, totals, layout) {
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

  // Sum vs total reconciliation
  if (lineItems.length > 0 && totals.totalCents > 0) {
    const sum = lineItems.reduce((s, i) => s + (i.lineTotalCents || 0), 0);
    const diff = Math.abs(sum - totals.totalCents);
    const pct = diff / totals.totalCents;

    if (pct <= 0.02) {
      score += 15;
    } else if (pct <= 0.10) {
      score += 8;
    } else if (pct <= 0.25) {
      warnings.push(`Items sum differs from total by ${(pct * 100).toFixed(1)}%`);
    } else {
      issues.push('Large mismatch between items sum and total');
    }
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
  calculateGenericConfidence,
  hasValidItems,
  countValidItems
};
