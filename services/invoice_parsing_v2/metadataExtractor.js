/**
 * Universal Metadata Extractor
 *
 * Extracts invoice metadata (number, date, location, customer) from ANY invoice format.
 * Uses multiple strategies and scoring to find the most reliable values.
 *
 * This is designed to be vendor-agnostic and handle OCR errors gracefully.
 */

/**
 * Extract all metadata from invoice text
 * Returns the best-confidence values for each field
 */
function extractAllMetadata(text, options = {}) {
  const vendorHint = options.vendor || options.vendorKey || null;

  const metadata = {
    invoiceNumber: extractInvoiceNumber(text, vendorHint),
    invoiceDate: extractInvoiceDate(text, vendorHint),
    poNumber: extractPONumber(text),
    location: extractLocation(text),
    customer: extractCustomer(text),
    deliveryDate: extractDeliveryDate(text),
    dueDate: extractDueDate(text),
    salesRep: extractSalesRep(text),
    terms: extractPaymentTerms(text)
  };

  return metadata;
}

/**
 * Extract invoice number with multiple strategies
 */
function extractInvoiceNumber(text, vendorHint) {
  const candidates = [];
  const lines = text.split('\n');

  // Strategy 1: Explicit "Invoice #" or "Invoice Number" labels
  const explicitPatterns = [
    /invoice\s*(?:#|no\.?|number)\s*:?\s*([A-Z0-9\-]{5,20})/gi,
    /inv\s*(?:#|no\.?)\s*:?\s*([A-Z0-9\-]{5,20})/gi,
    /invoice\s*:\s*([A-Z0-9\-]{5,20})/gi
  ];

  for (const pattern of explicitPatterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      candidates.push({
        value: match[1].trim(),
        confidence: 90,
        source: 'explicit_label',
        pattern: pattern.source
      });
    }
  }

  // Strategy 2: Vendor-specific patterns
  if (vendorHint === 'cintas') {
    const cintasMatch = text.match(/\b(\d{10})\b/);
    if (cintasMatch) {
      candidates.push({
        value: cintasMatch[1],
        confidence: 85,
        source: 'cintas_10digit'
      });
    }
  } else if (vendorHint === 'sysco') {
    const syscoMatch = text.match(/INVOICE\s*#?\s*(\d{7,10})/i);
    if (syscoMatch) {
      candidates.push({
        value: syscoMatch[1],
        confidence: 85,
        source: 'sysco_format'
      });
    }
  } else if (vendorHint === 'usfoods') {
    const usfMatch = text.match(/INVOICE\s*(?:NUMBER|#)?\s*:?\s*(\d{8,12})/i);
    if (usfMatch) {
      candidates.push({
        value: usfMatch[1],
        confidence: 85,
        source: 'usfoods_format'
      });
    }
  }

  // Strategy 3: Look for standalone long numbers near "invoice" keyword
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const line = lines[i];
    if (/invoice/i.test(line)) {
      const numMatch = line.match(/(\d{6,15})/);
      if (numMatch) {
        candidates.push({
          value: numMatch[1],
          confidence: 70,
          source: 'near_invoice_keyword',
          lineNumber: i + 1
        });
      }
    }
  }

  // Strategy 4: Look in header area (first 20 lines) for document-number patterns
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const line = lines[i];
    // Pattern: "Doc #: 12345" or "Document: 12345"
    const docMatch = line.match(/(?:doc(?:ument)?|ref(?:erence)?)\s*(?:#|no\.?)?\s*:?\s*([A-Z0-9\-]{5,20})/i);
    if (docMatch) {
      candidates.push({
        value: docMatch[1].trim(),
        confidence: 60,
        source: 'document_reference',
        lineNumber: i + 1
      });
    }
  }

  // Return best candidate
  candidates.sort((a, b) => b.confidence - a.confidence);
  return candidates[0] || null;
}

/**
 * Extract invoice date with multiple strategies
 */
function extractInvoiceDate(text, vendorHint) {
  const candidates = [];

  // Common date formats
  const dateFormats = [
    // MM/DD/YYYY or MM-DD-YYYY
    { regex: /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/, format: 'numeric' },
    // Month DD, YYYY
    { regex: /([A-Z][a-z]{2,8}\s+\d{1,2},?\s+\d{4})/i, format: 'long' },
    // DD Month YYYY
    { regex: /(\d{1,2}\s+[A-Z][a-z]{2,8}\s+\d{4})/i, format: 'european' },
    // YYYY-MM-DD (ISO)
    { regex: /(\d{4}-\d{2}-\d{2})/, format: 'iso' }
  ];

  // Strategy 1: Explicit "Invoice Date" label
  const invoiceDatePatterns = [
    /invoice\s*date\s*:?\s*/gi,
    /inv\s*date\s*:?\s*/gi,
    /date\s+of\s+invoice\s*:?\s*/gi
  ];

  for (const labelPattern of invoiceDatePatterns) {
    const labelMatch = text.match(labelPattern);
    if (labelMatch) {
      // Find date after the label
      const afterLabel = text.slice(labelMatch.index + labelMatch[0].length, labelMatch.index + labelMatch[0].length + 50);
      for (const { regex, format } of dateFormats) {
        const dateMatch = afterLabel.match(regex);
        if (dateMatch) {
          candidates.push({
            value: normalizeDate(dateMatch[1]),
            raw: dateMatch[1],
            confidence: 95,
            source: 'explicit_invoice_date',
            format
          });
          break;
        }
      }
    }
  }

  // Strategy 2: Line containing both "date" and a date pattern (but not delivery/due)
  const lines = text.split('\n');
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const line = lines[i];
    if (/date/i.test(line) && !/delivery|due|ship|order/i.test(line)) {
      for (const { regex, format } of dateFormats) {
        const dateMatch = line.match(regex);
        if (dateMatch) {
          candidates.push({
            value: normalizeDate(dateMatch[1]),
            raw: dateMatch[1],
            confidence: 75,
            source: 'date_keyword_line',
            format,
            lineNumber: i + 1
          });
          break;
        }
      }
    }
  }

  // Strategy 3: First date in header area (first 15 lines)
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const line = lines[i];
    for (const { regex, format } of dateFormats) {
      const dateMatch = line.match(regex);
      if (dateMatch && isValidDate(dateMatch[1])) {
        candidates.push({
          value: normalizeDate(dateMatch[1]),
          raw: dateMatch[1],
          confidence: 50,
          source: 'header_area',
          format,
          lineNumber: i + 1
        });
        break;
      }
    }
  }

  // Return best candidate
  candidates.sort((a, b) => b.confidence - a.confidence);
  return candidates[0] || null;
}

/**
 * Extract PO (Purchase Order) number
 */
function extractPONumber(text) {
  const patterns = [
    /(?:P\.?O\.?\s*(?:#|no\.?|number)?|purchase\s*order)\s*:?\s*([A-Z0-9\-]{3,20})/i,
    /(?:your\s*)?order\s*(?:#|no\.?)?\s*:?\s*([A-Z0-9\-]{5,20})/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return {
        value: match[1].trim(),
        confidence: 80,
        source: 'po_pattern'
      };
    }
  }

  return null;
}

/**
 * Extract delivery/shipping location
 */
function extractLocation(text) {
  const candidates = [];
  const lines = text.split('\n');

  // Strategy 1: Look for "Ship To" or "Deliver To" sections
  let inShipTo = false;
  let shipToLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/(?:ship|deliver|delivery)\s*(?:to|address)/i.test(line)) {
      inShipTo = true;
      continue;
    }

    if (inShipTo) {
      if (shipToLines.length < 4 && line.trim()) {
        shipToLines.push(line.trim());
      }
      // Stop at blank line or next section
      if (!line.trim() || /(?:bill|sold|from|terms|date)/i.test(line)) {
        inShipTo = false;
        if (shipToLines.length > 0) {
          candidates.push({
            type: 'ship_to',
            lines: shipToLines,
            fullAddress: shipToLines.join(', '),
            confidence: 90
          });
          shipToLines = [];
        }
      }
    }
  }

  // Strategy 2: Look for location names (City, ST ZIP pattern)
  const cityStateZip = text.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),?\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/g);
  if (cityStateZip) {
    for (const match of cityStateZip) {
      candidates.push({
        type: 'city_state_zip',
        fullAddress: match,
        confidence: 60
      });
    }
  }

  // Strategy 3: Look for "Location:" label
  const locationMatch = text.match(/location\s*:?\s*([^\n]{5,50})/i);
  if (locationMatch) {
    candidates.push({
      type: 'location_label',
      fullAddress: locationMatch[1].trim(),
      confidence: 85
    });
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  return candidates[0] || null;
}

/**
 * Extract customer/account information
 */
function extractCustomer(text) {
  const candidates = [];
  const lines = text.split('\n');

  // Strategy 1: Look for "Bill To" or "Sold To" sections
  let inBillTo = false;
  let billToLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/(?:bill|sold|customer)\s*(?:to|name)?[\s:]/i.test(line)) {
      inBillTo = true;
      // Check if name is on same line - remove label and any leading colon/spaces
      const sameLine = line.replace(/(?:bill|sold|customer)\s*(?:to|name)?[\s:]+/i, '').trim();
      if (sameLine && sameLine.length > 3 && !/^\d/.test(sameLine)) {
        candidates.push({
          type: 'same_line',
          name: sameLine,
          confidence: 85
        });
      }
      continue;
    }

    if (inBillTo) {
      if (billToLines.length < 3 && line.trim() && !/^\d/.test(line.trim())) {
        billToLines.push(line.trim());
      }
      if (!line.trim() || /(?:ship|from|terms|date|invoice)/i.test(line)) {
        inBillTo = false;
        if (billToLines.length > 0) {
          candidates.push({
            type: 'bill_to_section',
            name: billToLines[0],
            fullAddress: billToLines.join(', '),
            confidence: 80
          });
          billToLines = [];
        }
      }
    }
  }

  // Strategy 2: Account number pattern
  const accountMatch = text.match(/(?:account|acct|customer)\s*(?:#|no\.?|number)?\s*:?\s*([A-Z0-9\-]{4,20})/i);
  if (accountMatch) {
    candidates.push({
      type: 'account_number',
      accountNumber: accountMatch[1].trim(),
      confidence: 70
    });
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  return candidates[0] || null;
}

/**
 * Extract delivery date
 */
function extractDeliveryDate(text) {
  const patterns = [
    /(?:delivery|ship|shipped?)\s*date\s*:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /(?:deliver(?:ed)?|shipped?)\s*(?:on)?\s*:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return {
        value: normalizeDate(match[1]),
        raw: match[1],
        confidence: 85,
        source: 'delivery_date_pattern'
      };
    }
  }

  return null;
}

/**
 * Extract due date
 */
function extractDueDate(text) {
  const patterns = [
    /(?:due|payment\s*due)\s*(?:date)?\s*:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /(?:pay\s*by|payable\s*by)\s*:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return {
        value: normalizeDate(match[1]),
        raw: match[1],
        confidence: 85,
        source: 'due_date_pattern'
      };
    }
  }

  return null;
}

/**
 * Extract sales representative
 */
function extractSalesRep(text) {
  const patterns = [
    /(?:sales\s*rep|salesperson|rep(?:resentative)?)\s*:?\s*([A-Za-z]+(?:\s+[A-Za-z]+)?)/i,
    /(?:your\s*rep|contact)\s*:?\s*([A-Za-z]+(?:\s+[A-Za-z]+)?)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return {
        value: match[1].trim(),
        confidence: 75,
        source: 'sales_rep_pattern'
      };
    }
  }

  return null;
}

/**
 * Extract payment terms
 */
function extractPaymentTerms(text) {
  const patterns = [
    /(?:terms|payment\s*terms)\s*:?\s*(net\s*\d+|due\s*on\s*receipt|cod|prepaid)/i,
    /\b(net\s*\d+)\b/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return {
        value: match[1].trim().toUpperCase(),
        confidence: 80,
        source: 'terms_pattern'
      };
    }
  }

  return null;
}

/**
 * Normalize date to MM/DD/YYYY format
 */
function normalizeDate(dateStr) {
  if (!dateStr) return null;

  // Already in MM/DD/YYYY or MM-DD-YYYY
  const numericMatch = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (numericMatch) {
    let [, month, day, year] = numericMatch;
    if (year.length === 2) {
      year = parseInt(year) > 50 ? '19' + year : '20' + year;
    }
    return `${month.padStart(2, '0')}/${day.padStart(2, '0')}/${year}`;
  }

  // Month DD, YYYY format
  const longMatch = dateStr.match(/([A-Z][a-z]{2,8})\s+(\d{1,2}),?\s+(\d{4})/i);
  if (longMatch) {
    const months = {
      'jan': '01', 'january': '01',
      'feb': '02', 'february': '02',
      'mar': '03', 'march': '03',
      'apr': '04', 'april': '04',
      'may': '05',
      'jun': '06', 'june': '06',
      'jul': '07', 'july': '07',
      'aug': '08', 'august': '08',
      'sep': '09', 'september': '09',
      'oct': '10', 'october': '10',
      'nov': '11', 'november': '11',
      'dec': '12', 'december': '12'
    };
    const month = months[longMatch[1].toLowerCase()] || '01';
    return `${month}/${longMatch[2].padStart(2, '0')}/${longMatch[3]}`;
  }

  // ISO format YYYY-MM-DD
  const isoMatch = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[2]}/${isoMatch[3]}/${isoMatch[1]}`;
  }

  return dateStr; // Return as-is if no pattern matches
}

/**
 * Validate that a string looks like a valid date
 */
function isValidDate(dateStr) {
  if (!dateStr) return false;

  // Check for reasonable date range (1990-2050)
  const numericMatch = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (numericMatch) {
    const [, month, day, yearStr] = numericMatch;
    const year = yearStr.length === 2
      ? (parseInt(yearStr) > 50 ? 1900 + parseInt(yearStr) : 2000 + parseInt(yearStr))
      : parseInt(yearStr);

    if (year < 1990 || year > 2050) return false;
    if (parseInt(month) < 1 || parseInt(month) > 12) return false;
    if (parseInt(day) < 1 || parseInt(day) > 31) return false;

    return true;
  }

  // Check long format
  const longMatch = dateStr.match(/[A-Z][a-z]{2,8}\s+\d{1,2},?\s+\d{4}/i);
  if (longMatch) return true;

  // Check ISO format
  const isoMatch = dateStr.match(/\d{4}-\d{2}-\d{2}/);
  if (isoMatch) return true;

  return false;
}

/**
 * Merge metadata from multiple sources, keeping highest confidence
 */
function mergeMetadata(existingMetadata, newMetadata) {
  const merged = { ...existingMetadata };

  for (const [key, newValue] of Object.entries(newMetadata)) {
    if (!newValue) continue;

    const existing = merged[key];
    if (!existing || (newValue.confidence > (existing.confidence || 0))) {
      merged[key] = newValue;
    }
  }

  return merged;
}

module.exports = {
  extractAllMetadata,
  extractInvoiceNumber,
  extractInvoiceDate,
  extractPONumber,
  extractLocation,
  extractCustomer,
  extractDeliveryDate,
  extractDueDate,
  extractSalesRep,
  extractPaymentTerms,
  normalizeDate,
  isValidDate,
  mergeMetadata
};
