/**
 * SKU Normalizer Service
 * Provides canonical SKU normalization and unit of measure conversion
 *
 * This enables cross-vendor product matching by:
 * 1. Normalizing SKU formats (removing dashes, dots, spaces)
 * 2. Creating vendor-prefixed canonical SKUs
 * 3. Mapping vendor SKUs to canonical products
 * 4. Converting between units of measure
 */

const {
  detectUOM,
  enhanceLineItemWithUOM,
  WEIGHT_UNITS,
  VOLUME_UNITS,
  COUNT_UNITS,
  PRODUCT_CATEGORY_HINTS
} = require('./invoice_parsing_v2/unitOfMeasure');

// Database reference (will be set by init)
let db = null;

// Standard UOM conversions
const UOM_CONVERSIONS = {
  // Weight conversions (to lbs)
  lb: 1,
  lbs: 1,
  oz: 0.0625,
  kg: 2.20462,
  g: 0.00220462,

  // Volume conversions (to gallons)
  gal: 1,
  gallon: 1,
  qt: 0.25,
  quart: 0.25,
  pt: 0.125,
  pint: 0.125,
  oz_fluid: 0.0078125,
  liter: 0.264172,
  ml: 0.000264172,

  // Count conversions (to each)
  each: 1,
  ea: 1,
  pc: 1,
  piece: 1,
  unit: 1,
  doz: 12,
  dozen: 12,
  case: null, // Variable - depends on case size
  cs: null,
  pack: null, // Variable
  pk: null
};

/**
 * Initialize the SKU normalizer with database connection
 * @param {Object} database - Database connection from database.js
 */
function init(database) {
  db = database;
}

/**
 * Normalize a SKU string for consistent matching
 * @param {string} sku - Raw SKU from invoice
 * @param {string} vendor - Vendor name
 * @returns {string} Normalized SKU
 */
function normalizeSku(sku, vendor = '') {
  if (!sku) return '';

  // Remove common separators and normalize
  let normalized = String(sku)
    .toUpperCase()
    .replace(/[-\.\s\/\\]/g, '') // Remove dashes, dots, spaces, slashes
    .replace(/^0+/, '') // Remove leading zeros
    .trim();

  // Add vendor prefix for disambiguation
  if (vendor) {
    const vendorPrefix = vendor.toUpperCase().replace(/[^A-Z]/g, '').substring(0, 6);
    return `${vendorPrefix}_${normalized}`;
  }

  return normalized;
}

/**
 * Extract base SKU without vendor prefix
 * @param {string} canonicalSku - Canonical SKU with vendor prefix
 * @returns {string} Base SKU
 */
function extractBaseSku(canonicalSku) {
  if (!canonicalSku) return '';
  const parts = canonicalSku.split('_');
  return parts.length > 1 ? parts.slice(1).join('_') : canonicalSku;
}

/**
 * Find or create a canonical SKU mapping
 * @param {number} userId - User ID
 * @param {string} vendorSku - Vendor's SKU
 * @param {string} vendorName - Vendor name
 * @param {Object} productInfo - Additional product info
 * @returns {Object} SKU mapping
 */
function findOrCreateMapping(userId, vendorSku, vendorName, productInfo = {}) {
  if (!db) {
    throw new Error('SKU normalizer not initialized. Call init() first.');
  }

  // Check for existing mapping
  const existing = db.prepare(`
    SELECT * FROM sku_mappings
    WHERE user_id = ? AND vendor_name = ? AND vendor_sku = ?
  `).get(userId, vendorName, vendorSku);

  if (existing) {
    // Update match count
    db.prepare(`
      UPDATE sku_mappings
      SET times_matched = times_matched + 1,
          last_matched_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(existing.id);

    return existing;
  }

  // Create new mapping
  const canonicalSku = normalizeSku(vendorSku, vendorName);

  const stmt = db.prepare(`
    INSERT INTO sku_mappings (user_id, canonical_sku, vendor_name, vendor_sku, product_name, product_category, standard_uom, case_size, times_matched)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);

  const result = stmt.run(
    userId,
    canonicalSku,
    vendorName,
    vendorSku,
    productInfo.name || null,
    productInfo.category || null,
    productInfo.uom || null,
    productInfo.caseSize || null
  );

  return {
    id: result.lastInsertRowid,
    user_id: userId,
    canonical_sku: canonicalSku,
    vendor_name: vendorName,
    vendor_sku: vendorSku,
    product_name: productInfo.name,
    product_category: productInfo.category,
    standard_uom: productInfo.uom,
    case_size: productInfo.caseSize,
    times_matched: 1
  };
}

/**
 * Get canonical SKU for a vendor SKU
 * @param {number} userId - User ID
 * @param {string} vendorSku - Vendor's SKU
 * @param {string} vendorName - Vendor name
 * @returns {string|null} Canonical SKU or null
 */
function getCanonicalSku(userId, vendorSku, vendorName) {
  if (!db) {
    throw new Error('SKU normalizer not initialized. Call init() first.');
  }

  const mapping = db.prepare(`
    SELECT canonical_sku FROM sku_mappings
    WHERE user_id = ? AND vendor_name = ? AND vendor_sku = ?
  `).get(userId, vendorName, vendorSku);

  return mapping?.canonical_sku || null;
}

/**
 * Find similar products across vendors by name or SKU pattern
 * @param {number} userId - User ID
 * @param {string} searchTerm - Product name or SKU to search
 * @param {Object} options - Search options
 * @returns {Array} Matching SKU mappings
 */
function findSimilarProducts(userId, searchTerm, options = {}) {
  if (!db) {
    throw new Error('SKU normalizer not initialized. Call init() first.');
  }

  const limit = options.limit || 20;
  const vendorFilter = options.vendor;

  let sql = `
    SELECT * FROM sku_mappings
    WHERE user_id = ?
    AND (
      canonical_sku LIKE ?
      OR vendor_sku LIKE ?
      OR product_name LIKE ?
    )
  `;

  const params = [userId, `%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`];

  if (vendorFilter) {
    sql += ' AND vendor_name = ?';
    params.push(vendorFilter);
  }

  sql += ' ORDER BY times_matched DESC LIMIT ?';
  params.push(limit);

  return db.prepare(sql).all(...params);
}

/**
 * Convert quantity from one UOM to another
 * @param {number} quantity - Original quantity
 * @param {string} fromUom - Source unit of measure
 * @param {string} toUom - Target unit of measure
 * @param {Object} options - Conversion options (caseSize, etc.)
 * @returns {Object} Converted quantity and info
 */
function convertUnits(quantity, fromUom, toUom, options = {}) {
  if (!fromUom || !toUom) {
    return { quantity, converted: false, error: 'Missing UOM' };
  }

  const from = fromUom.toLowerCase().trim();
  const to = toUom.toLowerCase().trim();

  // Same unit - no conversion needed
  if (from === to) {
    return { quantity, converted: false, fromUom: from, toUom: to };
  }

  // Handle case/pack conversions
  if ((from === 'case' || from === 'cs') && options.caseSize) {
    if (to === 'each' || to === 'ea') {
      return {
        quantity: quantity * options.caseSize,
        converted: true,
        fromUom: from,
        toUom: to,
        conversionFactor: options.caseSize
      };
    }
  }

  if ((to === 'case' || to === 'cs') && options.caseSize) {
    if (from === 'each' || from === 'ea') {
      return {
        quantity: quantity / options.caseSize,
        converted: true,
        fromUom: from,
        toUom: to,
        conversionFactor: 1 / options.caseSize
      };
    }
  }

  // Standard conversions
  const fromFactor = UOM_CONVERSIONS[from];
  const toFactor = UOM_CONVERSIONS[to];

  if (fromFactor && toFactor) {
    const converted = quantity * (fromFactor / toFactor);
    return {
      quantity: converted,
      converted: true,
      fromUom: from,
      toUom: to,
      conversionFactor: fromFactor / toFactor
    };
  }

  return { quantity, converted: false, error: 'No conversion available' };
}

/**
 * Enhance line items with normalized SKU and UOM info
 * @param {Array} lineItems - Line items from parser
 * @param {number} userId - User ID
 * @param {string} vendorName - Vendor name
 * @returns {Array} Enhanced line items
 */
function enhanceLineItems(lineItems, userId, vendorName) {
  if (!lineItems || !Array.isArray(lineItems)) return [];

  return lineItems.map(item => {
    const enhanced = { ...item };

    // Normalize SKU if present
    if (item.sku) {
      enhanced.skuRaw = item.sku;
      enhanced.skuNormalized = normalizeSku(item.sku, vendorName);

      // Try to find/create mapping
      if (db && userId) {
        try {
          const mapping = findOrCreateMapping(userId, item.sku, vendorName, {
            name: item.description,
            category: item.category,
            uom: item.detectedUnits?.uom
          });
          enhanced.canonicalSku = mapping.canonical_sku;
          enhanced.skuMappingId = mapping.id;
        } catch (err) {
          // Don't fail if mapping fails
          console.error('[SKU NORMALIZER] Mapping error:', err.message);
        }
      }
    }

    // Enhance with UOM detection
    if (item.description) {
      const uomInfo = detectUOM(item.description);
      if (uomInfo) {
        enhanced.detectedUom = uomInfo.uom;
        enhanced.detectedQuantity = uomInfo.quantity;
        enhanced.uomConfidence = uomInfo.confidence;
      }
    }

    return enhanced;
  });
}

/**
 * Get SKU mapping statistics for a user
 * @param {number} userId - User ID
 * @returns {Object} Statistics
 */
function getMappingStats(userId) {
  if (!db) {
    throw new Error('SKU normalizer not initialized. Call init() first.');
  }

  const totalMappings = db.prepare(`
    SELECT COUNT(*) as count FROM sku_mappings WHERE user_id = ?
  `).get(userId);

  const byVendor = db.prepare(`
    SELECT vendor_name, COUNT(*) as count
    FROM sku_mappings
    WHERE user_id = ?
    GROUP BY vendor_name
    ORDER BY count DESC
  `).all(userId);

  const topProducts = db.prepare(`
    SELECT canonical_sku, product_name, vendor_name, times_matched
    FROM sku_mappings
    WHERE user_id = ?
    ORDER BY times_matched DESC
    LIMIT 10
  `).all(userId);

  return {
    total: totalMappings.count,
    byVendor,
    topProducts
  };
}

/**
 * Update a SKU mapping with additional info
 * @param {number} mappingId - Mapping ID
 * @param {Object} updates - Fields to update
 */
function updateMapping(mappingId, updates) {
  if (!db) {
    throw new Error('SKU normalizer not initialized. Call init() first.');
  }

  const allowedFields = ['product_name', 'product_category', 'standard_uom', 'case_size', 'unit_weight_lbs', 'conversion_factor'];
  const setClause = [];
  const params = [];

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      setClause.push(`${key} = ?`);
      params.push(value);
    }
  }

  if (setClause.length === 0) return;

  setClause.push('updated_at = CURRENT_TIMESTAMP');
  params.push(mappingId);

  db.prepare(`
    UPDATE sku_mappings
    SET ${setClause.join(', ')}
    WHERE id = ?
  `).run(...params);
}

module.exports = {
  init,
  normalizeSku,
  extractBaseSku,
  findOrCreateMapping,
  getCanonicalSku,
  findSimilarProducts,
  convertUnits,
  enhanceLineItems,
  getMappingStats,
  updateMapping,
  UOM_CONVERSIONS
};
