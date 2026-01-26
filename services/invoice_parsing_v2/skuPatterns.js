/**
 * Universal SKU Pattern Matching
 * Handles various vendor SKU/UPC/item code formats
 *
 * Common formats seen across vendors:
 * - Pure digits: 1234567, 12345678 (Sysco item codes)
 * - UPC with dashes: 34730-48591-00 (standard UPC format)
 * - Alphanumeric: X59294, ABC12345 (Cintas, uniforms)
 * - With slashes: 12345/678
 * - With periods: 123.456.789
 * - Mixed: ABC-123-DEF, 12-34567-89
 */

// Individual SKU pattern components
const SKU_PATTERNS = {
  // Pure digits (5-10 digits) - most common
  DIGITS_ONLY: /\d{5,10}/,

  // UPC with dashes: 34730-48591-00, 12345-67890-12
  UPC_DASHED: /\d{4,6}-\d{4,6}-\d{2}/,

  // UPC with dashes (longer): 012345-678901-23
  UPC_DASHED_LONG: /\d{5,7}-\d{5,7}-\d{2,4}/,

  // Alphanumeric starting with letter: X59294, ABC12345
  ALPHA_PREFIX: /[A-Z]{1,3}\d{4,8}/i,

  // Alphanumeric with dashes: ABC-123-DEF, X-12345
  ALPHA_DASHED: /[A-Z]{1,4}-\d{3,8}(?:-[A-Z0-9]{1,4})?/i,

  // Digits with single dash: 12-34567, 123-4567
  DIGITS_DASHED: /\d{2,4}-\d{4,8}/,

  // Digits with periods: 123.456.789
  DIGITS_DOTTED: /\d{2,4}\.\d{2,4}(?:\.\d{2,4})?/,

  // Vendor-specific: Cintas X##### format
  CINTAS_SKU: /X\d{4,6}/i,

  // Vendor-specific: Sysco 7-digit codes
  SYSCO_ITEM: /\d{7}/,
};

/**
 * Universal SKU regex that matches most common formats
 * Use this in line item patterns to capture SKUs flexibly
 */
const UNIVERSAL_SKU_PATTERN = new RegExp(
  '(' +
  '\\d{4,6}-\\d{4,6}-\\d{2}|' +     // UPC dashed: 34730-48591-00
  '\\d{5,7}-\\d{5,7}-\\d{2,4}|' +   // UPC dashed long
  '[A-Z]{1,3}\\d{4,8}|' +            // Alpha prefix: X59294
  '[A-Z]{1,4}-\\d{3,8}(?:-[A-Z0-9]{1,4})?|' + // Alpha dashed
  '\\d{2,4}-\\d{4,8}|' +             // Digits dashed
  '\\d{5,10}' +                       // Pure digits (last - most greedy)
  ')',
  'i'
);

/**
 * Check if a string looks like a SKU/item code
 * @param {string} str - String to check
 * @returns {boolean}
 */
function looksLikeSku(str) {
  if (!str || str.length < 4 || str.length > 20) return false;

  const trimmed = str.trim();

  // Must have at least some digits
  if (!/\d{3,}/.test(trimmed)) return false;

  // Should not be a price (no $ or decimal with cents pattern at start)
  if (/^\$?\d+\.\d{2}$/.test(trimmed)) return false;

  // Should not be a date
  if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(trimmed)) return false;

  // Check against known patterns
  return (
    SKU_PATTERNS.DIGITS_ONLY.test(trimmed) ||
    SKU_PATTERNS.UPC_DASHED.test(trimmed) ||
    SKU_PATTERNS.ALPHA_PREFIX.test(trimmed) ||
    SKU_PATTERNS.ALPHA_DASHED.test(trimmed) ||
    SKU_PATTERNS.DIGITS_DASHED.test(trimmed)
  );
}

/**
 * Extract SKU from a string (finds first SKU-like pattern)
 * @param {string} str - String to search
 * @returns {string|null} - Extracted SKU or null
 */
function extractSku(str) {
  if (!str) return null;

  // Try patterns in order of specificity (most specific first)
  const patterns = [
    SKU_PATTERNS.UPC_DASHED,        // 34730-48591-00
    SKU_PATTERNS.UPC_DASHED_LONG,   // 012345-678901-23
    SKU_PATTERNS.CINTAS_SKU,        // X59294
    SKU_PATTERNS.ALPHA_DASHED,      // ABC-123-DEF
    SKU_PATTERNS.ALPHA_PREFIX,      // ABC12345
    SKU_PATTERNS.DIGITS_DASHED,     // 12-34567
    SKU_PATTERNS.DIGITS_ONLY,       // 1234567
  ];

  for (const pattern of patterns) {
    const match = str.match(pattern);
    if (match) {
      // Validate it's not a price or date
      const candidate = match[0];
      if (!isLikelyPrice(candidate) && !isLikelyDate(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

/**
 * Extract all SKUs from a string
 * @param {string} str - String to search
 * @returns {string[]} - Array of extracted SKUs
 */
function extractAllSkus(str) {
  if (!str) return [];

  const skus = [];
  const seen = new Set();

  // Use global matching
  const globalPattern = new RegExp(UNIVERSAL_SKU_PATTERN.source, 'gi');
  let match;

  while ((match = globalPattern.exec(str)) !== null) {
    const sku = match[1];
    if (!seen.has(sku) && !isLikelyPrice(sku) && !isLikelyDate(sku)) {
      seen.add(sku);
      skus.push(sku);
    }
  }

  return skus;
}

/**
 * Check if string looks like a price
 */
function isLikelyPrice(str) {
  return /^\$?\d{1,6}\.\d{2}$/.test(str.trim());
}

/**
 * Check if string looks like a date
 */
function isLikelyDate(str) {
  return /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(str.trim());
}

/**
 * Build a regex pattern for line items with flexible SKU matching
 * This creates patterns that work across vendors
 *
 * @param {Object} options - Pattern options
 * @param {boolean} options.requireCategory - Require C/F/P/D prefix
 * @param {boolean} options.requireTwoPrices - Require unit price + extended price
 * @param {number} options.minSkuDigits - Minimum digits in SKU
 * @returns {RegExp}
 */
function buildLineItemPattern(options = {}) {
  const {
    requireCategory = false,
    requireTwoPrices = true,
    minSkuDigits = 5
  } = options;

  const categoryPart = requireCategory ? '([CFPD])\\s+' : '';
  const qtyPart = '(\\d+)\\s*';
  const unitPart = '([A-Z]{1,4})?\\s*';
  const descPart = '(.+?)\\s+';

  // Flexible SKU pattern (matches dashed, alphanumeric, or pure digits)
  const skuPart = `(\\d{4,6}-\\d{4,6}-\\d{2}|[A-Z]\\d{${minSkuDigits},8}|\\d{${minSkuDigits},10})`;

  const pricePart = requireTwoPrices
    ? '\\s+([\\d,]+\\.?\\d*)\\s+([\\d,]+\\.?\\d*)\\s*$'
    : '\\s+([\\d,]+\\.?\\d*)\\s*$';

  return new RegExp(
    '^' + categoryPart + qtyPart + unitPart + descPart + skuPart + pricePart,
    'i'
  );
}

/**
 * Normalize SKU format for comparison/storage
 * Removes dashes, converts to uppercase
 */
function normalizeSku(sku) {
  if (!sku) return null;
  return sku.toString().toUpperCase().replace(/[-\.\/]/g, '');
}

/**
 * Check if two SKUs are equivalent (accounting for format differences)
 */
function skusMatch(sku1, sku2) {
  if (!sku1 || !sku2) return false;
  return normalizeSku(sku1) === normalizeSku(sku2);
}

module.exports = {
  SKU_PATTERNS,
  UNIVERSAL_SKU_PATTERN,
  looksLikeSku,
  extractSku,
  extractAllSkus,
  buildLineItemPattern,
  normalizeSku,
  skusMatch,
  isLikelyPrice,
  isLikelyDate
};
