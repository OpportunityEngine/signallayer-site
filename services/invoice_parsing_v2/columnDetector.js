/**
 * Invoice Column Detector
 *
 * Detects column structure in invoice text extracted from PDFs.
 * PDFs often lose column boundaries, so this module uses heuristics
 * to identify where columns likely were based on:
 * - Consistent spacing patterns
 * - Header row detection
 * - Number/text clustering
 */

/**
 * Common invoice column headers and their aliases
 */
const COLUMN_PATTERNS = {
  quantity: {
    headers: ['QTY', 'QUANTITY', 'QTY ORDERED', 'QTY SHIPPED', 'ORDERED', 'SHIPPED'],
    position: 'start',
    dataType: 'integer'
  },
  sku: {
    headers: ['SKU', 'ITEM', 'ITEM #', 'ITEM NO', 'ITEM CODE', 'PRODUCT CODE', 'PART #', 'PART NO', 'CODE', 'PRODUCT #'],
    position: 'middle',
    dataType: 'alphanumeric'
  },
  description: {
    headers: ['DESCRIPTION', 'DESC', 'ITEM DESCRIPTION', 'PRODUCT', 'PRODUCT NAME', 'NAME', 'ITEM NAME'],
    position: 'middle',
    dataType: 'text'
  },
  pack: {
    headers: ['PACK', 'PACK SIZE', 'SIZE', 'UNIT SIZE', 'PACK/SIZE'],
    position: 'middle',
    dataType: 'text'
  },
  unitPrice: {
    headers: ['UNIT PRICE', 'PRICE', 'UNIT', 'PRICE/UNIT', 'UNIT COST', 'COST', 'RATE', 'EACH'],
    position: 'end',
    dataType: 'decimal'
  },
  total: {
    headers: ['TOTAL', 'AMOUNT', 'EXT', 'EXTENDED', 'EXT PRICE', 'EXTENDED PRICE', 'LINE TOTAL', 'EXT AMT', 'NET'],
    position: 'end',
    dataType: 'decimal'
  }
};

/**
 * Detect header row in invoice text
 * @param {Array<string>} lines - Array of text lines
 * @returns {Object|null} Header detection result
 */
function detectHeaderRow(lines) {
  for (let i = 0; i < Math.min(30, lines.length); i++) {
    const line = lines[i].toUpperCase();

    // Count how many column headers we find
    let foundColumns = [];

    for (const [colName, config] of Object.entries(COLUMN_PATTERNS)) {
      for (const header of config.headers) {
        const idx = line.indexOf(header);
        if (idx !== -1) {
          foundColumns.push({
            column: colName,
            header: header,
            position: idx,
            endPosition: idx + header.length
          });
          break;  // Only count each column once
        }
      }
    }

    // If we found 3+ columns, this is likely the header row
    if (foundColumns.length >= 3) {
      // Sort by position
      foundColumns.sort((a, b) => a.position - b.position);

      return {
        lineIndex: i,
        line: lines[i],
        columns: foundColumns,
        columnCount: foundColumns.length
      };
    }
  }

  return null;
}

/**
 * Estimate column boundaries based on spacing analysis
 * @param {Array<string>} lines - Array of text lines
 * @param {number} startLine - Line to start analysis from
 * @returns {Array} Estimated column boundaries
 */
function estimateColumnBoundaries(lines, startLine = 0) {
  const boundaries = [];
  const lineLength = Math.max(...lines.map(l => l.length));

  // Count spaces at each position across multiple lines
  const spaceCount = new Array(lineLength).fill(0);
  const analyzedLines = lines.slice(startLine, startLine + 20);

  for (const line of analyzedLines) {
    for (let i = 0; i < line.length; i++) {
      if (line[i] === ' ' || line[i] === '\t') {
        spaceCount[i]++;
      }
    }
  }

  // Find positions where most lines have spaces (potential column gaps)
  const threshold = analyzedLines.length * 0.6;
  let inGap = false;
  let gapStart = 0;

  for (let i = 0; i < lineLength; i++) {
    if (spaceCount[i] >= threshold && !inGap) {
      inGap = true;
      gapStart = i;
    } else if (spaceCount[i] < threshold && inGap) {
      inGap = false;
      // Mark the middle of the gap as a boundary
      boundaries.push(Math.floor((gapStart + i) / 2));
    }
  }

  return boundaries;
}

/**
 * Split a line into columns based on detected boundaries
 * @param {string} line - Text line
 * @param {Array<number>} boundaries - Column boundary positions
 * @returns {Array<string>} Column values
 */
function splitLineByBoundaries(line, boundaries) {
  if (!boundaries || boundaries.length === 0) {
    return [line.trim()];
  }

  const columns = [];
  let lastBoundary = 0;

  for (const boundary of boundaries) {
    columns.push(line.slice(lastBoundary, boundary).trim());
    lastBoundary = boundary;
  }

  // Add the last column
  columns.push(line.slice(lastBoundary).trim());

  return columns.filter(c => c.length > 0);
}

/**
 * Detect the likely structure of invoice lines
 * @param {string} text - Full invoice text
 * @returns {Object} Detection result with structure info
 */
function detectInvoiceStructure(text) {
  const lines = text.split('\n').map(l => l.trimEnd());

  const result = {
    headerRow: null,
    columnBoundaries: [],
    itemStartLine: 0,
    itemEndLine: lines.length,
    structure: 'unknown'
  };

  // Try to find header row
  result.headerRow = detectHeaderRow(lines);

  if (result.headerRow) {
    result.itemStartLine = result.headerRow.lineIndex + 1;

    // Estimate column boundaries from header
    result.columnBoundaries = result.headerRow.columns.map(c => c.position);

    // Determine structure type
    const colNames = result.headerRow.columns.map(c => c.column);
    if (colNames.includes('quantity') && colNames.includes('description') && colNames.includes('total')) {
      result.structure = 'standard';
    } else if (colNames.includes('sku') && colNames.includes('description')) {
      result.structure = 'sku-based';
    }
  }

  // Find where items likely end (look for totals section)
  for (let i = result.itemStartLine; i < lines.length; i++) {
    const line = lines[i].toUpperCase();
    if (/^(SUB)?TOTAL\s*[:\s$\d]/.test(line) ||
        /^INVOICE\s+TOTAL/.test(line) ||
        /^AMOUNT\s+DUE/.test(line) ||
        /^BALANCE\s+DUE/.test(line)) {
      result.itemEndLine = i;
      break;
    }
  }

  return result;
}

/**
 * Parse tabular data from invoice text using column detection
 * @param {string} text - Invoice text
 * @returns {Array} Parsed rows with column data
 */
function parseTabularData(text) {
  const structure = detectInvoiceStructure(text);
  const lines = text.split('\n');
  const rows = [];

  // If we have column boundaries, use them
  if (structure.columnBoundaries.length > 0) {
    for (let i = structure.itemStartLine; i < structure.itemEndLine; i++) {
      const line = lines[i];
      if (!line || line.trim().length < 5) continue;

      // Skip lines that look like subtotals
      if (/GROUP\s+TOTAL|SUBTOTAL|^\*+/i.test(line)) continue;

      const columns = splitLineByBoundaries(line, structure.columnBoundaries);

      if (columns.length >= 2) {
        rows.push({
          lineIndex: i,
          raw: line,
          columns: columns,
          columnCount: columns.length
        });
      }
    }
  } else {
    // Fallback: split by multiple spaces
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line || line.trim().length < 10) continue;

      // Split by 2+ spaces
      const columns = line.split(/\s{2,}/).map(c => c.trim()).filter(c => c);

      if (columns.length >= 2) {
        rows.push({
          lineIndex: i,
          raw: line,
          columns: columns,
          columnCount: columns.length
        });
      }
    }
  }

  return {
    structure,
    rows
  };
}

/**
 * Extract prices from the end of a line (right-anchored)
 * Prices typically appear as the last 1-3 numbers on a line
 * @param {string} line - Invoice line
 * @returns {Array} Extracted prices with positions
 */
function extractRightAnchoredPrices(line) {
  const prices = [];

  // Look for price patterns at the end of the line
  // Prices: $XX.XX, XX.XX, X,XXX.XX
  const pricePattern = /\$?([\d,]+\.\d{2})\s*$/;

  let remaining = line.trim();
  let offset = line.length - remaining.length;

  // Extract up to 3 prices from the right
  for (let i = 0; i < 3; i++) {
    const match = remaining.match(pricePattern);
    if (!match) break;

    const priceStr = match[1];
    const price = parseFloat(priceStr.replace(/,/g, ''));
    const startPos = remaining.lastIndexOf(match[0]);

    prices.unshift({
      value: price,
      cents: Math.round(price * 100),
      raw: match[0],
      position: offset + startPos
    });

    // Remove this price and continue looking
    remaining = remaining.slice(0, startPos).trim();
  }

  return prices;
}

/**
 * Extract quantity from the start of a line (left-anchored)
 * Quantities typically appear as small integers at the start
 * @param {string} line - Invoice line
 * @returns {Object|null} Extracted quantity
 */
function extractLeftAnchoredQuantity(line) {
  const trimmed = line.trim();

  // Pattern: starts with optional category code, then qty
  // Examples: "C 1 CS", "2 EA", "1S", "12 PK"
  const qtyPatterns = [
    /^([CFPD])?\s*(\d{1,3})\s*([A-Z]{1,4})?\s+/i,  // Category + Qty + Unit
    /^(\d{1,3})\s*([A-Z]{1,4})?\s+/i,               // Just Qty + optional Unit
    /^(\d{1,3})\s+/                                  // Just Qty
  ];

  for (const pattern of qtyPatterns) {
    const match = trimmed.match(pattern);
    if (match) {
      // Find the quantity group (could be group 1 or 2 depending on pattern)
      const qtyStr = match[2] || match[1];
      const qty = parseInt(qtyStr, 10);

      if (qty >= 1 && qty <= 999) {
        return {
          value: qty,
          raw: match[0],
          category: match[1] || null,
          unit: match[3] || match[2] || null,
          endPosition: match[0].length
        };
      }
    }
  }

  return null;
}

module.exports = {
  COLUMN_PATTERNS,
  detectHeaderRow,
  estimateColumnBoundaries,
  splitLineByBoundaries,
  detectInvoiceStructure,
  parseTabularData,
  extractRightAnchoredPrices,
  extractLeftAnchoredQuantity
};
