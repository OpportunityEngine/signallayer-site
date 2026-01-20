// =====================================================
// INVOICE EXTRACTOR
// Structure-aware parsing of OCR text into invoice fields
// =====================================================

// Date patterns (various formats)
const DATE_PATTERNS = [
  /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/g,           // MM/DD/YYYY, DD-MM-YYYY
  /(\w{3,9})\s+(\d{1,2}),?\s+(\d{4})/gi,                     // January 15, 2024
  /(\d{1,2})\s+(\w{3,9})\s+(\d{4})/gi,                       // 15 January 2024
  /(\d{4})[\/\-](\d{2})[\/\-](\d{2})/g                       // YYYY-MM-DD
];

// Invoice number patterns - more specific to avoid false positives
const INVOICE_NUMBER_PATTERNS = [
  /invoice\s*#[\s:\-]*([A-Z0-9][\w\-]{3,20})/gi,    // "Invoice #: INV-123"
  /invoice\s*(?:no\.?|number)[\s:\-]*([A-Z0-9][\w\-]{3,20})/gi,  // "Invoice Number: 123"
  /inv[\s#:\-]+([A-Z0-9][\w\-]{3,20})/gi,
  /(?:receipt|order|po|ref)\s*(?:#|no\.?)[\s:\-]*([A-Z0-9][\w\-]{3,20})/gi,
  /(?:#|no\.?)[\s:]*([A-Z]{2,4}[\-]?\d{4,}[\w\-]*)/gi
];

// Currency patterns
const CURRENCY_PATTERNS = {
  USD: /\$|USD|US\s*\$/i,
  EUR: /€|EUR/i,
  GBP: /£|GBP/i,
  CAD: /CAD|C\$/i
};

// Totals extraction patterns
const TOTALS_PATTERNS = {
  total: [
    /(?:grand\s*)?total[\s:]*\$?([\d,]+\.?\d*)/gi,
    /(?:amount\s*due|balance\s*due)[\s:]*\$?([\d,]+\.?\d*)/gi,
    /(?:total\s*amount)[\s:]*\$?([\d,]+\.?\d*)/gi
  ],
  subtotal: [
    /sub[\s\-]*total[\s:]*\$?([\d,]+\.?\d*)/gi,
    /(?:net|merchandise)[\s:]*\$?([\d,]+\.?\d*)/gi
  ],
  tax: [
    /(?:tax|vat|gst|hst)[\s:]*\$?([\d,]+\.?\d*)/gi,
    /(?:sales\s*tax)[\s:]*\$?([\d,]+\.?\d*)/gi,
    /(\d+\.?\d*)%?\s*tax/gi
  ],
  shipping: [
    /(?:shipping|freight|delivery)[\s:]*\$?([\d,]+\.?\d*)/gi
  ],
  discount: [
    /(?:discount|savings)[\s:]*[\-\(]?\$?([\d,]+\.?\d*)/gi
  ]
};

/**
 * Extract structured invoice data from OCR text
 */
function extract(text, options = {}) {
  const result = {
    vendor: null,
    date: null,
    invoiceNumber: null,
    totals: {
      subtotal: null,
      tax: null,
      taxRate: null,
      shipping: null,
      discount: null,
      total: null
    },
    address: null,
    lineItems: [],
    currency: 'USD',
    ambiguous: false,
    extractionNotes: []
  };

  if (!text || text.length < 20) {
    result.extractionNotes.push('Text too short for extraction');
    return result;
  }

  const lines = text.split('\n').map(l => l.trim()).filter(l => l);

  // =========================================
  // Extract vendor name
  // =========================================
  result.vendor = extractVendor(lines, text);
  if (result.vendor) {
    result.extractionNotes.push(`Vendor: ${result.vendor}`);
  }

  // =========================================
  // Extract date
  // =========================================
  result.date = extractDate(text);
  if (result.date) {
    result.extractionNotes.push(`Date: ${result.date}`);
  }

  // =========================================
  // Extract invoice number
  // =========================================
  result.invoiceNumber = extractInvoiceNumber(text);
  if (result.invoiceNumber) {
    result.extractionNotes.push(`Invoice #: ${result.invoiceNumber}`);
  }

  // =========================================
  // Extract currency
  // =========================================
  result.currency = extractCurrency(text);

  // =========================================
  // Extract totals
  // =========================================
  result.totals = extractTotals(text);
  if (result.totals.total) {
    result.extractionNotes.push(`Total: ${result.totals.total}`);
  }

  // =========================================
  // Extract address
  // =========================================
  result.address = extractAddress(text, lines);

  // =========================================
  // Extract line items
  // =========================================
  const lineItemsResult = extractLineItems(lines, text);
  result.lineItems = lineItemsResult.items;
  result.ambiguous = lineItemsResult.ambiguous;
  result.extractionNotes.push(`Line items: ${result.lineItems.length}`);

  // =========================================
  // Validate totals against line items
  // =========================================
  if (result.lineItems.length > 0 && result.totals.total) {
    const lineItemSum = result.lineItems.reduce((sum, item) =>
      sum + (item.totalCents || 0), 0);
    const totalCents = Math.round(result.totals.total * 100);

    if (Math.abs(lineItemSum - totalCents) > totalCents * 0.1) {
      result.extractionNotes.push(`Warning: Line items sum (${lineItemSum}) differs from total (${totalCents})`);
      result.ambiguous = true;
    }
  }

  return result;
}

/**
 * Extract vendor name from text
 */
function extractVendor(lines, text) {
  // Look for explicit vendor labels
  const vendorPatterns = [
    /(?:from|vendor|sold\s*by|supplier)[\s:]+([A-Za-z0-9\s&,\.]+)/i,
    /(?:company|business)[\s:]+([A-Za-z0-9\s&,\.]+)/i
  ];

  for (const pattern of vendorPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return cleanVendorName(match[1]);
    }
  }

  // Heuristic: First substantial text line often contains vendor name
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const line = lines[i];
    // Skip lines that look like addresses or dates
    if (/^\d/.test(line)) continue;
    if (/invoice|receipt|order|date|page/i.test(line)) continue;
    if (line.length > 50) continue;

    // Look for company-like names
    if (/inc|llc|corp|ltd|company|co\.|restaurant|food|supply|service/i.test(line)) {
      return cleanVendorName(line);
    }

    // First substantial alphabetic line
    if (line.length >= 5 && /^[A-Za-z]/.test(line) && !/^\d{1,2}[\/\-]/.test(line)) {
      return cleanVendorName(line);
    }
  }

  return null;
}

/**
 * Clean vendor name
 */
function cleanVendorName(name) {
  return name
    .replace(/[^\w\s&,\.'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 100);
}

/**
 * Extract date from text
 */
function extractDate(text) {
  const dates = [];

  for (const pattern of DATE_PATTERNS) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      dates.push(match[0]);
    }
  }

  // Look for labeled dates
  const labeledDate = text.match(/(?:date|dated|invoice\s*date)[\s:]+([^\n]+)/i);
  if (labeledDate) {
    const dateLine = labeledDate[1];
    for (const pattern of DATE_PATTERNS) {
      const match = dateLine.match(pattern);
      if (match) {
        return match[0];
      }
    }
  }

  // Return first found date
  return dates.length > 0 ? dates[0] : null;
}

/**
 * Extract invoice number
 */
function extractInvoiceNumber(text) {
  // Use non-global patterns for capture groups
  const patterns = [
    /invoice\s*#[\s:\-]*([A-Z0-9][\w\-]{3,20})/i,
    /invoice\s*(?:no\.?|number)[\s:\-]*([A-Z0-9][\w\-]{3,20})/i,
    /inv[\s#:\-]+([A-Z0-9][\w\-]{3,20})/i,
    /(?:receipt|order|po|ref)\s*(?:#|no\.?)[\s:\-]*([A-Z0-9][\w\-]{3,20})/i,
    /(?:#|no\.)[\s:]*([A-Z]{2,4}[\-]?\d{4,}[\w\-]*)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const invNum = match[1].trim();
      if (invNum.length >= 3 && invNum.length <= 30) {
        return invNum;
      }
    }
  }
  return null;
}

/**
 * Extract currency
 */
function extractCurrency(text) {
  for (const [currency, pattern] of Object.entries(CURRENCY_PATTERNS)) {
    if (pattern.test(text)) {
      return currency;
    }
  }
  return 'USD';
}

/**
 * Extract totals from text
 */
function extractTotals(text) {
  const totals = {
    subtotal: null,
    tax: null,
    taxRate: null,
    shipping: null,
    discount: null,
    total: null
  };

  const parseAmount = (str) => {
    if (!str) return null;
    const cleaned = str.replace(/[,$]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  };

  // Extract each total type
  for (const [key, patterns] of Object.entries(TOTALS_PATTERNS)) {
    for (const pattern of patterns) {
      const matches = [...text.matchAll(pattern)];
      if (matches.length > 0) {
        // Take the last match (usually more accurate)
        const lastMatch = matches[matches.length - 1];
        totals[key] = parseAmount(lastMatch[1]);
        break;
      }
    }
  }

  // Extract tax rate if present
  const taxRateMatch = text.match(/(\d+\.?\d*)%\s*(?:tax|vat|gst)/i);
  if (taxRateMatch) {
    totals.taxRate = parseFloat(taxRateMatch[1]);
  }

  return totals;
}

/**
 * Extract address from text
 */
function extractAddress(text, lines) {
  // Look for address blocks
  const addressPatterns = [
    /(?:ship\s*to|bill\s*to|address)[\s:]+([^\n]+(?:\n[^\n]+){0,3})/i,
    /(\d+\s+[A-Za-z\s]+(?:street|st|avenue|ave|road|rd|blvd|lane|ln|drive|dr)[^\n]*)/i
  ];

  for (const pattern of addressPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim().replace(/\n+/g, ', ').substring(0, 200);
    }
  }

  // Look for city, state, zip pattern
  const cityStateZip = text.match(/([A-Za-z\s]+),?\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)/);
  if (cityStateZip) {
    return `${cityStateZip[1]}, ${cityStateZip[2]} ${cityStateZip[3]}`;
  }

  return null;
}

/**
 * Extract line items from text
 */
function extractLineItems(lines, fullText) {
  const result = {
    items: [],
    ambiguous: false
  };

  // Strategy 1: Table-like structure detection
  const tableItems = extractTableLineItems(lines);
  if (tableItems.length > 0) {
    result.items = tableItems;
    return result;
  }

  // Strategy 2: Price-anchored extraction
  const priceItems = extractPriceAnchoredItems(lines);
  if (priceItems.length > 0) {
    result.items = priceItems;
    result.ambiguous = true; // Price-only extraction is less reliable
    return result;
  }

  // Strategy 3: Quantity-description-price pattern
  const qtyItems = extractQtyDescPriceItems(lines);
  if (qtyItems.length > 0) {
    result.items = qtyItems;
    return result;
  }

  return result;
}

/**
 * Extract items from table-like structure
 */
function extractTableLineItems(lines) {
  const items = [];

  // Common table patterns - more flexible with whitespace
  const tablePatterns = [
    // DESC ... QTY ... UNIT_PRICE ... TOTAL (with flexible spaces)
    /^(.+?)\s{2,}(\d+)\s+\$?([\d,]+\.?\d{2})\s+\$?([\d,]+\.?\d{2})$/,
    // QTY DESCRIPTION UNIT TOTAL
    /^(\d+)\s+(.+?)\s+\$?([\d,]+\.?\d{2})\s+\$?([\d,]+\.?\d{2})$/,
    // DESCRIPTION QTY PRICE
    /^(.+?)\s{2,}(\d+)\s+\$?([\d,]+\.?\d{2})$/,
    // SKU DESCRIPTION QTY UNIT TOTAL
    /^([A-Z0-9\-]{3,15})\s+(.+?)\s+(\d+)\s+\$?([\d,]+\.?\d{2})\s+\$?([\d,]+\.?\d{2})$/,
    // Simple: DESCRIPTION $PRICE (must end with decimal)
    /^(.{5,}?)\s+\$?([\d,]+\.\d{2})$/
  ];

  for (const line of lines) {
    // Skip header lines
    if (/^(qty|quantity|description|item|price|unit|total|amount|sku)/i.test(line)) continue;
    if (/^[\-=]+$/.test(line)) continue;
    // Skip totals section
    if (/subtotal|grand\s*total|tax|balance|due|shipping|discount/i.test(line)) continue;

    for (const pattern of tablePatterns) {
      const match = line.match(pattern);
      if (match) {
        let item = null;

        // Pattern: DESC QTY UNIT TOTAL (4 captures)
        if (match.length === 5 && /^[A-Za-z]/.test(match[1])) {
          item = {
            description: match[1].trim(),
            quantity: parseFloat(match[2]) || 1,
            unitPriceCents: Math.round(parseFloat(match[3].replace(/,/g, '')) * 100),
            totalCents: Math.round(parseFloat(match[4].replace(/,/g, '')) * 100)
          };
        }
        // Pattern: QTY DESC UNIT TOTAL (4 captures, starts with number)
        else if (match.length === 5 && /^\d/.test(match[1])) {
          item = {
            description: match[2].trim(),
            quantity: parseFloat(match[1]) || 1,
            unitPriceCents: Math.round(parseFloat(match[3].replace(/,/g, '')) * 100),
            totalCents: Math.round(parseFloat(match[4].replace(/,/g, '')) * 100)
          };
        }
        // Pattern: SKU DESC QTY UNIT TOTAL (5 captures)
        else if (match.length === 6) {
          item = {
            sku: match[1],
            description: match[2].trim(),
            quantity: parseFloat(match[3]) || 1,
            unitPriceCents: Math.round(parseFloat(match[4].replace(/,/g, '')) * 100),
            totalCents: Math.round(parseFloat(match[5].replace(/,/g, '')) * 100)
          };
        }
        // Pattern: DESC QTY PRICE (3 captures)
        else if (match.length === 4) {
          const price = parseFloat(match[3].replace(/,/g, ''));
          const qty = parseFloat(match[2]) || 1;
          item = {
            description: match[1].trim(),
            quantity: qty,
            totalCents: Math.round(price * 100)
          };
        }
        // Pattern: DESC PRICE (2 captures)
        else if (match.length === 3) {
          item = {
            description: match[1].trim(),
            quantity: 1,
            totalCents: Math.round(parseFloat(match[2].replace(/,/g, '')) * 100)
          };
        }

        if (item && item.description && item.description.length > 2) {
          // Skip totals/tax lines that might be caught
          if (!/^(sub)?total|^tax|^amount|^balance|^due/i.test(item.description)) {
            items.push(item);
          }
        }
        break;
      }
    }
  }

  return items;
}

/**
 * Extract items anchored by prices
 */
function extractPriceAnchoredItems(lines) {
  const items = [];
  const pricePattern = /\$?([\d,]+\.\d{2})\s*$/;

  for (const line of lines) {
    const match = line.match(pricePattern);
    if (match) {
      const price = parseFloat(match[1].replace(/,/g, ''));
      const description = line.replace(pricePattern, '').trim();

      // Skip total/tax lines
      if (/^(sub)?total|^tax|^amount|^balance|^due|^shipping/i.test(description)) continue;
      if (description.length < 3) continue;

      items.push({
        description,
        quantity: 1,
        totalCents: Math.round(price * 100)
      });
    }
  }

  return items;
}

/**
 * Extract QTY DESC PRICE pattern items
 */
function extractQtyDescPriceItems(lines) {
  const items = [];
  const pattern = /^(\d+(?:\.\d+)?)\s*[xX]?\s+(.+?)\s+@?\s*\$?([\d,]+\.?\d*)/;

  for (const line of lines) {
    const match = line.match(pattern);
    if (match) {
      const qty = parseFloat(match[1]);
      const desc = match[2].trim();
      const price = parseFloat(match[3].replace(/,/g, ''));

      if (desc.length > 2 && !isNaN(price)) {
        items.push({
          description: desc,
          quantity: qty,
          unitPriceCents: Math.round(price * 100),
          totalCents: Math.round(price * qty * 100)
        });
      }
    }
  }

  return items;
}

module.exports = {
  extract,
  extractVendor,
  extractDate,
  extractInvoiceNumber,
  extractTotals,
  extractLineItems
};
