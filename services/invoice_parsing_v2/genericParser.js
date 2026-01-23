/**
 * Invoice Parsing V2 - Generic Parser
 * Fallback parser for unknown vendors using heuristic approaches
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

  // Common total patterns - ordered by specificity (most specific first)
  const totalPatterns = [
    /INVOICE\s+TOTAL[:\s]*\$?([\d,]+\.?\d*)/i,  // Sysco uses "INVOICE TOTAL"
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

    // Categorize the match
    if (totalPatterns.some(p => p.source === pattern.source) && totals.totalCents === 0) {
      totals.totalCents = value;
    } else if (subtotalPatterns.some(p => p.source === pattern.source) && totals.subtotalCents === 0) {
      totals.subtotalCents = value;
    } else if (taxPatterns.some(p => p.source === pattern.source) && totals.taxCents === 0) {
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

        items.push({
          type: 'item',
          sku: null,
          description: description,
          qty: qty,
          unitPriceCents: Math.round(unitPrice * 100),
          lineTotalCents: Math.round(lineTotal * 100),
          taxFlag: null,
          raw: line
        });
      }
    }
  }

  return items;
}

/**
 * Main generic parser function
 */
function parseGenericInvoice(normalizedText, options = {}) {
  const lines = normalizedText.split('\n');

  const result = {
    vendorKey: 'generic',
    parserVersion: '2.0.0',
    header: parseGenericHeader(normalizedText, lines),
    totals: extractGenericTotals(normalizedText, lines),
    lineItems: extractGenericLineItems(normalizedText, lines),
    employees: [],
    departments: [],
    debug: {
      parseAttempts: ['generic'],
      rawLineCount: lines.length
    }
  };

  return result;
}

module.exports = {
  parseGenericInvoice,
  parseGenericHeader,
  extractGenericTotals,
  extractGenericLineItems
};
