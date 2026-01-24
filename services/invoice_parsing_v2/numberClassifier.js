/**
 * Invoice Number Classifier
 *
 * Intelligently classifies numbers found in invoice text as:
 * - quantity (small integers: 1-999)
 * - sku/itemCode (5-12 digit codes, sometimes alphanumeric)
 * - price (decimal numbers, typically $X.XX or $X.XXX format)
 * - weight (decimal with LB/OZ context, for catch-weight items)
 * - packSize (like "25", "12" when followed by units)
 * - unknown
 *
 * This helps prevent misclassification like using an item code as quantity.
 *
 * PRECISION: Supports 3 decimal places for prices (e.g., $1.587/LB)
 * to ensure accurate line item calculations before final rounding.
 */

const { parseMoneyToDollars, calculateLineTotalCents } = require('./utils');

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

  // Check if it looks like a price (has decimal with 2 OR 3 places)
  // 3 decimal places are common for per-pound/per-unit pricing like $1.587/LB
  const isPriceFormat2Decimals = /^\$?[\d,]+\.\d{2}$/.test(numStr);
  const isPriceFormat3Decimals = /^\$?[\d,]+\.\d{3}$/.test(numStr);
  const isPriceFormat = isPriceFormat2Decimals || isPriceFormat3Decimals;

  // Check if it's a whole number
  const isWholeNumber = Number.isInteger(num);

  // Check digit count
  const digitCount = numStr.replace(/[^\d]/g, '').length;

  // Check for weight context (catch-weight items)
  const hasWeightContext = /\b(LB|LBS|OZ|KG|POUND|OUNCE)\b/i.test(context);
  const hasPerUnitContext = /\/(LB|OZ|EA|EACH|UNIT)\b/i.test(context);

  // ===== WEIGHT DETECTION (for catch-weight items) =====
  if (!isWholeNumber && hasWeightContext && num > 0 && num < 1000) {
    // This might be a weight value, not a price
    // Check if it's in a position that suggests weight (before prices)
    if (position < 0.5) {
      result.type = 'weight';
      result.confidence = 80;
      result.reasons.push('Decimal number with weight unit context');
      result.reasons.push('Located before prices (typical weight position)');
      return result;
    }
  }

  // ===== PRICE DETECTION =====
  if (isPriceFormat) {
    result.type = 'price';
    result.confidence = 90;
    result.decimals = isPriceFormat3Decimals ? 3 : 2;

    if (isPriceFormat3Decimals) {
      result.reasons.push('Has decimal with 3 places (per-unit pricing)');
      result.confidence += 5;  // 3 decimal prices are more precise
    } else {
      result.reasons.push('Has decimal with 2 places');
    }

    // Per-unit pricing context increases confidence
    if (hasPerUnitContext) {
      result.confidence += 5;
      result.reasons.push('Has per-unit pricing context (/LB, /EA, etc.)');
    }

    // Prices at end of line are more confident
    if (position > 0.7) {
      result.confidence += 5;
      result.reasons.push('Located at end of line');
    }

    // Reasonable price range ($0.001 - $99,999.999)
    if (num >= 0.001 && num <= 99999.999) {
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

  // Store prices with full precision (3 decimals) for accurate calculations
  const unitPriceDollars = parseMoneyToDollars(unitPrice.value, 3);
  const lineTotalDollars = parseMoneyToDollars(lineTotal.value, 3);

  // Calculate cents using precision math
  const unitPriceCents = Math.round(unitPriceDollars * 100);
  const lineTotalCents = Math.round(lineTotalDollars * 100);

  // Calculate what the line total SHOULD be with full precision
  const computedTotalCents = calculateLineTotalCents(qty, unitPriceDollars);

  return {
    description,
    qty,
    sku,
    // Store both cents (for storage) and dollars (for precision)
    unitPriceDollars,      // Full precision: 1.587
    unitPriceCents,        // Rounded: 159
    lineTotalDollars,      // Full precision: 15.87
    lineTotalCents,        // Rounded: 1587
    computedTotalCents,    // qty × unitPriceDollars × 100, rounded
    confidence: Math.min(lineTotal.confidence, quantities.length > 0 ? quantities[0].confidence : 50),
    classification: {
      prices: prices.map(p => ({ value: p.value, confidence: p.confidence, decimals: p.decimals || 2 })),
      quantities: quantities.map(q => ({ value: q.value, confidence: q.confidence })),
      skus: skus.map(s => ({ value: s.value, confidence: s.confidence }))
    }
  };
}

/**
 * Rounding modes for price calculations
 * Different vendors use different rounding strategies
 */
const ROUNDING_MODES = {
  STANDARD: 'standard',     // Math.round (0.5 rounds up)
  BANKERS: 'bankers',       // Round half to even (reduces cumulative bias)
  FLOOR: 'floor',           // Always round down
  CEIL: 'ceil'              // Always round up
};

/**
 * Apply rounding with specified mode
 * @param {number} value - Value to round
 * @param {string} mode - Rounding mode
 * @returns {number} - Rounded value
 */
function applyRounding(value, mode = ROUNDING_MODES.STANDARD) {
  switch (mode) {
    case ROUNDING_MODES.BANKERS:
      // Banker's rounding: round half to even
      const floor = Math.floor(value);
      const decimal = value - floor;
      if (decimal === 0.5) {
        return floor % 2 === 0 ? floor : floor + 1;
      }
      return Math.round(value);
    case ROUNDING_MODES.FLOOR:
      return Math.floor(value);
    case ROUNDING_MODES.CEIL:
      return Math.ceil(value);
    default:
      return Math.round(value);
  }
}

/**
 * Validate line item math: qty × unitPrice ≈ lineTotal
 * Uses 3 decimal precision for calculations to handle per-pound pricing
 * Tries multiple rounding modes to find a match
 *
 * @param {Object} item - Line item to validate
 * @param {number} tolerance - Allowed difference in cents (default 2)
 * @returns {Object} Validation result with precision details
 */
function validateLineItemMath(item, tolerance = 2) {
  if (!item || !item.qty) {
    return { valid: false, reason: 'Missing required fields' };
  }

  // Get the best available price (prefer high-precision dollars)
  const unitPriceDollars = item.unitPriceDollars ||
    (item.unitPriceCents ? item.unitPriceCents / 100 : 0);

  const lineTotalCents = item.lineTotalCents || 0;

  if (!unitPriceDollars || !lineTotalCents) {
    return { valid: false, reason: 'Missing price or total' };
  }

  // Calculate with full precision, then round
  const preciseTotal = item.qty * unitPriceDollars * 100;  // In cents, unrounded

  // Try different rounding modes to match the vendor's calculation
  const roundingResults = {};
  for (const mode of Object.values(ROUNDING_MODES)) {
    const rounded = applyRounding(preciseTotal, mode);
    const diff = Math.abs(rounded - lineTotalCents);
    roundingResults[mode] = { rounded, diff };
  }

  // Find the best match
  const bestMatch = Object.entries(roundingResults)
    .sort(([, a], [, b]) => a.diff - b.diff)[0];

  const [bestMode, { rounded: bestRounded, diff: bestDiff }] = bestMatch;

  if (bestDiff <= tolerance) {
    return {
      valid: true,
      diff: bestDiff,
      computed: bestRounded,
      actual: lineTotalCents,
      roundingMode: bestMode,
      precisionDetails: {
        unitPriceDollars,
        qty: item.qty,
        preciseTotal,
        roundedTotal: bestRounded
      }
    };
  }

  // Not a direct match - try to diagnose the issue

  // 1. Check if qty might be wrong (common issue)
  if (unitPriceDollars > 0) {
    const impliedQty = lineTotalCents / (unitPriceDollars * 100);
    const roundedImpliedQty = Math.round(impliedQty);

    if (roundedImpliedQty >= 1 && roundedImpliedQty <= 9999 &&
        Math.abs(impliedQty - roundedImpliedQty) < 0.01) {
      const impliedTotal = roundedImpliedQty * unitPriceDollars * 100;
      const impliedDiff = Math.abs(Math.round(impliedTotal) - lineTotalCents);

      if (impliedDiff <= tolerance) {
        return {
          valid: false,
          reason: 'Qty appears incorrect',
          suggestedQty: roundedImpliedQty,
          diff: bestDiff,
          computed: bestRounded,
          actual: lineTotalCents,
          precisionDetails: {
            impliedQty,
            unitPriceDollars
          }
        };
      }
    }
  }

  // 2. Check for catch-weight item (qty might be weight)
  // For catch-weight, lineTotal = weight × pricePerLB
  if (item.weight && item.weight > 0) {
    const catchWeightTotal = item.weight * unitPriceDollars * 100;
    const catchWeightDiff = Math.abs(Math.round(catchWeightTotal) - lineTotalCents);
    if (catchWeightDiff <= tolerance) {
      return {
        valid: true,
        diff: catchWeightDiff,
        computed: Math.round(catchWeightTotal),
        actual: lineTotalCents,
        isCatchWeight: true,
        weight: item.weight,
        precisionDetails: {
          weightLbs: item.weight,
          pricePerLb: unitPriceDollars
        }
      };
    }
  }

  // 3. Return the best we could do
  return {
    valid: false,
    reason: `Math mismatch: ${item.qty} × $${unitPriceDollars.toFixed(3)} = $${(preciseTotal/100).toFixed(2)} ≠ $${(lineTotalCents/100).toFixed(2)}`,
    diff: bestDiff,
    computed: bestRounded,
    actual: lineTotalCents,
    roundingMode: bestMode,
    allRoundingResults: roundingResults,
    precisionDetails: {
      unitPriceDollars,
      qty: item.qty,
      preciseTotal
    }
  };
}

/**
 * Post-process and validate extracted line items
 * Attempts to fix common issues using precision math
 * @param {Array} items - Array of line items
 * @returns {Array} Validated and potentially corrected items
 */
function validateAndFixLineItems(items) {
  if (!items || !Array.isArray(items)) return [];

  let fixedCount = 0;
  let weightCorrectedCount = 0;

  const validatedItems = items.map(item => {
    const validation = validateLineItemMath(item);

    if (validation.valid) {
      const result = {
        ...item,
        mathValidated: true,
        roundingMode: validation.roundingMode
      };

      // Preserve precision details
      if (validation.precisionDetails) {
        result.unitPriceDollars = validation.precisionDetails.unitPriceDollars;
      }

      // Mark catch-weight items
      if (validation.isCatchWeight) {
        result.isCatchWeight = true;
        result.weight = validation.weight;
        weightCorrectedCount++;
      }

      // Update lineTotalCents to use precision-calculated value if different
      if (validation.computed !== item.lineTotalCents) {
        result.lineTotalCents = validation.computed;
        result.originalLineTotalCents = item.lineTotalCents;
        result.lineTotalAdjusted = true;
      }

      return result;
    }

    // Try to fix the item
    if (validation.suggestedQty) {
      fixedCount++;
      console.log(`[NUMBER CLASSIFIER] Fixing qty: ${item.qty} -> ${validation.suggestedQty} for "${item.description?.slice(0, 30)}..."`);

      // Recalculate line total with corrected qty and precision
      const unitPriceDollars = validation.precisionDetails?.unitPriceDollars ||
        (item.unitPriceCents / 100);
      const correctedTotalCents = calculateLineTotalCents(validation.suggestedQty, unitPriceDollars);

      return {
        ...item,
        qty: validation.suggestedQty,
        quantity: validation.suggestedQty,
        unitPriceDollars,
        lineTotalCents: correctedTotalCents,
        mathValidated: true,
        mathCorrected: true,
        originalQty: item.qty,
        originalLineTotalCents: item.lineTotalCents
      };
    }

    // Check for weight-based pricing (T/WT = total weight)
    // Sysco format: qty might actually be total weight in pounds
    if (item.qty > 10 && item.unitPriceCents > 0) {
      // Try interpreting qty as weight
      const asWeight = item.qty;
      const pricePerLb = item.unitPriceCents / 100;
      const weightBasedTotal = Math.round(asWeight * pricePerLb * 100);
      const weightDiff = Math.abs(weightBasedTotal - item.lineTotalCents);

      if (weightDiff <= 5) {  // Within 5 cents tolerance
        weightCorrectedCount++;
        console.log(`[NUMBER CLASSIFIER] Weight-based pricing detected: ${asWeight} LB × $${pricePerLb.toFixed(3)}/LB = $${(weightBasedTotal/100).toFixed(2)}`);

        return {
          ...item,
          qty: 1,
          quantity: 1,
          weight: asWeight,
          unitPriceDollars: pricePerLb,
          lineTotalCents: item.lineTotalCents,  // Keep original (it's correct)
          mathValidated: true,
          weightCorrected: true,
          isCatchWeight: true,
          originalQty: item.qty
        };
      }
    }

    // Return as-is but flagged
    return {
      ...item,
      mathValidated: false,
      mathError: validation.reason,
      allRoundingResults: validation.allRoundingResults
    };
  });

  if (fixedCount > 0 || weightCorrectedCount > 0) {
    console.log(`[NUMBER CLASSIFIER] Validation complete: ${fixedCount} qty fixes, ${weightCorrectedCount} weight-based items detected`);
  }

  return validatedItems;
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
  isLikelyMisclassifiedItemCode,
  applyRounding,
  ROUNDING_MODES
};
