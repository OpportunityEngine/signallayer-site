/**
 * Adaptive Invoice Parser
 *
 * Handles unknown invoice formats by trying multiple parsing strategies
 * and selecting the best result based on confidence scoring.
 *
 * Strategies (in order of attempt):
 * 1. Header-guided: Use detected column headers to parse
 * 2. Price-anchored: Find prices first, work backwards
 * 3. Pattern-based: Try common invoice line patterns
 * 4. Delimiter-based: Split by tabs, multiple spaces, pipes
 * 5. Heuristic: Use ML-like heuristics to classify line components
 */

const { parseMoney } = require('./utils');
const { classifyNumber, extractAndClassifyNumbers, validateAndFixLineItems } = require('./numberClassifier');
const { extractRightAnchoredPrices, extractLeftAnchoredQuantity, detectHeaderRow } = require('./columnDetector');

/**
 * Universal invoice patterns that work across many vendors
 */
const UNIVERSAL_PATTERNS = [
  // [Qty] [Description] [Unit Price] [Extended]
  {
    name: 'qty-desc-price-ext',
    regex: /^(\d{1,3})\s+(.{10,}?)\s+\$?([\d,]+\.\d{2})\s+\$?([\d,]+\.\d{2})\s*$/,
    extract: (m) => ({ qty: parseInt(m[1]), description: m[2].trim(), unitPriceCents: parseMoney(m[3]), lineTotalCents: parseMoney(m[4]) })
  },
  // [SKU] [Qty] [Description] [Price] [Extended]
  {
    name: 'sku-qty-desc-price-ext',
    regex: /^(\d{4,12})\s+(\d{1,3})\s+(.{5,}?)\s+\$?([\d,]+\.\d{2})\s+\$?([\d,]+\.\d{2})\s*$/,
    extract: (m) => ({ sku: m[1], qty: parseInt(m[2]), description: m[3].trim(), unitPriceCents: parseMoney(m[4]), lineTotalCents: parseMoney(m[5]) })
  },
  // [Qty] [SKU] [Description] [Price] [Extended]
  {
    name: 'qty-sku-desc-price-ext',
    regex: /^(\d{1,3})\s+(\d{4,12})\s+(.{5,}?)\s+\$?([\d,]+\.\d{2})\s+\$?([\d,]+\.\d{2})\s*$/,
    extract: (m) => ({ qty: parseInt(m[1]), sku: m[2], description: m[3].trim(), unitPriceCents: parseMoney(m[4]), lineTotalCents: parseMoney(m[5]) })
  },
  // [Description] [Qty] [Price] [Extended]
  {
    name: 'desc-qty-price-ext',
    regex: /^(.{10,}?)\s+(\d{1,3})\s+\$?([\d,]+\.\d{2})\s+\$?([\d,]+\.\d{2})\s*$/,
    extract: (m) => ({ description: m[1].trim(), qty: parseInt(m[2]), unitPriceCents: parseMoney(m[3]), lineTotalCents: parseMoney(m[4]) })
  },
  // [Description] [Price] (single price, qty=1)
  {
    name: 'desc-price',
    regex: /^(.{10,}?)\s+\$?([\d,]+\.\d{2})\s*$/,
    extract: (m) => ({ description: m[1].trim(), qty: 1, unitPriceCents: parseMoney(m[2]), lineTotalCents: parseMoney(m[2]) })
  },
  // [Item#] [Description] [Price]
  {
    name: 'item-desc-price',
    regex: /^([A-Z0-9\-]{4,15})\s+(.{5,}?)\s+\$?([\d,]+\.\d{2})\s*$/,
    extract: (m) => ({ sku: m[1], description: m[2].trim(), qty: 1, unitPriceCents: parseMoney(m[3]), lineTotalCents: parseMoney(m[3]) })
  },
  // Tab-delimited: SKU\tDescription\tQty\tPrice\tTotal
  {
    name: 'tab-delimited',
    regex: /^([^\t]+)\t([^\t]+)\t(\d+)\t\$?([\d,]+\.?\d*)\t\$?([\d,]+\.\d{2})$/,
    extract: (m) => ({ sku: m[1].trim(), description: m[2].trim(), qty: parseInt(m[3]), unitPriceCents: parseMoney(m[4]), lineTotalCents: parseMoney(m[5]) })
  }
];

/**
 * Lines to skip (headers, footers, totals, etc.)
 */
const SKIP_PATTERNS = [
  /^(ITEM|SKU|DESCRIPTION|QTY|QUANTITY|PRICE|AMOUNT|UNIT|TOTAL|SUBTOTAL)/i,
  /^(SUB)?TOTAL\s/i,
  /INVOICE\s+(TOTAL|NUMBER|DATE)/i,
  /^PAGE\s+\d+/i,
  /^(SHIP|BILL|SOLD)\s+TO/i,
  /THANK\s+YOU/i,
  /REMIT\s+TO/i,
  /^-+$/,
  /^=+$/,
  /^\*+$/,
  /^\.+$/
];

/**
 * Strategy 1: Header-guided parsing
 * Detect column headers and use positions to parse data
 */
function parseWithHeaderGuide(text) {
  const lines = text.split('\n');
  const headerInfo = detectHeaderRow(lines);

  if (!headerInfo || headerInfo.columnCount < 3) {
    return { success: false, reason: 'No header row detected' };
  }

  const items = [];
  const foundTotals = [];      // Track totals but don't stop
  const columnPositions = headerInfo.columns.map(c => ({
    name: c.column,
    start: c.position,
    end: c.endPosition
  }));
  let lastParsedLineIndex = headerInfo.lineIndex;

  // Parse lines after header - scan ENTIRE document, don't stop at subtotals
  for (let i = headerInfo.lineIndex + 1; i < lines.length; i++) {
    lastParsedLineIndex = i;
    const line = lines[i];
    if (!line.trim() || shouldSkipLine(line)) continue;

    // Track totals but DON'T break - continue scanning for more items
    if (/^(SUB)?TOTAL\s/i.test(line.trim())) {
      const totalMatch = line.match(/[\d,]+\.?\d*/);
      if (totalMatch) {
        foundTotals.push({ line: i, label: line.trim().split(/\s/)[0], value: totalMatch[0] });
      }
      continue; // Don't break - there may be more items after this subtotal
    }

    const item = parseLineWithColumns(line, columnPositions);
    if (item && item.lineTotalCents > 0) {
      items.push(item);
    }
  }

  return {
    success: items.length > 0,
    strategy: 'header-guided',
    items,
    headerInfo,
    scanInfo: {
      totalLines: lines.length,
      lastParsedLineIndex,
      foundTotals,
      fullDocumentScanned: lastParsedLineIndex >= lines.length - 1
    }
  };
}

/**
 * Parse a line using detected column positions
 */
function parseLineWithColumns(line, columns) {
  const item = { qty: 1 };

  for (const col of columns) {
    // Get value at column position (with some flexibility)
    const start = Math.max(0, col.start - 2);
    const end = Math.min(line.length, col.end + 10);
    const rawValue = line.slice(start, end).trim();

    // Clean and parse based on column type
    switch (col.name) {
      case 'quantity':
        const qty = parseInt(rawValue.match(/\d+/)?.[0] || '1', 10);
        if (qty >= 1 && qty <= 999) item.qty = qty;
        break;

      case 'sku':
        const sku = rawValue.match(/[A-Z0-9\-]{4,15}/i)?.[0];
        if (sku) item.sku = sku;
        break;

      case 'description':
        item.description = rawValue.replace(/\s+/g, ' ').trim();
        break;

      case 'unitPrice':
        item.unitPriceCents = parseMoney(rawValue);
        break;

      case 'total':
        item.lineTotalCents = parseMoney(rawValue);
        break;
    }
  }

  // If no description, try to get it from the middle
  if (!item.description || item.description.length < 3) {
    const firstCol = columns[0]?.end || 0;
    const lastCol = columns[columns.length - 1]?.start || line.length;
    item.description = line.slice(firstCol, lastCol).trim().replace(/\s+/g, ' ');
  }

  return item.description && item.description.length >= 3 ? item : null;
}

/**
 * Strategy 2: Price-anchored parsing
 * Find prices at end of line, work backwards
 */
function parseWithPriceAnchor(text) {
  const lines = text.split('\n');
  const items = [];

  for (const line of lines) {
    if (!line.trim() || shouldSkipLine(line)) continue;

    const prices = extractRightAnchoredPrices(line);
    if (prices.length === 0) continue;

    // Line total is the rightmost price
    const lineTotal = prices[prices.length - 1];
    const unitPrice = prices.length >= 2 ? prices[prices.length - 2] : lineTotal;

    // Find quantity from left side
    const qtyInfo = extractLeftAnchoredQuantity(line);
    const qty = qtyInfo?.value || 1;

    // Description is between qty and prices
    const descStart = qtyInfo ? qtyInfo.endPosition : 0;
    const descEnd = prices.length > 0 ? prices[0].position : line.length;
    let description = line.slice(descStart, descEnd).trim();

    // Clean description (remove trailing SKUs)
    description = description.replace(/\s+\d{5,12}\s*$/, '').trim();
    description = description.replace(/\s{2,}/g, ' ');

    if (description.length >= 3 && lineTotal.value > 0) {
      items.push({
        description,
        qty,
        unitPriceCents: unitPrice.cents,
        lineTotalCents: lineTotal.cents
      });
    }
  }

  return {
    success: items.length > 0,
    strategy: 'price-anchored',
    items
  };
}

/**
 * Strategy 3: Universal pattern matching
 * Try each pattern until one matches
 */
function parseWithUniversalPatterns(text) {
  const lines = text.split('\n');
  const items = [];
  const patternStats = {};

  for (const line of lines) {
    if (!line.trim() || shouldSkipLine(line)) continue;

    for (const pattern of UNIVERSAL_PATTERNS) {
      const match = line.match(pattern.regex);
      if (match) {
        try {
          const item = pattern.extract(match);
          if (item && item.description && item.lineTotalCents > 0) {
            item.raw = line;
            item.patternUsed = pattern.name;
            items.push(item);

            // Track pattern success
            patternStats[pattern.name] = (patternStats[pattern.name] || 0) + 1;
            break;  // Move to next line
          }
        } catch (e) {
          // Pattern extraction failed, try next
        }
      }
    }
  }

  return {
    success: items.length > 0,
    strategy: 'universal-patterns',
    items,
    patternStats
  };
}

/**
 * Strategy 4: Delimiter-based parsing
 * Split by common delimiters (tabs, pipes, multiple spaces)
 */
function parseWithDelimiters(text) {
  const lines = text.split('\n');
  const items = [];

  // Detect most common delimiter
  const delimiters = [
    { char: '\t', name: 'tab' },
    { char: '|', name: 'pipe' },
    { char: /\s{3,}/, name: 'multi-space' }
  ];

  for (const line of lines) {
    if (!line.trim() || shouldSkipLine(line)) continue;

    for (const delim of delimiters) {
      const parts = line.split(delim.char).map(p => p.trim()).filter(p => p);

      if (parts.length >= 3) {
        // Try to identify which parts are what
        const item = identifyPartsAsItem(parts);
        if (item && item.description && item.lineTotalCents > 0) {
          items.push(item);
          break;
        }
      }
    }
  }

  return {
    success: items.length > 0,
    strategy: 'delimiter-based',
    items
  };
}

/**
 * Try to identify parts as item components
 */
function identifyPartsAsItem(parts) {
  const item = { qty: 1 };

  // Find price-like values (last ones are usually prices)
  const pricePattern = /^\$?[\d,]+\.\d{2}$/;
  const prices = [];
  let priceStartIndex = parts.length;

  for (let i = parts.length - 1; i >= 0; i--) {
    if (pricePattern.test(parts[i])) {
      prices.unshift(parseMoney(parts[i]));
      priceStartIndex = i;
    } else {
      break;  // Stop when we hit non-price
    }
  }

  if (prices.length === 0) return null;

  item.lineTotalCents = prices[prices.length - 1];
  item.unitPriceCents = prices.length >= 2 ? prices[prices.length - 2] : item.lineTotalCents;

  // Find quantity (small integer, usually early in parts)
  for (let i = 0; i < priceStartIndex; i++) {
    const qtyMatch = parts[i].match(/^(\d{1,3})$/);
    if (qtyMatch) {
      const qty = parseInt(qtyMatch[1], 10);
      if (qty >= 1 && qty <= 999) {
        item.qty = qty;
        break;
      }
    }
  }

  // Find SKU (alphanumeric, 4-15 chars)
  for (let i = 0; i < priceStartIndex; i++) {
    if (/^[A-Z0-9\-]{4,15}$/i.test(parts[i]) && !/^\d+$/.test(parts[i])) {
      item.sku = parts[i];
      break;
    }
  }

  // Description is longest text part that's not qty/sku/price
  let maxLen = 0;
  for (let i = 0; i < priceStartIndex; i++) {
    const part = parts[i];
    if (part === String(item.qty)) continue;
    if (part === item.sku) continue;
    if (part.length > maxLen && /[a-zA-Z]/.test(part)) {
      item.description = part;
      maxLen = part.length;
    }
  }

  return item;
}

/**
 * Strategy 5: Heuristic classification
 * Use number classification to identify line components
 */
function parseWithHeuristics(text) {
  const lines = text.split('\n');
  const items = [];

  for (const line of lines) {
    if (!line.trim() || line.trim().length < 15 || shouldSkipLine(line)) continue;

    const classified = extractAndClassifyNumbers(line);

    // Need at least one price
    const prices = classified.filter(n => n.type === 'price');
    if (prices.length === 0) continue;

    const quantities = classified.filter(n => n.type === 'quantity');
    const skus = classified.filter(n => n.type === 'sku');

    const lineTotal = prices[prices.length - 1];
    const unitPrice = prices.length >= 2 ? prices[prices.length - 2] : lineTotal;
    const qty = quantities.length > 0 ? quantities[0].value : 1;
    const sku = skus.length > 0 ? String(Math.round(skus[0].value)) : null;

    // Extract description (text before the number cluster)
    const firstNumberPos = Math.min(
      lineTotal.startIndex,
      unitPrice.startIndex,
      ...(skus.slice(-1).map(s => s.startIndex))
    );

    let description = line.slice(0, firstNumberPos).trim();

    // Remove leading qty if present
    if (quantities.length > 0 && quantities[0].startIndex < 5) {
      description = line.slice(quantities[0].endIndex, firstNumberPos).trim();
    }

    description = description.replace(/\s+/g, ' ');

    if (description.length >= 3 && lineTotal.value > 0) {
      items.push({
        description,
        qty,
        sku,
        unitPriceCents: Math.round(unitPrice.value * 100),
        lineTotalCents: Math.round(lineTotal.value * 100)
      });
    }
  }

  return {
    success: items.length > 0,
    strategy: 'heuristic-classification',
    items
  };
}

/**
 * Check if line should be skipped
 */
function shouldSkipLine(line) {
  const trimmed = line.trim();
  if (trimmed.length < 5) return true;

  for (const pattern of SKIP_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }

  return false;
}

/**
 * Score a parsing result
 */
function scoreResult(result, totals = {}) {
  if (!result.success) return 0;

  let score = 30;  // Base score for having items
  const items = result.items;

  // More items = higher confidence
  score += Math.min(20, items.length * 2);

  // Check math validation
  let validMath = 0;
  for (const item of items) {
    const qty = item.qty || 1;
    const computed = qty * (item.unitPriceCents || 0);
    const diff = Math.abs(computed - (item.lineTotalCents || 0));
    if (diff <= 5) validMath++;
  }

  const mathRate = items.length > 0 ? validMath / items.length : 0;
  score += Math.round(mathRate * 20);

  // Check if sum matches totals
  if (totals.totalCents > 0) {
    const sum = items.reduce((s, i) => s + (i.lineTotalCents || 0), 0);
    const diff = Math.abs(sum - totals.totalCents);
    const pct = diff / totals.totalCents;

    if (pct <= 0.02) score += 20;
    else if (pct <= 0.10) score += 10;
    else if (pct <= 0.25) score += 5;
  }

  // Penalize suspicious quantities
  const badQty = items.filter(i => (i.qty || 1) > 100).length;
  score -= badQty * 5;

  return Math.max(0, Math.min(100, score));
}

/**
 * Main adaptive parsing function
 * Tries all strategies and returns best result
 */
function parseAdaptive(text, options = {}) {
  const strategies = [
    { name: 'header-guided', fn: parseWithHeaderGuide },
    { name: 'price-anchored', fn: parseWithPriceAnchor },
    { name: 'universal-patterns', fn: parseWithUniversalPatterns },
    { name: 'delimiter-based', fn: parseWithDelimiters },
    { name: 'heuristic', fn: parseWithHeuristics }
  ];

  const results = [];
  const totals = options.totals || {};

  for (const strategy of strategies) {
    try {
      const result = strategy.fn(text);
      result.score = scoreResult(result, totals);
      results.push(result);
    } catch (err) {
      console.error(`[ADAPTIVE] Strategy ${strategy.name} failed:`, err.message);
    }
  }

  // Sort by score
  results.sort((a, b) => b.score - a.score);

  const best = results[0];

  if (!best || !best.success) {
    return {
      success: false,
      lineItems: [],
      strategy: 'none',
      confidence: { score: 0, issues: ['No parsing strategy succeeded'] }
    };
  }

  // Validate and fix items
  const validatedItems = validateAndFixLineItems(best.items);

  return {
    success: true,
    lineItems: validatedItems,
    strategy: best.strategy,
    score: best.score,
    alternatives: results.slice(1, 4).map(r => ({
      strategy: r.strategy,
      score: r.score,
      itemCount: r.items?.length || 0
    })),
    confidence: {
      score: best.score,
      issues: [],
      warnings: best.score < 60 ? ['Low confidence parse - manual review recommended'] : []
    },
    debug: {
      strategiesAttempted: strategies.length,
      strategiesSucceeded: results.filter(r => r.success).length,
      bestStrategy: best.strategy,
      patternStats: best.patternStats
    }
  };
}

module.exports = {
  parseAdaptive,
  parseWithHeaderGuide,
  parseWithPriceAnchor,
  parseWithUniversalPatterns,
  parseWithDelimiters,
  parseWithHeuristics,
  scoreResult,
  UNIVERSAL_PATTERNS,
  SKIP_PATTERNS
};
