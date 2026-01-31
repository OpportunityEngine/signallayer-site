/**
 * Invoice Parsing V2 - Utility Functions
 * Robust helpers for money parsing, validation, and text normalization
 */

/**
 * Parse money string to dollars (float with 3 decimal precision)
 * This preserves precision for calculations before final rounding
 * Handles: $1,234.567, 1234.56, (123.45) for negatives, 123.45- for trailing minus, etc.
 * @param {string|number} str - Money string or number
 * @param {number} decimals - Decimal precision to preserve (default 3)
 * @returns {number} - Dollar amount as float with specified precision
 */
function parseMoneyToDollars(str, decimals = 3) {
  if (str === null || str === undefined) return 0;
  if (typeof str === 'number') {
    // Round to specified precision
    const multiplier = Math.pow(10, decimals);
    return Math.round(str * multiplier) / multiplier;
  }

  let s = String(str).trim();
  if (!s) return 0;

  // CRITICAL: Normalize spaces in money values BEFORE parsing
  // PDF extraction often produces "4207 .02" or "1 748.85" with embedded spaces
  s = s
    .replace(/\r/g, '')
    .replace(/(\d)\s+(?=\d)/g, '$1')      // "1 748" -> "1748"
    .replace(/(\d)\s+\.(?=\d)/g, '$1.')   // "4207 .02" -> "4207.02"
    .replace(/\.\s+(?=\d)/g, '.')         // "1748. 85" -> "1748.85"
    .replace(/,\s+(?=\d)/g, ',');         // "1,748 .85" -> "1,748.85"

  // Check for negative indicators:
  // - Parentheses: (123.45)
  // - Leading minus: -123.45
  // - Trailing minus: 123.45- (common in ERP/accounting systems like SAP, Oracle)
  // - Credit notation: 123.45CR or 123.45 CR
  const isNegative = s.startsWith('(') && s.endsWith(')') ||
                     s.startsWith('-') ||
                     s.endsWith('-') ||
                     /CR$/i.test(s);

  // Remove currency symbols, commas, parentheses, spaces, minus signs, CR notation
  const cleaned = s.replace(/[$€£¥,\s()]/g, '').replace(/^-|-$/g, '').replace(/CR$/i, '');

  if (!cleaned) return 0;

  const num = parseFloat(cleaned);
  if (!Number.isFinite(num)) return 0;

  // Round to specified decimal precision
  const multiplier = Math.pow(10, decimals);
  const rounded = Math.round(num * multiplier) / multiplier;

  return isNegative ? -rounded : rounded;
}

/**
 * Parse money string to cents (integer)
 * Handles: $1,234.56, 1234.56, (123.45) for negatives, 123.45- for trailing minus, etc.
 * NOTE: For better precision in calculations, use parseMoneyToDollars first,
 * then convert to cents only at the final step
 */
function parseMoney(str) {
  if (str === null || str === undefined) return 0;
  if (typeof str === 'number') return Math.round(str * 100);

  let s = String(str).trim();
  if (!s) return 0;

  // CRITICAL: Normalize spaces in money values BEFORE parsing
  // PDF extraction often produces "4207 .02" or "1 748.85" with embedded spaces
  s = s
    .replace(/\r/g, '')
    .replace(/(\d)\s+(?=\d)/g, '$1')      // "1 748" -> "1748"
    .replace(/(\d)\s+\.(?=\d)/g, '$1.')   // "4207 .02" -> "4207.02"
    .replace(/\.\s+(?=\d)/g, '.')         // "1748. 85" -> "1748.85"
    .replace(/,\s+(?=\d)/g, ',');         // "1,748 .85" -> "1,748.85"

  // Check for negative indicators:
  // - Parentheses: (123.45)
  // - Leading minus: -123.45
  // - Trailing minus: 123.45- (common in ERP/accounting systems like SAP, Oracle)
  // - Credit notation: 123.45CR or 123.45 CR
  const isNegative = s.startsWith('(') && s.endsWith(')') ||
                     s.startsWith('-') ||
                     s.endsWith('-') ||
                     /CR$/i.test(s);

  // Remove currency symbols, commas, parentheses, spaces, minus signs, CR notation
  const cleaned = s.replace(/[$€£¥,\s()]/g, '').replace(/^-|-$/g, '').replace(/CR$/i, '');

  if (!cleaned) return 0;

  const num = parseFloat(cleaned);
  if (!Number.isFinite(num)) return 0;

  const cents = Math.round(num * 100);
  return isNegative ? -cents : cents;
}

/**
 * Calculate line total with 3 decimal precision, then round to cents
 * This prevents cumulative rounding errors:
 * - qty=10, unitPrice=$1.587 => $15.87 (not $15.90 from 10 * $1.59)
 * @param {number} qty - Quantity
 * @param {number} unitPriceDollars - Unit price as float (with 3 decimal precision)
 * @returns {number} - Line total in cents
 */
function calculateLineTotalCents(qty, unitPriceDollars) {
  // Calculate with full precision, then round to cents at the end
  const totalDollars = qty * unitPriceDollars;
  return Math.round(totalDollars * 100);
}

/**
 * Calculate line total with precision, returning dollars
 * @param {number} qty - Quantity
 * @param {number} unitPriceDollars - Unit price as float
 * @param {number} decimals - Decimal precision (default 2 for display)
 * @returns {number} - Line total in dollars
 */
function calculateLineTotalDollars(qty, unitPriceDollars, decimals = 2) {
  const totalDollars = qty * unitPriceDollars;
  const multiplier = Math.pow(10, decimals);
  return Math.round(totalDollars * multiplier) / multiplier;
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
 * Fix space-separated characters from OCR (S Y S C O → SYSCO)
 * Common OCR artifact where letters have extra spaces between them
 */
function fixSpaceSeparatedCharacters(text) {
  if (!text) return text;

  // Known vendor names that OCR often splits
  const knownPatterns = [
    { pattern: /S\s*Y\s*S\s*C\s*O/gi, replacement: 'SYSCO' },
    { pattern: /C\s*I\s*N\s*T\s*A\s*S/gi, replacement: 'CINTAS' },
    { pattern: /U\s*S\s+F\s*O\s*O\s*D\s*S/gi, replacement: 'US FOODS' },
    { pattern: /A\s*R\s*A\s*M\s*A\s*R\s*K/gi, replacement: 'ARAMARK' },
    { pattern: /G\s*R\s*A\s*I\s*N\s*G\s*E\s*R/gi, replacement: 'GRAINGER' },
    { pattern: /I\s*N\s*V\s*O\s*I\s*C\s*E/gi, replacement: 'INVOICE' },
    { pattern: /T\s*O\s*T\s*A\s*L/gi, replacement: 'TOTAL' },
    { pattern: /S\s*U\s*B\s*T\s*O\s*T\s*A\s*L/gi, replacement: 'SUBTOTAL' },
    { pattern: /A\s*M\s*O\s*U\s*N\s*T/gi, replacement: 'AMOUNT' },
    { pattern: /Q\s*U\s*A\s*N\s*T\s*I\s*T\s*Y/gi, replacement: 'QUANTITY' },
    { pattern: /D\s*E\s*S\s*C\s*R\s*I\s*P\s*T\s*I\s*O\s*N/gi, replacement: 'DESCRIPTION' },
    { pattern: /B\s*A\s*L\s*A\s*N\s*C\s*E/gi, replacement: 'BALANCE' },
    { pattern: /P\s*A\s*Y\s*M\s*E\s*N\s*T/gi, replacement: 'PAYMENT' },
  ];

  let result = text;
  for (const { pattern, replacement } of knownPatterns) {
    result = result.replace(pattern, replacement);
  }

  // Generic fix: Detect lines with mostly single-spaced letters (A B C D E F)
  // and collapse them - but only for ALL CAPS sequences
  result = result.replace(/\b([A-Z])\s([A-Z])\s([A-Z])\s([A-Z])(\s[A-Z])*\b/g, (match) => {
    // Only collapse if it looks like spaced-out text (all single letters)
    const letters = match.split(/\s+/);
    if (letters.every(l => l.length === 1)) {
      return letters.join('');
    }
    return match;
  });

  return result;
}

/**
 * Fix embedded spaces in numbers from OCR/PDF extraction
 * "4207 .02" → "4207.02", "1 748.85" → "1748.85"
 */
function fixEmbeddedSpacesInNumbers(text) {
  if (!text) return text;

  return text
    // Fix spaces before decimal: "4207 .02" → "4207.02"
    .replace(/(\d)\s+\.(\d)/g, '$1.$2')
    // Fix spaces after decimal: "1748. 85" → "1748.85"
    .replace(/(\d)\.\s+(\d)/g, '$1.$2')
    // Fix spaces in middle of number: "1 748" → "1748" (but not "1 748.85" which needs comma)
    .replace(/(\d)\s+(\d{3})(?=\s|$|[^\d])/g, '$1$2')
    // Fix spaces after currency symbol: "$ 123.45" → "$123.45"
    .replace(/\$\s+(\d)/g, '$$$1')
    // Fix spaces in comma-separated numbers: "1, 234" → "1,234"
    .replace(/(\d),\s+(\d)/g, '$1,$2')
    // Fix negative numbers: "- 45.00" → "-45.00"
    .replace(/-\s+(\d)/g, '-$1');
}

/**
 * Fix common OCR character substitutions
 */
function fixOCRCharacterSubstitutions(text) {
  if (!text) return text;

  let result = text;

  // Fix common word-level OCR errors (context-aware)
  const wordFixes = [
    // Invoice keywords
    [/\bFOTAL\b/gi, 'TOTAL'],
    [/\bTQTAL\b/gi, 'TOTAL'],
    [/\bT0TAL\b/gi, 'TOTAL'],
    [/\bTOTAI\b/gi, 'TOTAL'],
    [/\b1NVOICE\b/gi, 'INVOICE'],
    [/\blNVOICE\b/gi, 'INVOICE'],
    [/\bINV0ICE\b/gi, 'INVOICE'],
    [/\bINVOlCE\b/gi, 'INVOICE'],
    [/\bSUBT0TAL\b/gi, 'SUBTOTAL'],
    [/\bSUBTQTAL\b/gi, 'SUBTOTAL'],
    [/\bAMOUNF\b/gi, 'AMOUNT'],
    [/\bAM0UNT\b/gi, 'AMOUNT'],
    [/\bQUANTlTY\b/gi, 'QUANTITY'],
    [/\bQUANT1TY\b/gi, 'QUANTITY'],
    [/\bOUANTITY\b/gi, 'QUANTITY'],
    [/\bDESCRlPTION\b/gi, 'DESCRIPTION'],
    [/\bDESCR1PTION\b/gi, 'DESCRIPTION'],
    [/\bPRlCE\b/gi, 'PRICE'],
    [/\bPR1CE\b/gi, 'PRICE'],
    [/\bBALANCE\s*DUE\b/gi, 'BALANCE DUE'],
    [/\bAMOUNT\s*DUE\b/gi, 'AMOUNT DUE'],
    // Common OCR number errors in dollar amounts (only between digits)
    [/(\d)O(\d)/g, '$10$2'],  // O → 0 between digits
    [/(\d)l(\d)/g, '$11$2'],  // l → 1 between digits
    [/(\d)I(\d)/g, '$11$2'],  // I → 1 between digits
    [/(\d)Z(\d)/g, '$12$2'],  // Z → 2 between digits
    [/(\d)S(\d)/g, '$15$2'],  // S → 5 between digits
    [/(\d)B(\d)/g, '$18$2'],  // B → 8 between digits
    [/(\d)G(\d)/g, '$16$2'],  // G → 6 between digits
  ];

  for (const [pattern, replacement] of wordFixes) {
    result = result.replace(pattern, replacement);
  }

  return result;
}

/**
 * Normalize invoice text for consistent parsing
 * - Unify whitespace but preserve line breaks
 * - Normalize special characters
 * - Handle various encoding issues
 * - Fix OCR artifacts (spaces in numbers, character substitutions)
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

  // === NEW: Advanced OCR Fixes ===
  // Fix space-separated characters (S Y S C O → SYSCO)
  normalized = fixSpaceSeparatedCharacters(normalized);

  // Fix embedded spaces in numbers (4207 .02 → 4207.02)
  normalized = fixEmbeddedSpacesInNumbers(normalized);

  // Fix common OCR character substitutions (FOTAL → TOTAL)
  normalized = fixOCRCharacterSubstitutions(normalized);
  // === END OCR Fixes ===

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
 * ENHANCED: Adaptive detection with tiered matching
 */
function isTableHeader(line) {
  const lineUpper = (line || '').toUpperCase().trim();
  if (!lineUpper || lineUpper.length < 5) return false;

  // Primary header keywords (high-confidence)
  const primaryKeywords = [
    'DESCRIPTION', 'QTY', 'QUANTITY', 'PRICE', 'AMOUNT', 'TOTAL',
    'ITEM', 'SKU', 'MATERIAL', 'PRODUCT', 'UNIT PRICE', 'EXT PRICE',
    'LINE TOTAL', 'EXTENDED', 'UNIT COST', 'EA PRICE'
  ];

  // Secondary header keywords (medium-confidence)
  const secondaryKeywords = [
    'UNIT', 'FREQ', 'EXCH', 'TAX', 'PACK', 'SIZE', 'BRAND',
    'CODE', 'NO', 'NUM', 'UPC', 'CASE', 'WEIGHT'
  ];

  // Count matches
  const primaryMatches = primaryKeywords.filter(kw => lineUpper.includes(kw)).length;
  const secondaryMatches = secondaryKeywords.filter(kw => lineUpper.includes(kw)).length;

  // STRATEGY 1: Traditional - 3+ keywords total
  if (primaryMatches + secondaryMatches >= 3) return true;

  // STRATEGY 2: 2 primary keywords is enough (for minimalist headers)
  if (primaryMatches >= 2) return true;

  // STRATEGY 3: Detect column separator patterns (no keywords, but structure)
  // Headers often have multiple tabs/spaces as column separators
  const columnPattern = /\S+\s{2,}\S+\s{2,}\S+/;  // At least 3 columns with 2+ space gaps
  if (columnPattern.test(line) && !lineUpper.match(/\d{3,}/)) {
    // Has column structure and no long numbers (not a data row)
    const words = lineUpper.split(/\s+/).filter(w => w.length > 1);
    const allCaps = words.every(w => w === w.toUpperCase() && /^[A-Z]+$/.test(w));
    if (allCaps && words.length >= 3) return true;
  }

  // STRATEGY 4: Pipe/bar separator (ITEM | PRICE | QTY format)
  if (line.includes('|') || line.includes('\t')) {
    const parts = line.split(/[|\t]+/).filter(p => p.trim());
    if (parts.length >= 3) {
      const headerParts = parts.filter(p =>
        primaryKeywords.some(kw => p.toUpperCase().includes(kw)) ||
        secondaryKeywords.some(kw => p.toUpperCase().includes(kw))
      );
      if (headerParts.length >= 2) return true;
    }
  }

  return false;
}

/**
 * Detect columnar table structure even without explicit headers
 * Returns the line index where line items likely begin
 */
function detectTableStartAdaptive(lines) {
  // First try explicit header detection
  for (let i = 0; i < Math.min(50, lines.length); i++) {
    if (isTableHeader(lines[i])) {
      return i + 1; // Data starts after header
    }
  }

  // No explicit header found - look for structural patterns
  // Find first line that looks like a data row (has description + numbers)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.length < 15) continue;

    // Skip obvious non-data lines
    if (/^(PAGE|INVOICE|BILL TO|SHIP TO|DATE|ORDER|PO)/i.test(line)) continue;

    // Check for line item pattern: text followed by numbers
    // Must have at least one word (3+ letters) and one decimal number
    const hasWords = /[A-Za-z]{3,}/.test(line);
    const hasPrice = /\d+\.\d{2}/.test(line);

    if (hasWords && hasPrice) {
      // Found potential first data row
      return i;
    }
  }

  return -1;
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
    /GROUP\s+TOTAL\**\s*[\d,\.]+/i,  // GROUP TOTAL**** 64.27 (Sysco)
    /CATEGORY\s+TOTAL/i,  // Category totals
    /SECTION\s+TOTAL/i,  // Section totals
  ];

  // Check for GROUP TOTAL (Sysco uses this for category subtotals)
  if (lineUpper.includes('GROUP TOTAL')) return true;

  // Must contain SUBTOTAL but NOT be the invoice-level subtotal
  if (!lineUpper.includes('SUBTOTAL') && !lineUpper.includes('GROUP TOTAL')) {
    // Check other patterns
    for (const pattern of groupSubtotalPatterns) {
      if (pattern.test(line)) return true;
    }
    return false;
  }

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
  parseMoneyToDollars,
  calculateLineTotalCents,
  calculateLineTotalDollars,
  parseQty,
  nearlyEqual,
  normalizeInvoiceText,
  fixSpaceSeparatedCharacters,
  fixEmbeddedSpacesInNumbers,
  fixOCRCharacterSubstitutions,
  splitIntoPages,
  removeRepeatedHeadersFooters,
  scanFromBottom,
  extractTailNumbers,
  isTableHeader,
  detectTableStartAdaptive,
  isGroupSubtotal,
  isDeptSubtotal,
  isProgramFeeLine
};
