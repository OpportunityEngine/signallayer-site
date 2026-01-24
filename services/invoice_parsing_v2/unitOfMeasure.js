/**
 * Invoice Parsing V2 - Unit of Measure (UOM) Detection
 *
 * Handles industry-specific pricing patterns where items are sold by:
 * - Weight: pounds (lb/#), ounces (oz), kilograms (kg), grams (g)
 * - Volume: gallons (gal), liters (L), quarts (qt), pints (pt)
 * - Count: each (ea), dozen (dz), case (cs), pack (pk), box (bx)
 * - Specialized: per serving, per portion, per head
 *
 * Common industries handled:
 * - Food service (Sysco, US Foods, etc.)
 * - Restaurant supply
 * - Wholesale distribution
 * - Uniform/linen services
 */

// ============ UNIT PATTERNS ============

/**
 * Weight units - commonly used for meat, seafood, produce, cheese
 */
const WEIGHT_UNITS = {
  lb: { pattern: /\b(\d+\.?\d*)\s*(?:LB|LBS|#|POUND|POUNDS)\b/gi, name: 'pound', factor: 1 },
  oz: { pattern: /\b(\d+\.?\d*)\s*(?:OZ|OUNCE|OUNCES)\b/gi, name: 'ounce', factor: 0.0625 }, // to lbs
  kg: { pattern: /\b(\d+\.?\d*)\s*(?:KG|KILO|KILOGRAM|KILOGRAMS)\b/gi, name: 'kilogram', factor: 2.205 }, // to lbs
  g: { pattern: /\b(\d+\.?\d*)\s*(?:G|GM|GRAM|GRAMS)\b/gi, name: 'gram', factor: 0.002205 }, // to lbs
};

/**
 * Volume units - commonly used for beverages, dairy, liquids
 */
const VOLUME_UNITS = {
  gal: { pattern: /\b(\d+\.?\d*)\s*(?:GAL|GALLON|GALLONS)\b/gi, name: 'gallon', factor: 1 },
  qt: { pattern: /\b(\d+\.?\d*)\s*(?:QT|QUART|QUARTS)\b/gi, name: 'quart', factor: 0.25 }, // to gal
  pt: { pattern: /\b(\d+\.?\d*)\s*(?:PT|PINT|PINTS)\b/gi, name: 'pint', factor: 0.125 }, // to gal
  L: { pattern: /\b(\d+\.?\d*)\s*(?:L|LTR|LITER|LITERS|LITRE|LITRES)\b/gi, name: 'liter', factor: 0.264 }, // to gal
  ml: { pattern: /\b(\d+\.?\d*)\s*(?:ML|MILLILITER|MILLILITERS)\b/gi, name: 'milliliter', factor: 0.000264 },
  fl_oz: { pattern: /\b(\d+\.?\d*)\s*(?:FL\s*OZ|FLUID\s*OZ|FLOZ)\b/gi, name: 'fluid_ounce', factor: 0.0078125 },
};

/**
 * Count units - commonly used for packaged goods
 */
const COUNT_UNITS = {
  ea: { pattern: /\b(\d+\.?\d*)\s*(?:EA|EACH)\b/gi, name: 'each', factor: 1 },
  cs: { pattern: /\b(\d+\.?\d*)\s*(?:CS|CASE|CASES)\b/gi, name: 'case', factor: 1 },
  pk: { pattern: /\b(\d+\.?\d*)\s*(?:PK|PACK|PACKS|PKG|PACKAGE)\b/gi, name: 'pack', factor: 1 },
  bx: { pattern: /\b(\d+\.?\d*)\s*(?:BX|BOX|BOXES)\b/gi, name: 'box', factor: 1 },
  ct: { pattern: /\b(\d+\.?\d*)\s*(?:CT|COUNT)\b/gi, name: 'count', factor: 1 },
  dz: { pattern: /\b(\d+\.?\d*)\s*(?:DZ|DOZ|DOZEN)\b/gi, name: 'dozen', factor: 12 }, // to each
  bg: { pattern: /\b(\d+\.?\d*)\s*(?:BG|BAG|BAGS)\b/gi, name: 'bag', factor: 1 },
  btl: { pattern: /\b(\d+\.?\d*)\s*(?:BTL|BOTTLE|BOTTLES)\b/gi, name: 'bottle', factor: 1 },
  can: { pattern: /\b(\d+\.?\d*)\s*(?:CAN|CANS)\b/gi, name: 'can', factor: 1 },
  jar: { pattern: /\b(\d+\.?\d*)\s*(?:JAR|JARS)\b/gi, name: 'jar', factor: 1 },
  tub: { pattern: /\b(\d+\.?\d*)\s*(?:TUB|TUBS)\b/gi, name: 'tub', factor: 1 },
  sleeve: { pattern: /\b(\d+\.?\d*)\s*(?:SLV|SLEEVE|SLEEVES)\b/gi, name: 'sleeve', factor: 1 },
  roll: { pattern: /\b(\d+\.?\d*)\s*(?:ROLL|ROLLS|RL)\b/gi, name: 'roll', factor: 1 },
};

/**
 * Price-per-unit patterns - indicates how the item is priced
 */
const PRICE_PER_PATTERNS = [
  // Weight-based pricing
  { pattern: /\$?([\d,]+\.?\d*)\s*\/\s*(?:LB|POUND|#)/gi, type: 'weight', unit: 'lb', name: 'per pound' },
  { pattern: /\$?([\d,]+\.?\d*)\s*\/\s*(?:OZ|OUNCE)/gi, type: 'weight', unit: 'oz', name: 'per ounce' },
  { pattern: /\$?([\d,]+\.?\d*)\s*\/\s*(?:KG|KILO)/gi, type: 'weight', unit: 'kg', name: 'per kilogram' },
  { pattern: /PER\s+(?:LB|POUND|#)/gi, type: 'weight', unit: 'lb', name: 'per pound' },
  { pattern: /PRICE\s*\/\s*(?:LB|POUND)/gi, type: 'weight', unit: 'lb', name: 'per pound' },

  // Volume-based pricing
  { pattern: /\$?([\d,]+\.?\d*)\s*\/\s*(?:GAL|GALLON)/gi, type: 'volume', unit: 'gal', name: 'per gallon' },
  { pattern: /\$?([\d,]+\.?\d*)\s*\/\s*(?:L|LITER|LITRE)/gi, type: 'volume', unit: 'L', name: 'per liter' },
  { pattern: /PER\s+(?:GAL|GALLON)/gi, type: 'volume', unit: 'gal', name: 'per gallon' },

  // Count-based pricing
  { pattern: /\$?([\d,]+\.?\d*)\s*\/\s*(?:EA|EACH)/gi, type: 'count', unit: 'ea', name: 'per each' },
  { pattern: /\$?([\d,]+\.?\d*)\s*\/\s*(?:CS|CASE)/gi, type: 'count', unit: 'cs', name: 'per case' },
  { pattern: /\$?([\d,]+\.?\d*)\s*\/\s*(?:DZ|DOZEN)/gi, type: 'count', unit: 'dz', name: 'per dozen' },
  { pattern: /PER\s+(?:EA|EACH|UNIT)/gi, type: 'count', unit: 'ea', name: 'per each' },
  { pattern: /PER\s+(?:CS|CASE)/gi, type: 'count', unit: 'cs', name: 'per case' },
];

/**
 * Continuation line patterns - lines that follow an item with additional quantity info
 * These are critical for Sysco and similar vendors
 */
const CONTINUATION_PATTERNS = [
  // Sysco T/WT= pattern: "84.000 T/WT= 84.000"
  {
    pattern: /^\s*([\d.]+)\s*T\/WT=\s*([\d.]+)/i,
    type: 'weight',
    unit: 'lb',
    name: 'total_weight',
    extract: (match) => ({ quantity: parseFloat(match[1]), verifyQty: parseFloat(match[2]) })
  },
  // Weight only: "84.000" or "84.00 LBS"
  {
    pattern: /^\s*([\d.]+)\s*(?:LBS?|#|POUNDS?)?\s*$/i,
    type: 'weight',
    unit: 'lb',
    name: 'weight_line',
    extract: (match) => ({ quantity: parseFloat(match[1]) })
  },
  // Net weight: "NET WT: 84.00"
  {
    pattern: /NET\s*(?:WT|WEIGHT)[:\s]*([\d.]+)/i,
    type: 'weight',
    unit: 'lb',
    name: 'net_weight',
    extract: (match) => ({ quantity: parseFloat(match[1]) })
  },
  // Gross weight: "GROSS WT: 90.00"
  {
    pattern: /GROSS\s*(?:WT|WEIGHT)[:\s]*([\d.]+)/i,
    type: 'weight',
    unit: 'lb',
    name: 'gross_weight',
    extract: (match) => ({ quantity: parseFloat(match[1]) })
  },
  // AVG pattern: "AVG 84.00"
  {
    pattern: /AVG\.?\s*([\d.]+)/i,
    type: 'weight',
    unit: 'lb',
    name: 'average_weight',
    extract: (match) => ({ quantity: parseFloat(match[1]) })
  },
  // Actual count: "ACTUAL: 24"
  {
    pattern: /ACTUAL[:\s]*([\d.]+)/i,
    type: 'count',
    unit: 'ea',
    name: 'actual_count',
    extract: (match) => ({ quantity: parseFloat(match[1]) })
  },
];

/**
 * Product category hints - help determine expected UOM based on product type
 */
const PRODUCT_CATEGORY_HINTS = {
  // Meat products - typically sold by weight
  meat: {
    patterns: [
      /\b(?:BEEF|STEAK|PORK|CHICKEN|TURKEY|LAMB|VEAL|BACON|HAM|SAUSAGE|BRISKET|RIB|TENDERLOIN|SIRLOIN|CHUCK|GROUND|PATTY|BURGER)\b/i,
      /\b(?:MEAT|POULTRY|DELI|PRIMAL|SUBPRIMAL|LOIN|ROUND|FLANK)\b/i,
    ],
    expectedUOM: 'weight',
    defaultUnit: 'lb',
  },
  // Seafood - typically sold by weight
  seafood: {
    patterns: [
      /\b(?:FISH|SALMON|TUNA|COD|TILAPIA|SHRIMP|LOBSTER|CRAB|OYSTER|CLAM|MUSSEL|SCALLOP|CALAMARI|SQUID)\b/i,
      /\b(?:SEAFOOD|SHELLFISH|FILLET|FILET|MAHI|HALIBUT|SNAPPER|TROUT|ROCKFISH)\b/i,
    ],
    expectedUOM: 'weight',
    defaultUnit: 'lb',
  },
  // Produce - can be weight or count
  produce: {
    patterns: [
      /\b(?:LETTUCE|TOMATO|ONION|POTATO|CARROT|CELERY|PEPPER|CUCUMBER|BROCCOLI|SPINACH|KALE)\b/i,
      /\b(?:APPLE|ORANGE|BANANA|LEMON|LIME|AVOCADO|BERRY|STRAWBERRY|BLUEBERRY|GRAPE)\b/i,
      /\b(?:PRODUCE|VEGETABLE|FRUIT|FRESH|ORGANIC)\b/i,
    ],
    expectedUOM: 'weight',
    defaultUnit: 'lb',
  },
  // Dairy - various units
  dairy: {
    patterns: [
      /\b(?:MILK|CREAM|BUTTER|CHEESE|YOGURT|SOUR\s*CREAM|COTTAGE|CHEDDAR|MOZZARELLA|PARMESAN)\b/i,
      /\b(?:DAIRY|EGG|EGGS)\b/i,
    ],
    expectedUOM: 'mixed',
    defaultUnit: 'lb',
  },
  // Beverages - typically by volume or case
  beverages: {
    patterns: [
      /\b(?:SODA|COLA|JUICE|WATER|TEA|COFFEE|BEER|WINE|LIQUOR|SPIRIT|BEVERAGE|DRINK)\b/i,
      /\b(?:SYRUP|CONCENTRATE|MIX)\b/i,
    ],
    expectedUOM: 'volume',
    defaultUnit: 'gal',
  },
  // Dry goods - typically by case or count
  dry_goods: {
    patterns: [
      /\b(?:FLOUR|SUGAR|RICE|PASTA|NOODLE|BREAD|ROLL|BUN|CRACKER|CHIP|CEREAL|OATS)\b/i,
      /\b(?:SPICE|SEASONING|SALT|PEPPER|SAUCE|CONDIMENT|KETCHUP|MUSTARD|MAYO)\b/i,
    ],
    expectedUOM: 'count',
    defaultUnit: 'cs',
  },
  // Frozen goods - typically by case or count
  frozen: {
    patterns: [
      /\b(?:FROZEN|IQF|FLASH\s*FROZEN|FRZ)\b/i,
    ],
    expectedUOM: 'count',
    defaultUnit: 'cs',
  },
};

// ============ DETECTION FUNCTIONS ============

/**
 * Detect unit of measure from item description
 * @param {string} description - Item description text
 * @returns {Object} Detected UOM info
 */
function detectUOM(description) {
  if (!description) return { detected: false };

  const result = {
    detected: false,
    units: [],
    pricingType: null,
    expectedCategory: null,
  };

  const upperDesc = description.toUpperCase();

  // Check for explicit size/weight in description (e.g., "5LB", "10OZ", "1GAL")
  // Weight units
  for (const [key, config] of Object.entries(WEIGHT_UNITS)) {
    const match = upperDesc.match(config.pattern);
    if (match) {
      result.units.push({
        type: 'weight',
        unit: key,
        name: config.name,
        value: parseFloat(match[1]),
        raw: match[0],
      });
      result.detected = true;
    }
  }

  // Volume units
  for (const [key, config] of Object.entries(VOLUME_UNITS)) {
    const match = upperDesc.match(config.pattern);
    if (match) {
      result.units.push({
        type: 'volume',
        unit: key,
        name: config.name,
        value: parseFloat(match[1]),
        raw: match[0],
      });
      result.detected = true;
    }
  }

  // Count units
  for (const [key, config] of Object.entries(COUNT_UNITS)) {
    const match = upperDesc.match(config.pattern);
    if (match) {
      result.units.push({
        type: 'count',
        unit: key,
        name: config.name,
        value: parseFloat(match[1]),
        raw: match[0],
      });
      result.detected = true;
    }
  }

  // Check for price-per patterns
  for (const pricePattern of PRICE_PER_PATTERNS) {
    if (pricePattern.pattern.test(upperDesc)) {
      result.pricingType = pricePattern;
      result.detected = true;
      break;
    }
  }

  // Detect product category
  for (const [category, config] of Object.entries(PRODUCT_CATEGORY_HINTS)) {
    for (const pattern of config.patterns) {
      if (pattern.test(upperDesc)) {
        result.expectedCategory = {
          category,
          expectedUOM: config.expectedUOM,
          defaultUnit: config.defaultUnit,
        };
        result.detected = true;
        break;
      }
    }
    if (result.expectedCategory) break;
  }

  return result;
}

/**
 * Check if a line is a continuation line with quantity info
 * @param {string} line - Line text to check
 * @returns {Object|null} Continuation info or null
 */
function detectContinuationLine(line) {
  if (!line || line.trim().length === 0) return null;

  const trimmed = line.trim();

  // Skip lines that are clearly not continuation lines
  if (trimmed.length > 50) return null;  // Too long to be just quantity
  if (/^[A-Z]{2,}\s+\d/.test(trimmed)) return null;  // Looks like start of new item
  if (/\$\d/.test(trimmed)) return null;  // Has prices, not continuation

  for (const contPattern of CONTINUATION_PATTERNS) {
    const match = trimmed.match(contPattern.pattern);
    if (match) {
      const extracted = contPattern.extract(match);
      return {
        type: contPattern.type,
        unit: contPattern.unit,
        name: contPattern.name,
        ...extracted,
        raw: trimmed,
      };
    }
  }

  return null;
}

/**
 * Extract package size from description (e.g., "10LB BAG", "5GAL BUCKET")
 * @param {string} description - Item description
 * @returns {Object|null} Package size info
 */
function extractPackageSize(description) {
  if (!description) return null;

  const upperDesc = description.toUpperCase();

  // Common package size patterns
  const packagePatterns = [
    // Weight-based packages: "10LB", "5#", "25 LB BAG"
    { pattern: /(\d+\.?\d*)\s*(?:LB|#|POUND)S?\s*(?:BAG|BOX|CASE|PKG)?/gi, type: 'weight', unit: 'lb' },
    { pattern: /(\d+\.?\d*)\s*(?:OZ|OUNCE)S?\s*(?:PKG|PACK|CAN|JAR)?/gi, type: 'weight', unit: 'oz' },
    { pattern: /(\d+\.?\d*)\s*(?:KG|KILO)S?\s*(?:BAG|BOX)?/gi, type: 'weight', unit: 'kg' },

    // Volume-based packages: "5GAL", "1L", "2QT"
    { pattern: /(\d+\.?\d*)\s*(?:GAL|GALLON)S?\s*(?:JUG|BUCKET|PAIL)?/gi, type: 'volume', unit: 'gal' },
    { pattern: /(\d+\.?\d*)\s*(?:L|LITER|LITRE)S?\s*(?:BTL|BOTTLE)?/gi, type: 'volume', unit: 'L' },
    { pattern: /(\d+\.?\d*)\s*(?:QT|QUART)S?/gi, type: 'volume', unit: 'qt' },

    // Count-based packages: "12CT", "24PK", "1DZ"
    { pattern: /(\d+)\s*(?:CT|COUNT)\s*(?:PKG|PACK|BOX|CASE)?/gi, type: 'count', unit: 'ct' },
    { pattern: /(\d+)\s*(?:PK|PACK)S?/gi, type: 'count', unit: 'pk' },
    { pattern: /(\d+)\s*(?:DZ|DOZEN)/gi, type: 'count', unit: 'dz' },
  ];

  for (const pkg of packagePatterns) {
    const match = upperDesc.match(pkg.pattern);
    if (match) {
      return {
        type: pkg.type,
        unit: pkg.unit,
        size: parseFloat(match[1]),
        raw: match[0],
      };
    }
  }

  return null;
}

/**
 * Calculate expected line total based on UOM detection
 * @param {Object} item - Parsed line item
 * @param {Object} uomInfo - UOM detection result
 * @param {Object} continuation - Continuation line info (if any)
 * @returns {Object} Calculated values with confidence
 */
function calculateWithUOM(item, uomInfo, continuation = null) {
  const result = {
    originalQty: item.qty,
    originalUnitPrice: item.unitPriceCents,
    originalLineTotal: item.lineTotalCents,
    adjustedQty: item.qty,
    adjustedUnitPrice: item.unitPriceCents,
    confidence: 'low',
    method: 'none',
    notes: [],
  };

  // If we have a continuation line with quantity, use it
  if (continuation && continuation.quantity > 0) {
    result.adjustedQty = continuation.quantity;
    result.method = `continuation_${continuation.name}`;

    // Recalculate unit price based on new quantity
    if (item.lineTotalCents > 0 && continuation.quantity > 0) {
      result.adjustedUnitPrice = Math.round(item.lineTotalCents / continuation.quantity);
    }

    // Verify math
    const calculatedTotal = result.adjustedQty * result.adjustedUnitPrice;
    const diff = Math.abs(calculatedTotal - item.lineTotalCents);
    const tolerance = Math.max(10, item.lineTotalCents * 0.01);  // 1% or 10 cents

    if (diff <= tolerance) {
      result.confidence = 'high';
      result.notes.push(`Math verified: ${result.adjustedQty} × $${(result.adjustedUnitPrice/100).toFixed(2)} = $${(item.lineTotalCents/100).toFixed(2)}`);
    } else {
      result.confidence = 'medium';
      result.notes.push(`Math approximate: ${result.adjustedQty} × $${(result.adjustedUnitPrice/100).toFixed(2)} = $${(calculatedTotal/100).toFixed(2)} (expected $${(item.lineTotalCents/100).toFixed(2)})`);
    }

    return result;
  }

  // Try to infer from UOM info
  if (uomInfo && uomInfo.detected) {
    // If we have package size, use it
    const packageSize = extractPackageSize(item.description);
    if (packageSize) {
      result.notes.push(`Package size detected: ${packageSize.size} ${packageSize.unit}`);
    }

    // If pricing type is detected, note it
    if (uomInfo.pricingType) {
      result.notes.push(`Pricing type: ${uomInfo.pricingType.name}`);
    }

    // If category suggests weight-based and we have weight in description
    if (uomInfo.expectedCategory?.expectedUOM === 'weight') {
      const weightUnits = uomInfo.units.filter(u => u.type === 'weight');
      if (weightUnits.length > 0) {
        result.notes.push(`Weight-priced category: ${uomInfo.expectedCategory.category}`);
      }
    }
  }

  // Fallback: verify original math
  const originalCalc = item.qty * item.unitPriceCents;
  const originalDiff = Math.abs(originalCalc - item.lineTotalCents);
  const originalTolerance = Math.max(10, item.lineTotalCents * 0.01);

  if (originalDiff <= originalTolerance) {
    result.confidence = 'high';
    result.method = 'original_verified';
  } else {
    result.confidence = 'low';
    result.method = 'math_mismatch';
    result.notes.push(`Math mismatch: ${item.qty} × $${(item.unitPriceCents/100).toFixed(2)} = $${(originalCalc/100).toFixed(2)}, expected $${(item.lineTotalCents/100).toFixed(2)}`);
  }

  return result;
}

/**
 * Parse a Sysco-style size notation from description
 * Examples: "323#AVGCAB" means 323 pounds average cab
 *           "10LB LAMB" means 10 pound lamb
 * @param {string} description - Item description
 * @returns {Object|null} Size info
 */
function parseSyscoSizeNotation(description) {
  if (!description) return null;

  // Pattern: number followed by # or LB at start of description
  // Examples: "323#AVGCAB", "10LB", "5# BAG"
  const match = description.match(/^(\d+\.?\d*)\s*(?:#|LB|OZ)\s*/i);
  if (match) {
    return {
      size: parseFloat(match[1]),
      unit: description.includes('OZ') ? 'oz' : 'lb',
      type: 'weight',
      raw: match[0],
    };
  }

  // Pattern: number+size in middle of description
  // Example: "BEEF ROUND 323# TOP"
  const midMatch = description.match(/\s(\d+\.?\d*)\s*(?:#|LB|OZ)\s/i);
  if (midMatch) {
    return {
      size: parseFloat(midMatch[1]),
      unit: description.includes('OZ') ? 'oz' : 'lb',
      type: 'weight',
      raw: midMatch[0],
    };
  }

  return null;
}

/**
 * Apply UOM detection and correction to a line item
 * @param {Object} item - Line item to process
 * @param {string} nextLine - Next line (for continuation detection)
 * @returns {Object} Enhanced item with UOM info
 */
function enhanceLineItemWithUOM(item, nextLine = null) {
  const enhanced = { ...item };

  // Detect UOM from description
  const uomInfo = detectUOM(item.description);
  enhanced.uomInfo = uomInfo;

  // Check for continuation line
  let continuation = null;
  if (nextLine) {
    continuation = detectContinuationLine(nextLine);
  }
  enhanced.continuation = continuation;

  // Calculate with UOM
  const calculation = calculateWithUOM(item, uomInfo, continuation);

  // Apply adjustments if confidence is high enough
  if (calculation.confidence !== 'low' && calculation.method !== 'original_verified') {
    enhanced.qty = calculation.adjustedQty;
    enhanced.unitPriceCents = calculation.adjustedUnitPrice;
    enhanced.uomCorrected = true;
    enhanced.originalValues = {
      qty: calculation.originalQty,
      unitPriceCents: calculation.originalUnitPrice,
    };
  }

  enhanced.uomCalculation = calculation;

  // Parse Sysco-specific size notation
  const syscoSize = parseSyscoSizeNotation(item.description);
  if (syscoSize) {
    enhanced.packageSize = syscoSize;
  }

  return enhanced;
}

// ============ EXPORTS ============

module.exports = {
  // Main functions
  detectUOM,
  detectContinuationLine,
  extractPackageSize,
  calculateWithUOM,
  enhanceLineItemWithUOM,
  parseSyscoSizeNotation,

  // Constants for external use
  WEIGHT_UNITS,
  VOLUME_UNITS,
  COUNT_UNITS,
  PRICE_PER_PATTERNS,
  CONTINUATION_PATTERNS,
  PRODUCT_CATEGORY_HINTS,
};
