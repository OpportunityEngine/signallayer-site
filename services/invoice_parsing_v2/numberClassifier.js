/**
 * Invoice Number Classifier
 *
 * Intelligently classifies numbers found in invoice text as:
 * - quantity (small integers: 1-999)
 * - sku/itemCode (5-12 digit codes, sometimes alphanumeric)
 * - price (decimal numbers, typically $X.XX format)
 * - packSize (like "25", "12" when followed by units)
 * - unknown
 *
 * This helps prevent misclassification like using an item code as quantity.
 */

/**
 * Classify a number based on its value and context
 * @param {string|number} value - The number to classify
 * @param {string} context - Surrounding text for context clues
 * @param {number} position - Position in line (0=start, 1=end)
 * @returns {Object} Classification result
 */
function classifyNumber(value, context = '', position = 0.5) {
  const numStr = String(value).trim();
  const num = parseFloat(numStr.replace(/,/g, ''));

  if (isNaN(num)) {
    return { type: 'unknown', confidence: 0, value: numStr };
  }

  const result = {
    value: num,
    raw: numStr,
    type: 'unknown',
    confidence: 0,
    reasons: []
  };

  // Check if it looks like a price (has decimal with 2 places)
  const isPriceFormat = /^\$?[\d,]+\.\d{2}$/.test(numStr);

  // Check if it's a whole number
  const isWholeNumber = Number.isInteger(num);

  // Check digit count
  const digitCount = numStr.replace(/[^\d]/g, '').length;

  // ===== PRICE DETECTION =====
  if (isPriceFormat) {
    result.type = 'price';
    result.confidence = 90;
    result.reasons.push('Has decimal with 2 places');

    // Prices at end of line are more confident
    if (position > 0.7) {
      result.confidence += 5;
      result.reasons.push('Located at end of line');
    }

    // Reasonable price range ($0.01 - $99,999.99)
    if (num >= 0.01 && num <= 99999.99) {
      result.confidence += 5;
      result.reasons.push('In reasonable price range');
    }

    return result;
  }

  // ===== SKU/ITEM CODE DETECTION =====
  if (isWholeNumber && digitCount >= 5 && digitCount <= 12) {
    result.type = 'sku';
    result.confidence = 85;
    result.reasons.push(`${digitCount}-digit whole number (typical SKU length)`);

    // SKUs are usually not at the very start of a line
    if (position > 0.3 && position < 0.9) {
      result.confidence += 5;
      result.reasons.push('Located in middle of line (typical SKU position)');
    }

    // Large numbers are almost certainly not quantities
    if (num > 10000) {
      result.confidence += 10;
      result.reasons.push('Too large to be a quantity');
    }

    return result;
  }

  // ===== QUANTITY DETECTION =====
  if (isWholeNumber && num >= 1 && num <= 999) {
    result.type = 'quantity';
    result.confidence = 70;
    result.reasons.push('Small whole number (1-999)');

    // Quantities at start of line are more confident
    if (position < 0.3) {
      result.confidence += 15;
      result.reasons.push('Located at start of line');
    }

    // Check context for unit indicators
    const unitPattern = /\b(CS|CASE|EA|EACH|PK|PACK|BOX|LB|GAL|OZ|CT|DOZ|PC|PCS|UNIT|UNITS)\b/i;
    if (unitPattern.test(context)) {
      result.confidence += 10;
      result.reasons.push('Has unit indicator nearby');
    }

    // Very small quantities (1-10) are most common
    if (num <= 10) {
      result.confidence += 5;
      result.reasons.push('Common quantity range');
    }

    return result;
  }

  // ===== PACK SIZE DETECTION =====
  // Numbers like 25, 12, 6 when followed by weight/volume units
  if (isWholeNumber && num >= 1 && num <= 1000) {
    const packSizePattern = /\d+\s*(LB|LBS|OZ|GAL|GALLON|QT|PT|ML|L|KG|G)\b/i;
    if (packSizePattern.test(context)) {
      result.type = 'packSize';
      result.confidence = 75;
      result.reasons.push('Number followed by weight/volume unit');
      return result;
    }
  }

  // Default: unknown with low confidence
  result.type = 'unknown';
  result.confidence = 30;
  result.reasons.push('Could not determine type');

  return result;
}

/**
 * Extract and classify all numbers from a line
 * @param {string} line - Invoice line text
 * @returns {Array} Array of classified numbers with positions
 */
function extractAndClassifyNumbers(line) {
  if (!line) return [];

  const results = [];
  const lineLength = line.length;

  // Find all number-like patterns
  const numberPattern = /\$?[\d,]+\.?\d*/g;
  let match;

  while ((match = numberPattern.exec(line)) !== null) {
    const numStr = match[0];
    const startPos = match.index;
    const relativePosition = startPos / lineLength;

    // Get surrounding context (20 chars each side)
    const contextStart = Math.max(0, startPos - 20);
    const contextEnd = Math.min(lineLength, startPos + numStr.length + 20);
    const context = line.slice(contextStart, contextEnd);

    const classification = classifyNumber(numStr, context, relativePosition);
    classification.startIndex = startPos;
    classification.endIndex = startPos + numStr.length;
    classification.relativePosition = relativePosition;

    results.push(classification);
  }

  return results;
}

/**
 * Analyze a line and extract structured data using number classification
 * @param {string} line - Invoice line
 * @returns {Object|null} Extracted line item or null
 */
function analyzeLineWithClassification(line) {
  if (!line || line.trim().length < 10) return null;

  const trimmed = line.trim();
  const numbers = extractAndClassifyNumbers(trimmed);

  if (numbers.length < 2) return null;  // Need at least qty and price

  // Find the most likely candidates for each type
  const prices = numbers.filter(n => n.type === 'price').sort((a, b) => b.confidence - a.confidence);
  const quantities = numbers.filter(n => n.type === 'quantity').sort((a, b) => b.confidence - a.confidence);
  const skus = numbers.filter(n => n.type === 'sku').sort((a, b) => b.confidence - a.confidence);

  // Need at least one price
  if (prices.length === 0) return null;

  // The last price is typically the line total
  const lineTotal = prices[prices.length - 1];
  const unitPrice = prices.length >= 2 ? prices[prices.length - 2] : lineTotal;

  // Get quantity (default to 1)
  let qty = 1;
  if (quantities.length > 0) {
    qty = quantities[0].value;
  }

  // Get SKU if available
  let sku = null;
  if (skus.length > 0) {
    sku = String(Math.round(skus[0].value));
  }

  // Extract description (text before the numbers at the end)
  // Find where the "number cluster" at the end starts
  const lastNumberStart = Math.min(
    lineTotal.startIndex,
    unitPrice.startIndex,
    ...(skus.length > 0 ? [skus[skus.length - 1].startIndex] : [lineTotal.startIndex])
  );

  let description = trimmed.slice(0, lastNumberStart).trim();

  // Clean up description
  description = description
    .replace(/\s+/g, ' ')
    .replace(/[|]+$/, '')  // Remove trailing pipes
    .trim();

  if (description.length < 3) return null;

  return {
    description,
    qty,
    sku,
    unitPriceCents: Math.round(unitPrice.value * 100),
    lineTotalCents: Math.round(lineTotal.value * 100),
    confidence: Math.min(lineTotal.confidence, quantities.length > 0 ? quantities[0].confidence : 50),
    classification: {
      prices: prices.map(p => ({ value: p.value, confidence: p.confidence })),
      quantities: quantities.map(q => ({ value: q.value, confidence: q.confidence })),
      skus: skus.map(s => ({ value: s.value, confidence: s.confidence }))
    }
  };
}

/**
 * Validate line item math: qty × unitPrice ≈ lineTotal
 * @param {Object} item - Line item to validate
 * @param {number} tolerance - Allowed difference in cents (default 5)
 * @returns {Object} Validation result
 */
function validateLineItemMath(item, tolerance = 5) {
  if (!item || !item.qty || !item.unitPriceCents || !item.lineTotalCents) {
    return { valid: false, reason: 'Missing required fields' };
  }

  const computed = item.qty * item.unitPriceCents;
  const diff = Math.abs(computed - item.lineTotalCents);

  if (diff <= tolerance) {
    return { valid: true, diff, computed, actual: item.lineTotalCents };
  }

  // Check if qty might be wrong (common issue)
  // Try to find a qty that makes the math work
  if (item.unitPriceCents > 0) {
    const impliedQty = Math.round(item.lineTotalCents / item.unitPriceCents);
    if (impliedQty >= 1 && impliedQty <= 999) {
      const impliedDiff = Math.abs(impliedQty * item.unitPriceCents - item.lineTotalCents);
      if (impliedDiff <= tolerance) {
        return {
          valid: false,
          reason: 'Qty appears incorrect',
          suggestedQty: impliedQty,
          diff,
          computed,
          actual: item.lineTotalCents
        };
      }
    }
  }

  return {
    valid: false,
    reason: `Math mismatch: ${item.qty} × $${(item.unitPriceCents/100).toFixed(2)} = $${(computed/100).toFixed(2)} ≠ $${(item.lineTotalCents/100).toFixed(2)}`,
    diff,
    computed,
    actual: item.lineTotalCents
  };
}

/**
 * Post-process and validate extracted line items
 * Attempts to fix common issues
 * @param {Array} items - Array of line items
 * @returns {Array} Validated and potentially corrected items
 */
function validateAndFixLineItems(items) {
  if (!items || !Array.isArray(items)) return [];

  return items.map(item => {
    const validation = validateLineItemMath(item);

    if (validation.valid) {
      return { ...item, mathValidated: true };
    }

    // Try to fix the item
    if (validation.suggestedQty) {
      console.log(`[NUMBER CLASSIFIER] Fixing qty: ${item.qty} -> ${validation.suggestedQty} for "${item.description?.slice(0, 30)}..."`);
      return {
        ...item,
        qty: validation.suggestedQty,
        quantity: validation.suggestedQty,
        mathValidated: true,
        mathCorrected: true,
        originalQty: item.qty
      };
    }

    // Return as-is but flagged
    return {
      ...item,
      mathValidated: false,
      mathError: validation.reason
    };
  });
}

/**
 * Detect if a number is likely an item code being misused as quantity
 * @param {number} qty - The quantity value
 * @param {number} unitPrice - Unit price in cents
 * @param {number} lineTotal - Line total in cents
 * @returns {boolean}
 */
function isLikelyMisclassifiedItemCode(qty, unitPrice, lineTotal) {
  // If qty > 1000, it's almost certainly not a quantity
  if (qty > 1000) return true;

  // If qty has 5+ digits, likely an item code
  if (String(qty).length >= 5) return true;

  // If qty × unitPrice is way off from lineTotal, qty is probably wrong
  if (unitPrice > 0 && lineTotal > 0) {
    const computed = qty * unitPrice;
    const ratio = computed / lineTotal;
    // If computed is more than 100x or less than 0.01x the total, qty is wrong
    if (ratio > 100 || ratio < 0.01) return true;
  }

  return false;
}

module.exports = {
  classifyNumber,
  extractAndClassifyNumbers,
  analyzeLineWithClassification,
  validateLineItemMath,
  validateAndFixLineItems,
  isLikelyMisclassifiedItemCode
};
