/**
 * Invoice Parsing V2 - Utility Functions
 * Robust helpers for money parsing, validation, and text normalization
 */

/**
 * Parse money string to cents (integer)
 * Handles: $1,234.56, 1234.56, (123.45) for negatives, etc.
 */
function parseMoney(str) {
  if (str === null || str === undefined) return 0;
  if (typeof str === 'number') return Math.round(str * 100);

  const s = String(str).trim();
  if (!s) return 0;

  // Check for negative (parentheses)
  const isNegative = s.startsWith('(') && s.endsWith(')') || s.startsWith('-');

  // Remove currency symbols, commas, parentheses, spaces
  const cleaned = s.replace(/[$€£¥,\s()]/g, '').replace(/^-/, '');

  if (!cleaned) return 0;

  const num = parseFloat(cleaned);
  if (!Number.isFinite(num)) return 0;

  const cents = Math.round(num * 100);
  return isNegative ? -cents : cents;
}

/**
 * Parse quantity string to number
 * Handles integers and decimals
 */
function parseQty(str) {
  if (str === null || str === undefined) return 1;
  if (typeof str === 'number') return str;

  const s = String(str).trim().replace(/,/g, '');
  if (!s) return 1;

  const num = parseFloat(s);
  return Number.isFinite(num) ? num : 1;
}

/**
 * Check if two numbers are nearly equal within tolerance
 * @param {number} a - First value (in cents)
 * @param {number} b - Second value (in cents)
 * @param {number} tolAbs - Absolute tolerance in cents (default 100 = $1)
 * @param {number} tolPct - Percentage tolerance (default 0.01 = 1%)
 */
function nearlyEqual(a, b, tolAbs = 100, tolPct = 0.01) {
  const diff = Math.abs(a - b);
  const maxTol = Math.max(tolAbs, Math.max(Math.abs(a), Math.abs(b)) * tolPct);
  return diff <= maxTol;
}

/**
 * Normalize invoice text for consistent parsing
 * - Unify whitespace but preserve line breaks
 * - Normalize special characters
 * - Handle various encoding issues
 */
function normalizeInvoiceText(text) {
  if (!text) return '';

  let normalized = text;

  // Normalize line endings
  normalized = normalized.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Normalize various dash/hyphen characters to standard hyphen
  normalized = normalized.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-');

  // Normalize apostrophes and quotes
  normalized = normalized.replace(/[\u2018\u2019\u201A\u201B]/g, "'");
  normalized = normalized.replace(/[\u201C\u201D\u201E\u201F]/g, '"');

  // Normalize non-breaking spaces and other whitespace to regular space
  normalized = normalized.replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ');

  // Collapse multiple spaces (but preserve newlines)
  normalized = normalized.replace(/[ \t]+/g, ' ');

  // Trim each line
  normalized = normalized.split('\n').map(line => line.trim()).join('\n');

  // Remove excessive blank lines (max 2 consecutive)
  normalized = normalized.replace(/\n{3,}/g, '\n\n');

  return normalized.trim();
}

/**
 * Split text into pages based on common page break patterns
 */
function splitIntoPages(text) {
  // Common page break patterns
  const pageBreakPatterns = [
    /\f/g,  // Form feed
    /Page \d+ of \d+/gi,
    /--- Page \d+ ---/gi,
    /\n{4,}/g  // Multiple blank lines often indicate page breaks
  ];

  let pages = [text];

  // Try form feed first (most reliable)
  if (text.includes('\f')) {
    pages = text.split('\f').filter(p => p.trim());
  }

  return pages.map(p => p.trim()).filter(Boolean);
}

/**
 * Remove repeated headers/footers from pages
 * Detects patterns that appear at start/end of multiple pages
 */
function removeRepeatedHeadersFooters(pagesText) {
  if (pagesText.length < 2) return pagesText;

  const cleanedPages = [];

  for (let i = 0; i < pagesText.length; i++) {
    let pageLines = pagesText[i].split('\n');

    // Remove common header patterns (first few lines of each page after first)
    if (i > 0 && pageLines.length > 5) {
      // Check for repeated header (compare first 3 lines with first page)
      const firstPageLines = pagesText[0].split('\n').slice(0, 5);
      let headerEndIdx = 0;

      for (let j = 0; j < Math.min(5, pageLines.length); j++) {
        const line = pageLines[j].trim();
        // Skip if it matches first page header or is a page number
        if (firstPageLines.some(h => h.trim() === line) ||
            /^Page \d+/i.test(line) ||
            /^\d+ of \d+$/.test(line)) {
          headerEndIdx = j + 1;
        }
      }

      if (headerEndIdx > 0) {
        pageLines = pageLines.slice(headerEndIdx);
      }
    }

    // Remove common footer patterns (last few lines)
    if (pageLines.length > 5) {
      let footerStartIdx = pageLines.length;

      for (let j = pageLines.length - 1; j >= Math.max(0, pageLines.length - 5); j--) {
        const line = pageLines[j].trim();
        // Common footer patterns
        if (/^Page \d+/i.test(line) ||
            /^\d+ of \d+$/.test(line) ||
            /^Continued on next page/i.test(line)) {
          footerStartIdx = j;
        }
      }

      if (footerStartIdx < pageLines.length) {
        pageLines = pageLines.slice(0, footerStartIdx);
      }
    }

    cleanedPages.push(pageLines.join('\n'));
  }

  return cleanedPages;
}

/**
 * Scan lines from bottom looking for patterns
 * Useful for finding totals which typically appear at the end
 * @param {string[]} lines - Array of lines
 * @param {RegExp[]} patterns - Patterns to search for
 * @param {number} maxLines - Maximum lines from bottom to scan
 * @returns {Object[]} - Matches with line index and match data
 */
function scanFromBottom(lines, patterns, maxLines = 150) {
  const results = [];
  const startIdx = Math.max(0, lines.length - maxLines);

  for (let i = lines.length - 1; i >= startIdx; i--) {
    const line = lines[i];
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        results.push({
          lineIndex: i,
          line: line,
          match: match,
          pattern: pattern
        });
      }
    }
  }

  return results;
}

/**
 * Extract numeric values from the end of a line (right-anchored parsing)
 * Returns array of numbers found, reading right to left
 */
function extractTailNumbers(line) {
  const numbers = [];

  // Match numbers at the end of the line (with optional tax flag)
  // Pattern: ... 12.50 Y or ... 12.50 125.00 N
  const tailMatch = line.match(/(\d[\d,]*\.?\d*)\s*([YN])?\s*$/i);
  if (!tailMatch) return numbers;

  // Now extract all numbers from the line
  const numPattern = /(\d[\d,]*\.?\d*)/g;
  let match;
  while ((match = numPattern.exec(line)) !== null) {
    const num = parseFloat(match[1].replace(/,/g, ''));
    if (Number.isFinite(num)) {
      numbers.push({
        value: num,
        index: match.index,
        raw: match[1]
      });
    }
  }

  return numbers;
}

/**
 * Detect if a line looks like a table header
 */
function isTableHeader(line) {
  const headerKeywords = [
    'DESCRIPTION', 'QTY', 'QUANTITY', 'UNIT', 'PRICE', 'AMOUNT', 'TOTAL',
    'ITEM', 'SKU', 'MATERIAL', 'FREQ', 'EXCH', 'TAX'
  ];

  const lineUpper = line.toUpperCase();
  const matchCount = headerKeywords.filter(kw => lineUpper.includes(kw)).length;

  return matchCount >= 3;
}

/**
 * Detect if a line is likely an employee/group subtotal (not a line item)
 */
function isGroupSubtotal(line) {
  const lineUpper = line.toUpperCase();

  // Patterns that indicate group subtotals (NOT invoice totals)
  const groupSubtotalPatterns = [
    /^\d{4}\s+[A-Z]+\s+[A-Z]+\s+SUBTOTAL\s*-?\s*[\d,\.]+$/i,  // 0001 JOHN DOE SUBTOTAL - 34.79
    /^[A-Z]+\s+[A-Z]+\s+SUBTOTAL\s*-?\s*[\d,\.]+$/i,  // JOHN DOE SUBTOTAL - 34.79
    /^\s*[A-Z\/\s]+\s+SUBTOTAL\s+[\d,\.]+$/i,  // MAIN/REFRIG SUBTOTAL 673.93
  ];

  // Must contain SUBTOTAL but NOT be the invoice-level subtotal
  if (!lineUpper.includes('SUBTOTAL')) return false;

  // Check for employee name pattern before SUBTOTAL
  for (const pattern of groupSubtotalPatterns) {
    if (pattern.test(line)) return true;
  }

  // Additional check: if SUBTOTAL is preceded by what looks like a name
  const subtotalIdx = lineUpper.indexOf('SUBTOTAL');
  if (subtotalIdx > 5) {
    const beforeSubtotal = line.slice(0, subtotalIdx).trim();
    // Looks like a name (2-4 words, alphabetic)
    const nameParts = beforeSubtotal.split(/\s+/).filter(p => /^[A-Z]+$/i.test(p));
    if (nameParts.length >= 2 && nameParts.length <= 4) {
      return true;
    }
  }

  return false;
}

/**
 * Detect if a line is a department subtotal
 */
function isDeptSubtotal(line) {
  const lineUpper = line.toUpperCase();

  // Department subtotal patterns
  const deptPatterns = [
    /^[A-Z\/\s]+\s+SUBTOTAL\s+[\d,\.]+$/i,  // MAIN/REFRIG SUBTOTAL 673.93
    /DEPT\s+\d*\s*SUBTOTAL/i,
    /LOC\s+\d+.*SUBTOTAL/i
  ];

  for (const pattern of deptPatterns) {
    if (pattern.test(line)) return true;
  }

  return false;
}

/**
 * Detect if a line is a program/fee line (these ARE line items for Cintas)
 */
function isProgramFeeLine(line) {
  const lineUpper = line.toUpperCase();

  const feePatterns = [
    /UNIFORM\s+ADVANTAGE/i,
    /EMBLEM\s+ADVANTAGE/i,
    /PREP\s+ADVANTAGE/i,
    /INVENTORY\s+MANAGEMENT/i,
    /SERVICE\s+CHARGE/i,
    /ENERGY\s+SURCHARGE/i,
    /FACILITY\s+SERV/i
  ];

  return feePatterns.some(p => p.test(lineUpper));
}

module.exports = {
  parseMoney,
  parseQty,
  nearlyEqual,
  normalizeInvoiceText,
  splitIntoPages,
  removeRepeatedHeadersFooters,
  scanFromBottom,
  extractTailNumbers,
  isTableHeader,
  isGroupSubtotal,
  isDeptSubtotal,
  isProgramFeeLine
};
