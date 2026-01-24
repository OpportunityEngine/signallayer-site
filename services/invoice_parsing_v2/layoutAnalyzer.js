/**
 * Invoice Layout Analyzer
 *
 * Analyzes the visual structure of invoice text to:
 * - Detect where line items start and end
 * - Identify column alignment patterns
 * - Find totals section
 * - Classify regions (header, items, totals, footer)
 *
 * Works with plain text extracted from PDFs by analyzing:
 * - Line lengths and patterns
 * - Number distributions
 * - Keyword locations
 */

const { parseMoney } = require('./utils');

/**
 * Keywords indicating different invoice regions
 */
const REGION_KEYWORDS = {
  header: [
    /^INVOICE\s*#?/i, /^DATE:/i, /^BILL\s+TO/i, /^SHIP\s+TO/i,
    /^SOLD\s+TO/i, /^CUSTOMER/i, /^ACCOUNT/i, /^P\.?O\.?\s*(NUMBER|#)/i
  ],
  itemHeader: [
    /QTY.*DESCRIPTION|DESCRIPTION.*QTY/i, /ITEM.*PRICE|PRICE.*ITEM/i,
    /SKU.*DESCRIPTION|DESCRIPTION.*SKU/i, /QUANTITY.*AMOUNT/i,
    /UNIT\s+PRICE|EXTENDED\s+PRICE/i, /^ITEM\s+#?\s+/i
  ],
  totals: [
    /^SUBTOTAL\s*:?/i, /^TOTAL\s*:?/i, /^TAX\s*:?/i, /^AMOUNT\s+DUE/i,
    /^BALANCE\s+DUE/i, /INVOICE\s+TOTAL/i, /^GRAND\s+TOTAL/i
  ],
  footer: [
    /THANK\s+YOU/i, /REMIT\s+TO/i, /PAYMENT\s+DUE/i, /TERMS\s+AND\s+CONDITIONS/i,
    /^PLEASE\s+PAY/i, /^DETACH\s+AND/i
  ]
};

/**
 * Analyze a line to determine what region it belongs to
 */
function classifyLine(line, context = {}) {
  const trimmed = line.trim();
  if (!trimmed) return { type: 'empty', confidence: 100 };

  // Check for region keywords
  for (const [region, patterns] of Object.entries(REGION_KEYWORDS)) {
    for (const pattern of patterns) {
      if (pattern.test(trimmed)) {
        return { type: region, confidence: 90, pattern: pattern.source };
      }
    }
  }

  // Analyze line content
  const hasPrice = /\$?[\d,]+\.\d{2}/.test(trimmed);
  const priceCount = (trimmed.match(/\$?[\d,]+\.\d{2}/g) || []).length;
  const hasQty = /^\d{1,3}\s+/.test(trimmed) || /\s+\d{1,3}\s+/.test(trimmed);
  const wordCount = trimmed.split(/\s+/).length;
  const letterRatio = (trimmed.match(/[a-zA-Z]/g) || []).length / trimmed.length;

  // Line item heuristics
  if (hasPrice && priceCount >= 1 && priceCount <= 3 && wordCount >= 3 && letterRatio > 0.3) {
    return { type: 'item', confidence: 70, reason: 'has price and text' };
  }

  // Separator line
  if (/^[-=_.*]{10,}$/.test(trimmed)) {
    return { type: 'separator', confidence: 95 };
  }

  // Page number
  if (/^(PAGE|PG\.?)\s*\d+/i.test(trimmed) || /^-+\s*\d+\s*-+$/.test(trimmed)) {
    return { type: 'page', confidence: 90 };
  }

  // Default to unknown
  return { type: 'unknown', confidence: 30 };
}

/**
 * Detect the overall layout structure of the invoice
 */
function analyzeLayout(text) {
  const lines = text.split('\n');
  const analysis = {
    lineCount: lines.length,
    regions: [],
    itemSection: { startLine: null, endLine: null },
    totalsSection: { startLine: null, endLine: null },
    headerSection: { startLine: 0, endLine: null },
    pricePattern: null,
    columnPattern: null
  };

  let currentRegion = 'header';
  let regionStart = 0;
  let lastItemLine = -1;
  let firstTotalLine = -1;

  // First pass: classify each line
  const lineClassifications = lines.map((line, idx) => ({
    index: idx,
    line,
    ...classifyLine(line)
  }));

  // Second pass: detect regions and transitions
  for (let i = 0; i < lineClassifications.length; i++) {
    const current = lineClassifications[i];

    // Detect item section start
    if (current.type === 'itemHeader' && analysis.itemSection.startLine === null) {
      analysis.headerSection.endLine = i;
      analysis.itemSection.startLine = i + 1;
    }

    // Track item lines
    if (current.type === 'item') {
      if (analysis.itemSection.startLine === null) {
        analysis.itemSection.startLine = i;
      }
      lastItemLine = i;
    }

    // Detect totals section
    if (current.type === 'totals' && firstTotalLine === -1) {
      firstTotalLine = i;
      if (lastItemLine > 0) {
        analysis.itemSection.endLine = lastItemLine + 1;
      }
    }

    // Detect footer
    if (current.type === 'footer') {
      analysis.totalsSection.endLine = i;
    }
  }

  // Fill in missing bounds
  if (analysis.itemSection.startLine !== null && analysis.itemSection.endLine === null) {
    analysis.itemSection.endLine = firstTotalLine > 0 ? firstTotalLine : lines.length;
  }

  if (firstTotalLine > 0) {
    analysis.totalsSection.startLine = firstTotalLine;
    if (!analysis.totalsSection.endLine) {
      analysis.totalsSection.endLine = lines.length;
    }
  }

  // Analyze price pattern
  analysis.pricePattern = detectPricePattern(lines.slice(
    analysis.itemSection.startLine || 0,
    analysis.itemSection.endLine || lines.length
  ));

  // Analyze column pattern
  analysis.columnPattern = detectColumnPattern(lines.slice(
    analysis.itemSection.startLine || 0,
    analysis.itemSection.endLine || lines.length
  ));

  analysis.lineClassifications = lineClassifications;

  return analysis;
}

/**
 * Detect the pattern of prices in item lines
 */
function detectPricePattern(lines) {
  const patterns = {
    singlePrice: 0,      // One price at end
    dualPrice: 0,        // Unit price + extended
    triplePrice: 0,      // Multiple prices
    noPriceLines: 0
  };

  for (const line of lines) {
    const prices = line.match(/\$?[\d,]+\.\d{2}/g) || [];
    if (prices.length === 0) patterns.noPriceLines++;
    else if (prices.length === 1) patterns.singlePrice++;
    else if (prices.length === 2) patterns.dualPrice++;
    else patterns.triplePrice++;
  }

  // Determine dominant pattern
  const total = patterns.singlePrice + patterns.dualPrice + patterns.triplePrice;
  if (total === 0) return { type: 'none', confidence: 0 };

  if (patterns.dualPrice / total > 0.5) {
    return { type: 'dual', confidence: patterns.dualPrice / total * 100 };
  }
  if (patterns.singlePrice / total > 0.5) {
    return { type: 'single', confidence: patterns.singlePrice / total * 100 };
  }

  return { type: 'mixed', confidence: 50 };
}

/**
 * Detect column alignment pattern
 */
function detectColumnPattern(lines) {
  if (lines.length < 3) return { type: 'unknown' };

  // Check for tab delimiters
  const tabLines = lines.filter(l => l.includes('\t')).length;
  if (tabLines / lines.length > 0.5) {
    return { type: 'tab-delimited', confidence: 90 };
  }

  // Check for pipe delimiters
  const pipeLines = lines.filter(l => l.includes('|')).length;
  if (pipeLines / lines.length > 0.5) {
    return { type: 'pipe-delimited', confidence: 90 };
  }

  // Analyze space-based columns by finding consistent gaps
  const gapPositions = [];

  for (const line of lines) {
    // Find positions of multi-space gaps
    let inGap = false;
    let gapStart = 0;

    for (let i = 0; i < line.length; i++) {
      if (line[i] === ' ') {
        if (!inGap) {
          inGap = true;
          gapStart = i;
        }
      } else {
        if (inGap && i - gapStart >= 2) {
          gapPositions.push(Math.floor((gapStart + i) / 2));
        }
        inGap = false;
      }
    }
  }

  // Find most common gap positions
  const positionCounts = {};
  for (const pos of gapPositions) {
    // Group nearby positions (within 3 chars)
    const bucket = Math.round(pos / 3) * 3;
    positionCounts[bucket] = (positionCounts[bucket] || 0) + 1;
  }

  const commonPositions = Object.entries(positionCounts)
    .filter(([_, count]) => count >= lines.length * 0.5)
    .map(([pos]) => parseInt(pos))
    .sort((a, b) => a - b);

  if (commonPositions.length >= 2) {
    return {
      type: 'space-aligned',
      columns: commonPositions.length + 1,
      positions: commonPositions,
      confidence: 70
    };
  }

  return { type: 'free-form', confidence: 40 };
}

/**
 * Extract lines from a specific region
 */
function extractRegion(text, layout, region) {
  const lines = text.split('\n');

  switch (region) {
    case 'header':
      return lines.slice(
        layout.headerSection.startLine || 0,
        layout.headerSection.endLine || layout.itemSection?.startLine || 20
      );

    case 'items':
      if (!layout.itemSection.startLine) return [];
      return lines.slice(
        layout.itemSection.startLine,
        layout.itemSection.endLine
      );

    case 'totals':
      if (!layout.totalsSection.startLine) return [];
      return lines.slice(
        layout.totalsSection.startLine,
        layout.totalsSection.endLine
      );

    default:
      return [];
  }
}

/**
 * Generate parsing hints based on layout analysis
 */
function generateParsingHints(layout) {
  const hints = {
    useTabDelimiter: false,
    usePipeDelimiter: false,
    useSpaceColumns: false,
    columnPositions: [],
    expectedPricesPerLine: 1,
    itemSectionKnown: false,
    strategies: []
  };

  // Delimiter hints
  if (layout.columnPattern?.type === 'tab-delimited') {
    hints.useTabDelimiter = true;
    hints.strategies.push('delimiter-based');
  } else if (layout.columnPattern?.type === 'pipe-delimited') {
    hints.usePipeDelimiter = true;
    hints.strategies.push('delimiter-based');
  } else if (layout.columnPattern?.type === 'space-aligned') {
    hints.useSpaceColumns = true;
    hints.columnPositions = layout.columnPattern.positions;
    hints.strategies.push('column-based');
  }

  // Price pattern hints
  if (layout.pricePattern?.type === 'dual') {
    hints.expectedPricesPerLine = 2;
  } else if (layout.pricePattern?.type === 'single') {
    hints.expectedPricesPerLine = 1;
  }

  // Region hints
  hints.itemSectionKnown = layout.itemSection.startLine !== null;

  // Recommended strategies
  if (layout.itemSection.startLine !== null) {
    hints.strategies.unshift('header-guided');
  }
  hints.strategies.push('price-anchored');
  hints.strategies.push('universal-patterns');

  return hints;
}

/**
 * Quick structure detection for routing decisions
 */
function quickAnalyze(text) {
  const lines = text.split('\n');

  return {
    lineCount: lines.length,
    hasTabDelimiters: lines.some(l => l.includes('\t')),
    hasPipeDelimiters: lines.some(l => l.includes('|')),
    hasPrices: /\$?[\d,]+\.\d{2}/.test(text),
    hasQuantityColumn: /\bQTY\b|\bQUANTITY\b/i.test(text),
    hasTotalsSection: /\b(SUB)?TOTAL\s*:?\s*\$?[\d,]+\.?\d*/i.test(text),
    hasInvoiceKeywords: /INVOICE|BILL|STATEMENT/i.test(text),
    estimatedItemCount: (text.match(/\$?[\d,]+\.\d{2}$/gm) || []).length
  };
}

module.exports = {
  analyzeLayout,
  classifyLine,
  detectPricePattern,
  detectColumnPattern,
  extractRegion,
  generateParsingHints,
  quickAnalyze,
  REGION_KEYWORDS
};
