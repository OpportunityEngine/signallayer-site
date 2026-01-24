/**
 * Enhanced Invoice Parser
 *
 * Multi-strategy parsing with intelligent number classification,
 * column detection, and self-validation. Designed to handle
 * a wide variety of invoice formats accurately.
 */

const { classifyNumber, extractAndClassifyNumbers, validateAndFixLineItems, isLikelyMisclassifiedItemCode } = require('./numberClassifier');
const { detectInvoiceStructure, extractRightAnchoredPrices, extractLeftAnchoredQuantity, parseTabularData } = require('./columnDetector');
const { parseMoney, isGroupSubtotal } = require('./utils');
const { extractTotalsByLineScan, computeInvoiceMath, reconcileTotals } = require('./totals');

/**
 * Parse line item using multiple strategies, pick best result
 * @param {string} line - Invoice line
 * @param {Object} context - Parsing context (vendor, structure, etc.)
 * @returns {Object|null} Best parsed result
 */
function parseLineItemMultiStrategy(line, context = {}) {
  if (!line || line.trim().length < 10) return null;

  const trimmed = line.trim();

  // Skip obvious non-item lines
  if (isGroupSubtotal(trimmed)) return null;
  if (/^(SUB)?TOTAL\s/i.test(trimmed)) return null;
  if (/INVOICE\s+TOTAL/i.test(trimmed)) return null;
  if (/^\*+[A-Z]+\*+$/i.test(trimmed)) return null;  // Category headers like ****DAIRY****
  if (/SHOP\s+OUR|WWW\./i.test(trimmed)) return null;  // Promo/ad lines
  if (/^(QTY|QUANTITY|DESCRIPTION|ITEM|SKU|PRICE|AMOUNT|TOTAL)\s/i.test(trimmed)) return null;  // Header lines

  const candidates = [];

  // ===== STRATEGY 1: Right-anchored prices with left-anchored quantity =====
  const strategy1 = parseWithAnchoredApproach(trimmed);
  if (strategy1) {
    strategy1.strategy = 'anchored';
    candidates.push(strategy1);
  }

  // ===== STRATEGY 2: Number classification approach =====
  const strategy2 = parseWithClassification(trimmed);
  if (strategy2) {
    strategy2.strategy = 'classification';
    candidates.push(strategy2);
  }

  // ===== STRATEGY 3: Pattern-based for known formats =====
  const strategy3 = parseWithPatterns(trimmed, context);
  if (strategy3) {
    strategy3.strategy = 'pattern';
    candidates.push(strategy3);
  }

  // ===== STRATEGY 4: Multi-space split approach =====
  const strategy4 = parseWithSpaceSplit(trimmed);
  if (strategy4) {
    strategy4.strategy = 'space-split';
    candidates.push(strategy4);
  }

  if (candidates.length === 0) return null;

  // Score and rank candidates
  const scored = candidates.map(c => ({
    ...c,
    score: scoreCandidate(c)
  })).sort((a, b) => b.score - a.score);

  return scored[0];
}

/**
 * Strategy 1: Use anchored extraction (prices from right, qty from left)
 */
function parseWithAnchoredApproach(line) {
  const prices = extractRightAnchoredPrices(line);
  if (prices.length < 1) return null;

  const qty = extractLeftAnchoredQuantity(line);

  // Get line total (last price) and unit price (second-to-last)
  const lineTotal = prices[prices.length - 1];
  const unitPrice = prices.length >= 2 ? prices[prices.length - 2] : lineTotal;

  // Description is between qty and first price
  const descStart = qty ? qty.endPosition : 0;
  const descEnd = prices.length > 0 ? prices[0].position : line.length;

  let description = line.slice(descStart, descEnd).trim();

  // Remove trailing SKU/codes from description
  description = description.replace(/\s+\d{5,8}\s*$/, '').trim();
  description = description.replace(/\s+\d{5,8}\s+\d{5,8}\s*$/, '').trim();

  if (description.length < 3) return null;

  return {
    description,
    qty: qty?.value || 1,
    unit: qty?.unit || '',
    category: qty?.category || null,
    unitPriceCents: unitPrice.cents,
    lineTotalCents: lineTotal.cents,
    raw: line
  };
}

/**
 * Strategy 2: Use intelligent number classification
 */
function parseWithClassification(line) {
  const numbers = extractAndClassifyNumbers(line);

  // Need at least one price
  const prices = numbers.filter(n => n.type === 'price');
  if (prices.length === 0) return null;

  // Get quantities (small integers at start)
  const quantities = numbers.filter(n => n.type === 'quantity' && n.relativePosition < 0.3);

  // Get SKUs (larger numbers in middle)
  const skus = numbers.filter(n => n.type === 'sku');

  // Line total is typically the last price
  const lineTotal = prices[prices.length - 1];
  const unitPrice = prices.length >= 2 ? prices[prices.length - 2] : lineTotal;

  // Determine quantity
  let qty = 1;
  if (quantities.length > 0) {
    qty = quantities[0].value;
  }

  // Extract description (everything before the number cluster at end)
  const firstEndNumber = Math.min(
    ...[...skus.slice(-2), unitPrice, lineTotal]
      .filter(n => n)
      .map(n => n.startIndex)
  );

  let description = line.slice(0, firstEndNumber).trim();

  // Try to extract qty from description if not found
  if (quantities.length === 0) {
    const qtyMatch = description.match(/^([CFPD])?\s*(\d{1,3})\s*([A-Z]{1,4})?\s+/i);
    if (qtyMatch) {
      const parsedQty = parseInt(qtyMatch[2] || qtyMatch[1], 10);
      if (parsedQty >= 1 && parsedQty <= 999) {
        qty = parsedQty;
        description = description.slice(qtyMatch[0].length).trim();
      }
    }
  }

  if (description.length < 3) return null;

  return {
    description,
    qty,
    sku: skus.length > 0 ? String(Math.round(skus[0].value)) : null,
    unitPriceCents: Math.round(unitPrice.value * 100),
    lineTotalCents: Math.round(lineTotal.value * 100),
    raw: line,
    classificationDetails: {
      priceCount: prices.length,
      qtyCount: quantities.length,
      skuCount: skus.length
    }
  };
}

/**
 * Strategy 3: Pattern-based parsing for common formats
 */
function parseWithPatterns(line, context = {}) {
  const patterns = [
    // Pattern: [Cat] [Qty] [Unit] [Desc] [SKU] [SKU2] [Price] [Price]
    {
      regex: /^([CFPD])\s+(\d+)\s*([A-Z]{1,4})?\s+(.+?)\s+(\d{5,8})\s+(\d{5,8})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*$/i,
      extract: (m) => ({
        category: m[1],
        qty: parseInt(m[2], 10),
        unit: m[3] || '',
        description: m[4].trim(),
        sku: m[5],
        itemCode: m[6],
        unitPriceCents: parseMoney(m[7]),
        lineTotalCents: parseMoney(m[8])
      })
    },
    // Pattern: [Cat] [Qty][Unit] [Desc] [SKU] [SKU2] [Price] [Price] (merged qty+unit)
    {
      regex: /^([CFPD])\s+(\d+)([A-Z]{1,4})\s+(.+?)\s+(\d{5,8})\s+(\d{5,8})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*$/i,
      extract: (m) => ({
        category: m[1],
        qty: parseInt(m[2], 10),
        unit: m[3],
        description: m[4].trim(),
        sku: m[5],
        itemCode: m[6],
        unitPriceCents: parseMoney(m[7]),
        lineTotalCents: parseMoney(m[8])
      })
    },
    // Pattern: [Qty] [Desc] [Price] [Price]
    {
      regex: /^(\d{1,3})\s+(.{10,}?)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*$/i,
      extract: (m) => ({
        qty: parseInt(m[1], 10),
        description: m[2].trim(),
        unitPriceCents: parseMoney(m[3]),
        lineTotalCents: parseMoney(m[4])
      })
    },
    // Pattern: [Desc] [SKU] [Price] [Price]
    {
      regex: /^(.{10,}?)\s+(\d{5,12})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*$/i,
      extract: (m) => ({
        description: m[1].trim(),
        sku: m[2],
        qty: 1,
        unitPriceCents: parseMoney(m[3]),
        lineTotalCents: parseMoney(m[4])
      })
    },
    // Pattern: [Desc] [Price] (single price = total)
    {
      regex: /^(.{10,}?)\s+\$?([\d,]+\.\d{2})\s*$/i,
      extract: (m) => ({
        description: m[1].trim(),
        qty: 1,
        unitPriceCents: parseMoney(m[2]),
        lineTotalCents: parseMoney(m[2])
      })
    }
  ];

  for (const { regex, extract } of patterns) {
    const match = line.match(regex);
    if (match) {
      const result = extract(match);
      if (result.description && result.description.length >= 3 && result.lineTotalCents > 0) {
        result.raw = line;
        return result;
      }
    }
  }

  return null;
}

/**
 * Strategy 4: Split by multiple spaces
 */
function parseWithSpaceSplit(line) {
  const parts = line.split(/\s{2,}/).map(p => p.trim()).filter(p => p);

  if (parts.length < 2) return null;

  // Last parts are likely prices
  const lastPart = parts[parts.length - 1];
  const priceMatch = lastPart.match(/^\$?([\d,]+\.\d{2})$/);

  if (!priceMatch) return null;

  const lineTotal = parseMoney(priceMatch[1]);

  let unitPrice = lineTotal;
  let descParts = parts.slice(0, -1);

  // Check if second-to-last is also a price
  if (parts.length >= 3) {
    const secondLastMatch = parts[parts.length - 2].match(/^\$?([\d,]+\.\d{2})$/);
    if (secondLastMatch) {
      unitPrice = parseMoney(secondLastMatch[1]);
      descParts = parts.slice(0, -2);
    }
  }

  // Try to extract qty from first part
  let qty = 1;
  let description = descParts.join(' ');

  const qtyMatch = descParts[0]?.match(/^(\d{1,3})$/);
  if (qtyMatch && descParts.length > 1) {
    qty = parseInt(qtyMatch[1], 10);
    description = descParts.slice(1).join(' ');
  }

  if (description.length < 3) return null;

  return {
    description,
    qty,
    unitPriceCents: unitPrice,
    lineTotalCents: lineTotal,
    raw: line
  };
}

/**
 * Score a parsing candidate based on quality indicators
 */
function scoreCandidate(candidate) {
  let score = 50;  // Base score

  // Math validation: qty × unitPrice should ≈ lineTotal
  if (candidate.qty && candidate.unitPriceCents && candidate.lineTotalCents) {
    const computed = candidate.qty * candidate.unitPriceCents;
    const diff = Math.abs(computed - candidate.lineTotalCents);

    if (diff === 0) {
      score += 30;  // Perfect match
    } else if (diff <= 5) {
      score += 25;  // Within rounding
    } else if (diff <= candidate.lineTotalCents * 0.01) {
      score += 15;  // Within 1%
    } else if (diff > candidate.lineTotalCents * 0.5) {
      score -= 20;  // Way off - likely wrong
    }
  }

  // Reasonable quantity (1-50 is very common)
  if (candidate.qty >= 1 && candidate.qty <= 50) {
    score += 10;
  } else if (candidate.qty > 100) {
    score -= 15;  // Suspicious
  } else if (candidate.qty > 1000) {
    score -= 30;  // Almost certainly wrong
  }

  // Description quality
  if (candidate.description) {
    const desc = candidate.description;

    // Has letters (not just numbers)
    if (/[a-zA-Z]/.test(desc)) {
      score += 5;
    } else {
      score -= 10;
    }

    // Reasonable length
    if (desc.length >= 10 && desc.length <= 100) {
      score += 5;
    }

    // Contains product-like words
    if (/\b(CHEESE|MEAT|BEEF|CHICKEN|PORK|FISH|SHRIMP|MILK|CREAM|BUTTER|OIL|SAUCE|BREAD|FLOUR|SUGAR|SALT|PEPPER)\b/i.test(desc)) {
      score += 10;
    }
  }

  // Has SKU
  if (candidate.sku) {
    score += 5;
  }

  // Price reasonableness
  if (candidate.lineTotalCents > 0 && candidate.lineTotalCents <= 10000000) {
    score += 5;  // Under $100k is reasonable
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Main enhanced parsing function
 * @param {string} text - Full invoice text
 * @param {Object} options - Parsing options
 * @returns {Object} Parse result with items, totals, and validation
 */
function parseInvoiceEnhanced(text, options = {}) {
  const lines = text.split('\n');
  const structure = detectInvoiceStructure(text);

  // Extract totals using line scan
  const extractedTotals = extractTotalsByLineScan(text);

  // Parse line items
  const rawItems = [];
  let itemSectionStarted = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect item section start
    if (!itemSectionStarted) {
      if (/QTY.*DESCRIPTION|DESCRIPTION.*QTY|ITEM.*PRICE/i.test(line)) {
        itemSectionStarted = true;
        continue;
      }
      // Or if line looks like an item
      if (/^[CFPD]\s+\d+/i.test(line.trim())) {
        itemSectionStarted = true;
      }
    }

    // Stop at totals section
    if (/^INVOICE\s+TOTAL/i.test(line.trim())) break;
    if (/^SUBTOTAL\s*[\d$]/i.test(line.trim()) && !/GROUP/i.test(line)) break;

    if (itemSectionStarted || options.parseAllLines) {
      const parsed = parseLineItemMultiStrategy(line, { structure, vendor: options.vendor });
      if (parsed) {
        rawItems.push(parsed);
      }
    }
  }

  // Validate and fix items (correct qty errors, etc.)
  const validatedItems = validateAndFixLineItems(rawItems);

  // Compute math for reconciliation
  const computed = computeInvoiceMath(validatedItems, extractedTotals);
  const reconciliation = extractedTotals.totalCents > 0 && computed.computedTotalCents > 0
    ? reconcileTotals(extractedTotals.totalCents, computed.computedTotalCents)
    : null;

  // Build confidence score
  const confidence = calculateEnhancedConfidence(validatedItems, extractedTotals, reconciliation);

  return {
    success: validatedItems.length > 0 || extractedTotals.totalCents > 0,
    parserVersion: '2.5.0-enhanced',
    structure: structure.structure,
    lineItems: validatedItems.map((item, idx) => ({
      lineNumber: idx + 1,
      description: item.description,
      quantity: item.qty || item.quantity || 1,
      sku: item.sku || null,
      unitPriceCents: item.unitPriceCents || 0,
      lineTotalCents: item.lineTotalCents || 0,
      category: item.category || 'general',
      mathValidated: item.mathValidated || false,
      parseStrategy: item.strategy || 'unknown'
    })),
    totals: {
      subtotalCents: extractedTotals.subtotalCents,
      taxCents: extractedTotals.taxCents,
      totalCents: extractedTotals.totalCents,
      feesCents: extractedTotals.feesCents,
      discountCents: extractedTotals.discountCents
    },
    computed: {
      sumLineItemsCents: computed.sumLineItemsCents,
      computedTotalCents: computed.computedTotalCents
    },
    reconciliation,
    confidence,
    debug: {
      structureDetected: structure.structure,
      headerRowFound: !!structure.headerRow,
      rawItemCount: rawItems.length,
      validatedItemCount: validatedItems.length,
      mathCorrectedCount: validatedItems.filter(i => i.mathCorrected).length
    }
  };
}

/**
 * Calculate confidence score for enhanced parsing
 */
function calculateEnhancedConfidence(items, totals, reconciliation) {
  let score = 40;  // Base score
  const issues = [];
  const warnings = [];

  // Item quality
  if (items.length === 0) {
    score -= 20;
    issues.push('No line items extracted');
  } else {
    score += Math.min(20, items.length * 2);

    // Check how many passed math validation
    const validated = items.filter(i => i.mathValidated).length;
    const validationRate = validated / items.length;

    if (validationRate >= 0.9) {
      score += 15;
    } else if (validationRate >= 0.7) {
      score += 10;
    } else if (validationRate < 0.5) {
      score -= 10;
      warnings.push(`Only ${Math.round(validationRate * 100)}% of items passed math validation`);
    }

    // Check for suspicious quantities
    const suspiciousQty = items.filter(i => (i.qty || i.quantity) > 100).length;
    if (suspiciousQty > 0) {
      score -= suspiciousQty * 5;
      issues.push(`${suspiciousQty} items have suspicious quantities > 100`);
    }
  }

  // Totals quality
  if (totals.totalCents > 0) {
    score += 10;
  } else {
    issues.push('No invoice total found');
  }

  // Reconciliation
  if (reconciliation) {
    if (reconciliation.matches || reconciliation.toleranceOk) {
      score += 15;
    } else if (Math.abs(reconciliation.deltaCents) < totals.totalCents * 0.1) {
      score += 5;
      warnings.push('Line items sum differs slightly from total');
    } else {
      warnings.push(`Significant mismatch between items sum and total`);
    }
  }

  return {
    score: Math.min(100, Math.max(0, score)),
    issues,
    warnings
  };
}

module.exports = {
  parseInvoiceEnhanced,
  parseLineItemMultiStrategy,
  scoreCandidate
};
