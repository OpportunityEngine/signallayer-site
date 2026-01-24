/**
 * PDF Layout Extractor
 *
 * Layout-preserving PDF text extraction with x/y coordinates.
 * Falls back to this when standard text extraction produces poor quality.
 *
 * Features:
 * - Extracts text with position coordinates (x, y, width, height)
 * - Groups text by visual rows based on y-coordinate
 * - Preserves column structure for tabular data
 * - Handles rotated text and multi-column layouts
 *
 * Requires: pdfjs-dist (optional, gracefully degrades if not available)
 */

const fs = require('fs');
const path = require('path');

// Try to load pdfjs-dist - this is optional
let pdfjsLib = null;
try {
  pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
  // Disable worker for Node.js
  pdfjsLib.GlobalWorkerOptions.workerSrc = '';
} catch (e) {
  console.log('[PDF LAYOUT] pdfjs-dist not available, layout extraction disabled');
}

/**
 * Check if layout extraction is available
 */
function isLayoutExtractionAvailable() {
  return pdfjsLib !== null;
}

/**
 * Extract text with position information from PDF
 * @param {Buffer|string} pdfSource - PDF buffer or file path
 * @returns {Promise<Object>} Extraction result with positioned text
 */
async function extractWithLayout(pdfSource) {
  if (!pdfjsLib) {
    return {
      success: false,
      error: 'pdfjs-dist not available',
      fallbackText: null
    };
  }

  try {
    // Load PDF
    let data;
    if (Buffer.isBuffer(pdfSource)) {
      data = new Uint8Array(pdfSource);
    } else if (typeof pdfSource === 'string' && fs.existsSync(pdfSource)) {
      data = new Uint8Array(fs.readFileSync(pdfSource));
    } else {
      throw new Error('Invalid PDF source');
    }

    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const numPages = pdf.numPages;

    const pages = [];
    let allItems = [];

    // Process each page
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.0 });
      const textContent = await page.getTextContent();

      const pageItems = textContent.items.map(item => ({
        text: item.str,
        x: item.transform[4],
        y: viewport.height - item.transform[5], // Flip y-coordinate
        width: item.width,
        height: item.height || 12,
        fontName: item.fontName,
        pageNum
      }));

      pages.push({
        pageNum,
        width: viewport.width,
        height: viewport.height,
        items: pageItems
      });

      allItems = allItems.concat(pageItems);
    }

    // Group items into visual rows
    const rows = groupIntoRows(allItems);

    // Build structured text
    const structuredText = buildStructuredText(rows);

    return {
      success: true,
      pages,
      rows,
      structuredText,
      itemCount: allItems.length,
      pageCount: numPages
    };

  } catch (error) {
    return {
      success: false,
      error: error.message,
      fallbackText: null
    };
  }
}

/**
 * Group text items into visual rows based on y-coordinate
 * @param {Array} items - Text items with coordinates
 * @returns {Array} Rows of text items
 */
function groupIntoRows(items) {
  if (items.length === 0) return [];

  // Sort by y-coordinate (top to bottom), then x (left to right)
  const sorted = [...items].sort((a, b) => {
    const yDiff = a.y - b.y;
    if (Math.abs(yDiff) < 5) {
      // Same row, sort by x
      return a.x - b.x;
    }
    return yDiff;
  });

  const rows = [];
  let currentRow = [];
  let currentY = sorted[0]?.y || 0;

  for (const item of sorted) {
    // If y-coordinate is significantly different, start new row
    if (Math.abs(item.y - currentY) > 8) {
      if (currentRow.length > 0) {
        rows.push({
          y: currentY,
          items: currentRow,
          text: currentRow.map(i => i.text).join(' ').trim()
        });
      }
      currentRow = [];
      currentY = item.y;
    }
    currentRow.push(item);
  }

  // Don't forget last row
  if (currentRow.length > 0) {
    rows.push({
      y: currentY,
      items: currentRow,
      text: currentRow.map(i => i.text).join(' ').trim()
    });
  }

  return rows;
}

/**
 * Build structured text preserving column alignment
 * @param {Array} rows - Grouped rows
 * @returns {Object} Structured text with column info
 */
function buildStructuredText(rows) {
  if (rows.length === 0) {
    return { text: '', columns: [] };
  }

  // Detect column positions by finding common x-coordinates
  const allXPositions = [];
  for (const row of rows) {
    for (const item of row.items) {
      allXPositions.push(Math.round(item.x / 10) * 10); // Round to 10px buckets
    }
  }

  // Find most common x positions (column starts)
  const xCounts = {};
  for (const x of allXPositions) {
    xCounts[x] = (xCounts[x] || 0) + 1;
  }

  const columns = Object.entries(xCounts)
    .filter(([_, count]) => count >= rows.length * 0.3) // At least 30% of rows
    .map(([x]) => parseInt(x))
    .sort((a, b) => a - b);

  // Build text with preserved spacing
  const lines = rows.map(row => {
    // If we have columns, try to align text
    if (columns.length >= 2) {
      return buildColumnAlignedLine(row.items, columns);
    }
    return row.text;
  });

  return {
    text: lines.join('\n'),
    columns,
    lineCount: lines.length
  };
}

/**
 * Build a line with column alignment
 * @param {Array} items - Row items
 * @param {Array} columns - Column x-positions
 * @returns {string} Aligned line
 */
function buildColumnAlignedLine(items, columns) {
  // Assign items to columns
  const columnTexts = new Array(columns.length).fill('');

  for (const item of items) {
    // Find which column this item belongs to
    let colIdx = 0;
    for (let i = 0; i < columns.length; i++) {
      if (item.x >= columns[i] - 20) {
        colIdx = i;
      }
    }
    columnTexts[colIdx] += (columnTexts[colIdx] ? ' ' : '') + item.text;
  }

  // Join with tabs to preserve column structure
  return columnTexts.join('\t').trim();
}

/**
 * Extract tables from PDF using layout information
 * @param {Object} layoutResult - Result from extractWithLayout
 * @returns {Array} Detected tables
 */
function extractTables(layoutResult) {
  if (!layoutResult.success) return [];

  const rows = layoutResult.rows || [];
  const tables = [];
  let currentTable = null;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const itemCount = row.items.length;

    // Heuristic: table rows typically have 3+ items with consistent spacing
    const isTableLike = itemCount >= 3 && hasConsistentSpacing(row.items);

    if (isTableLike) {
      if (!currentTable) {
        currentTable = {
          startRow: i,
          rows: [],
          columnCount: itemCount
        };
      }
      currentTable.rows.push(row);
    } else {
      if (currentTable && currentTable.rows.length >= 3) {
        currentTable.endRow = i - 1;
        tables.push(currentTable);
      }
      currentTable = null;
    }
  }

  // Don't forget last table
  if (currentTable && currentTable.rows.length >= 3) {
    currentTable.endRow = rows.length - 1;
    tables.push(currentTable);
  }

  return tables;
}

/**
 * Check if items have consistent spacing (suggests table structure)
 * @param {Array} items - Row items
 * @returns {boolean}
 */
function hasConsistentSpacing(items) {
  if (items.length < 3) return false;

  const gaps = [];
  for (let i = 1; i < items.length; i++) {
    gaps.push(items[i].x - (items[i-1].x + items[i-1].width));
  }

  // Check if gaps are relatively consistent
  const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const variance = gaps.reduce((sum, g) => sum + Math.pow(g - avgGap, 2), 0) / gaps.length;
  const stdDev = Math.sqrt(variance);

  // Low standard deviation suggests consistent spacing
  return stdDev < avgGap * 0.5;
}

/**
 * Find text at specific coordinates
 * @param {Object} layoutResult - Layout extraction result
 * @param {Object} region - { x, y, width, height }
 * @returns {Array} Text items in region
 */
function findTextInRegion(layoutResult, region) {
  if (!layoutResult.success) return [];

  const items = [];
  for (const page of layoutResult.pages) {
    for (const item of page.items) {
      const inX = item.x >= region.x && item.x <= region.x + region.width;
      const inY = item.y >= region.y && item.y <= region.y + region.height;

      if (inX && inY) {
        items.push(item);
      }
    }
  }

  return items;
}

/**
 * Get text quality indicators from layout
 * @param {Object} layoutResult - Layout extraction result
 * @returns {Object} Quality indicators
 */
function getLayoutQuality(layoutResult) {
  if (!layoutResult.success) {
    return { quality: 'unknown', score: 0 };
  }

  const rows = layoutResult.rows || [];
  const columns = layoutResult.structuredText?.columns || [];

  // Quality indicators
  const avgItemsPerRow = rows.reduce((sum, r) => sum + r.items.length, 0) / rows.length;
  const hasGoodColumnStructure = columns.length >= 3;
  const rowCount = rows.length;

  let score = 50;

  if (avgItemsPerRow >= 3) score += 20;
  if (hasGoodColumnStructure) score += 20;
  if (rowCount >= 10) score += 10;

  return {
    quality: score >= 80 ? 'good' : score >= 50 ? 'fair' : 'poor',
    score,
    indicators: {
      avgItemsPerRow,
      columnCount: columns.length,
      rowCount,
      hasGoodColumnStructure
    }
  };
}

/**
 * Convert layout result to plain text for parsing
 * Uses structured text when quality is good
 * @param {Object} layoutResult - Layout extraction result
 * @returns {string} Plain text
 */
function toPlainText(layoutResult) {
  if (!layoutResult.success) {
    return layoutResult.fallbackText || '';
  }

  return layoutResult.structuredText?.text || '';
}

module.exports = {
  isLayoutExtractionAvailable,
  extractWithLayout,
  groupIntoRows,
  buildStructuredText,
  extractTables,
  findTextInRegion,
  getLayoutQuality,
  toPlainText
};
