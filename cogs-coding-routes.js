// =====================================================
// COGS CODING API ROUTES
// Revenue Radar - Invoice Cost Categorization
// =====================================================
// Enables restaurant managers to define expense categories
// and map SKUs to automatically code invoices
// =====================================================

const express = require('express');
const router = express.Router();
const db = require('./database');

// Default categories for new users
const DEFAULT_CATEGORIES = [
  { code: 'FOOD', name: 'Food & Beverage', color: '#22c55e', icon: 'utensils', sort_order: 1 },
  { code: 'PROD', name: 'Produce', color: '#84cc16', icon: 'leaf', sort_order: 2 },
  { code: 'MEAT', name: 'Meat & Poultry', color: '#ef4444', icon: 'drumstick', sort_order: 3 },
  { code: 'SFOOD', name: 'Seafood', color: '#3b82f6', icon: 'fish', sort_order: 4 },
  { code: 'DAIRY', name: 'Dairy & Eggs', color: '#fbbf24', icon: 'cheese', sort_order: 5 },
  { code: 'BEV', name: 'Beverages', color: '#8b5cf6', icon: 'wine', sort_order: 6 },
  { code: 'DRY', name: 'Dry Goods & Grocery', color: '#f97316', icon: 'box', sort_order: 7 },
  { code: 'PAPER', name: 'Paper & Disposables', color: '#64748b', icon: 'package', sort_order: 8 },
  { code: 'CLEAN', name: 'Cleaning & Chemicals', color: '#06b6d4', icon: 'sparkles', sort_order: 9 },
  { code: 'EQUIP', name: 'Equipment & Smallwares', color: '#ec4899', icon: 'wrench', sort_order: 10 },
  { code: 'OTHER', name: 'Other/Miscellaneous', color: '#94a3b8', icon: 'ellipsis', sort_order: 99 }
];

// =====================================================
// CATEGORIES ENDPOINTS
// =====================================================

/**
 * GET /api/cogs/categories
 * List all COGS categories for current user
 */
router.get('/categories', (req, res) => {
  try {
    const database = db.getDatabase();

    // Check if user has categories, if not create defaults
    const existingCount = database.prepare(`
      SELECT COUNT(*) as count FROM cogs_categories WHERE user_id = ?
    `).get(req.user.id);

    if (existingCount.count === 0) {
      // Create default categories for new user
      const insertStmt = database.prepare(`
        INSERT INTO cogs_categories (user_id, code, name, color, icon, sort_order)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const cat of DEFAULT_CATEGORIES) {
        insertStmt.run(req.user.id, cat.code, cat.name, cat.color, cat.icon, cat.sort_order);
      }
      console.log(`Created default COGS categories for user ${req.user.id}`);
    }

    // Get all categories with stats
    const categories = database.prepare(`
      SELECT
        c.*,
        COUNT(DISTINCT sm.id) as sku_count,
        COALESCE(SUM(CASE
          WHEN ci.invoice_date >= date('now', 'start of month')
          THEN ci.extended_price_cents
          ELSE 0
        END), 0) as mtd_spend_cents,
        COALESCE(SUM(CASE
          WHEN ci.invoice_date >= date('now', '-30 days')
          THEN ci.extended_price_cents
          ELSE 0
        END), 0) as last_30_days_cents,
        COUNT(DISTINCT ci.id) as coded_item_count
      FROM cogs_categories c
      LEFT JOIN cogs_sku_mappings sm ON sm.category_id = c.id AND sm.is_active = 1
      LEFT JOIN cogs_coded_items ci ON ci.category_id = c.id
      WHERE c.user_id = ? AND c.is_active = 1
      GROUP BY c.id
      ORDER BY c.sort_order ASC
    `).all(req.user.id);

    res.json({ success: true, data: categories });
  } catch (error) {
    console.error('Error fetching COGS categories:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/cogs/categories
 * Create a new category
 */
router.post('/categories', (req, res) => {
  try {
    const { code, name, description, color, icon, monthly_budget_cents, alert_threshold_pct } = req.body;

    if (!code || !name) {
      return res.status(400).json({ success: false, error: 'Code and name are required' });
    }

    const database = db.getDatabase();

    // Check for duplicate code
    const existing = database.prepare(`
      SELECT id FROM cogs_categories WHERE user_id = ? AND code = ?
    `).get(req.user.id, code.toUpperCase());

    if (existing) {
      return res.status(400).json({ success: false, error: 'Category code already exists' });
    }

    // Get max sort_order
    const maxOrder = database.prepare(`
      SELECT MAX(sort_order) as max_order FROM cogs_categories WHERE user_id = ?
    `).get(req.user.id);

    const result = database.prepare(`
      INSERT INTO cogs_categories (
        user_id, code, name, description, color, icon,
        monthly_budget_cents, alert_threshold_pct, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user.id,
      code.toUpperCase(),
      name,
      description || null,
      color || '#6366f1',
      icon || 'tag',
      monthly_budget_cents || null,
      alert_threshold_pct || 90,
      (maxOrder.max_order || 0) + 1
    );

    res.json({
      success: true,
      data: { id: result.lastInsertRowid },
      message: 'Category created successfully'
    });
  } catch (error) {
    console.error('Error creating COGS category:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/cogs/categories/:id
 * Update a category
 */
router.put('/categories/:id', (req, res) => {
  try {
    const { code, name, description, color, icon, monthly_budget_cents, alert_threshold_pct, sort_order } = req.body;
    const database = db.getDatabase();

    // Verify ownership
    const existing = database.prepare(`
      SELECT id FROM cogs_categories WHERE id = ? AND user_id = ?
    `).get(req.params.id, req.user.id);

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Category not found' });
    }

    const updates = [];
    const values = [];

    if (code !== undefined) { updates.push('code = ?'); values.push(code.toUpperCase()); }
    if (name !== undefined) { updates.push('name = ?'); values.push(name); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description); }
    if (color !== undefined) { updates.push('color = ?'); values.push(color); }
    if (icon !== undefined) { updates.push('icon = ?'); values.push(icon); }
    if (monthly_budget_cents !== undefined) { updates.push('monthly_budget_cents = ?'); values.push(monthly_budget_cents); }
    if (alert_threshold_pct !== undefined) { updates.push('alert_threshold_pct = ?'); values.push(alert_threshold_pct); }
    if (sort_order !== undefined) { updates.push('sort_order = ?'); values.push(sort_order); }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(req.params.id, req.user.id);

    database.prepare(`
      UPDATE cogs_categories SET ${updates.join(', ')} WHERE id = ? AND user_id = ?
    `).run(...values);

    res.json({ success: true, message: 'Category updated successfully' });
  } catch (error) {
    console.error('Error updating COGS category:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/cogs/categories/:id
 * Delete a category (soft delete)
 */
router.delete('/categories/:id', (req, res) => {
  try {
    const database = db.getDatabase();

    const result = database.prepare(`
      UPDATE cogs_categories SET is_active = 0 WHERE id = ? AND user_id = ?
    `).run(req.params.id, req.user.id);

    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: 'Category not found' });
    }

    res.json({ success: true, message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Error deleting COGS category:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// SKU MAPPINGS ENDPOINTS
// =====================================================

/**
 * GET /api/cogs/mappings
 * List all SKU mappings (optionally filtered by category)
 */
router.get('/mappings', (req, res) => {
  try {
    const { category_id, search, limit = 100, offset = 0 } = req.query;
    const database = db.getDatabase();

    let query = `
      SELECT
        m.*,
        c.code as category_code,
        c.name as category_name,
        c.color as category_color
      FROM cogs_sku_mappings m
      JOIN cogs_categories c ON c.id = m.category_id
      WHERE m.user_id = ? AND m.is_active = 1
    `;
    const params = [req.user.id];

    if (category_id) {
      query += ' AND m.category_id = ?';
      params.push(category_id);
    }

    if (search) {
      query += ' AND (m.sku LIKE ? OR m.product_name LIKE ? OR m.vendor_name LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    query += ' ORDER BY m.times_matched DESC, m.product_name ASC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const mappings = database.prepare(query).all(...params);

    // Get total count
    let countQuery = `
      SELECT COUNT(*) as total FROM cogs_sku_mappings m
      WHERE m.user_id = ? AND m.is_active = 1
    `;
    const countParams = [req.user.id];

    if (category_id) {
      countQuery += ' AND m.category_id = ?';
      countParams.push(category_id);
    }
    if (search) {
      countQuery += ' AND (m.sku LIKE ? OR m.product_name LIKE ? OR m.vendor_name LIKE ?)';
      const searchTerm = `%${search}%`;
      countParams.push(searchTerm, searchTerm, searchTerm);
    }

    const { total } = database.prepare(countQuery).get(...countParams);

    res.json({
      success: true,
      data: mappings,
      pagination: { limit: parseInt(limit), offset: parseInt(offset), total }
    });
  } catch (error) {
    console.error('Error fetching SKU mappings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/cogs/mappings
 * Create a new SKU mapping
 */
router.post('/mappings', (req, res) => {
  try {
    const {
      category_id, sku, product_name, vendor_name,
      match_type = 'exact', match_priority = 0,
      unit_of_measure, pack_size
    } = req.body;

    if (!category_id || (!sku && !product_name)) {
      return res.status(400).json({
        success: false,
        error: 'Category and either SKU or product name are required'
      });
    }

    const database = db.getDatabase();

    // Verify category ownership
    const category = database.prepare(`
      SELECT id FROM cogs_categories WHERE id = ? AND user_id = ?
    `).get(category_id, req.user.id);

    if (!category) {
      return res.status(404).json({ success: false, error: 'Category not found' });
    }

    const result = database.prepare(`
      INSERT INTO cogs_sku_mappings (
        user_id, category_id, sku, product_name, vendor_name,
        match_type, match_priority, unit_of_measure, pack_size, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual')
    `).run(
      req.user.id,
      category_id,
      sku || null,
      product_name || null,
      vendor_name || null,
      match_type,
      match_priority,
      unit_of_measure || null,
      pack_size || null
    );

    res.json({
      success: true,
      data: { id: result.lastInsertRowid },
      message: 'SKU mapping created successfully'
    });
  } catch (error) {
    console.error('Error creating SKU mapping:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/cogs/mappings/bulk
 * Create multiple SKU mappings at once
 */
router.post('/mappings/bulk', (req, res) => {
  try {
    const { category_id, mappings } = req.body;

    if (!category_id || !mappings || !Array.isArray(mappings)) {
      return res.status(400).json({
        success: false,
        error: 'Category ID and mappings array are required'
      });
    }

    const database = db.getDatabase();

    // Verify category ownership
    const category = database.prepare(`
      SELECT id FROM cogs_categories WHERE id = ? AND user_id = ?
    `).get(category_id, req.user.id);

    if (!category) {
      return res.status(404).json({ success: false, error: 'Category not found' });
    }

    const insertStmt = database.prepare(`
      INSERT OR IGNORE INTO cogs_sku_mappings (
        user_id, category_id, sku, product_name, vendor_name,
        match_type, source
      ) VALUES (?, ?, ?, ?, ?, ?, 'manual')
    `);

    let inserted = 0;
    for (const mapping of mappings) {
      if (mapping.sku || mapping.product_name) {
        const result = insertStmt.run(
          req.user.id,
          category_id,
          mapping.sku || null,
          mapping.product_name || null,
          mapping.vendor_name || null,
          mapping.match_type || 'exact'
        );
        if (result.changes > 0) inserted++;
      }
    }

    res.json({
      success: true,
      message: `Created ${inserted} SKU mappings`,
      data: { inserted, total: mappings.length }
    });
  } catch (error) {
    console.error('Error bulk creating SKU mappings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/cogs/mappings/:id
 * Update a SKU mapping
 */
router.put('/mappings/:id', (req, res) => {
  try {
    const {
      category_id, sku, product_name, vendor_name,
      match_type, match_priority, unit_of_measure, pack_size
    } = req.body;

    const database = db.getDatabase();

    // Verify ownership
    const existing = database.prepare(`
      SELECT id FROM cogs_sku_mappings WHERE id = ? AND user_id = ?
    `).get(req.params.id, req.user.id);

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Mapping not found' });
    }

    // If changing category, verify new category ownership
    if (category_id) {
      const category = database.prepare(`
        SELECT id FROM cogs_categories WHERE id = ? AND user_id = ?
      `).get(category_id, req.user.id);

      if (!category) {
        return res.status(404).json({ success: false, error: 'Category not found' });
      }
    }

    const updates = [];
    const values = [];

    if (category_id !== undefined) { updates.push('category_id = ?'); values.push(category_id); }
    if (sku !== undefined) { updates.push('sku = ?'); values.push(sku); }
    if (product_name !== undefined) { updates.push('product_name = ?'); values.push(product_name); }
    if (vendor_name !== undefined) { updates.push('vendor_name = ?'); values.push(vendor_name); }
    if (match_type !== undefined) { updates.push('match_type = ?'); values.push(match_type); }
    if (match_priority !== undefined) { updates.push('match_priority = ?'); values.push(match_priority); }
    if (unit_of_measure !== undefined) { updates.push('unit_of_measure = ?'); values.push(unit_of_measure); }
    if (pack_size !== undefined) { updates.push('pack_size = ?'); values.push(pack_size); }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(req.params.id, req.user.id);

    database.prepare(`
      UPDATE cogs_sku_mappings SET ${updates.join(', ')} WHERE id = ? AND user_id = ?
    `).run(...values);

    res.json({ success: true, message: 'Mapping updated successfully' });
  } catch (error) {
    console.error('Error updating SKU mapping:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/cogs/mappings/:id
 * Delete a SKU mapping
 */
router.delete('/mappings/:id', (req, res) => {
  try {
    const database = db.getDatabase();

    const result = database.prepare(`
      UPDATE cogs_sku_mappings SET is_active = 0 WHERE id = ? AND user_id = ?
    `).run(req.params.id, req.user.id);

    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: 'Mapping not found' });
    }

    res.json({ success: true, message: 'Mapping deleted successfully' });
  } catch (error) {
    console.error('Error deleting SKU mapping:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// CODED ITEMS & ANALYTICS
// =====================================================

/**
 * GET /api/cogs/coded-items
 * List coded invoice items
 */
router.get('/coded-items', (req, res) => {
  try {
    const { category_id, start_date, end_date, uncategorized, limit = 50, offset = 0 } = req.query;
    const database = db.getDatabase();

    let query = `
      SELECT
        ci.*,
        c.code as category_code,
        c.name as category_name,
        c.color as category_color
      FROM cogs_coded_items ci
      LEFT JOIN cogs_categories c ON c.id = ci.category_id
      WHERE ci.user_id = ?
    `;
    const params = [req.user.id];

    if (category_id) {
      query += ' AND ci.category_id = ?';
      params.push(category_id);
    }

    if (uncategorized === 'true') {
      query += ' AND ci.category_id IS NULL';
    }

    if (start_date) {
      query += ' AND ci.invoice_date >= ?';
      params.push(start_date);
    }

    if (end_date) {
      query += ' AND ci.invoice_date <= ?';
      params.push(end_date);
    }

    query += ' ORDER BY ci.invoice_date DESC, ci.id DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const items = database.prepare(query).all(...params);

    res.json({ success: true, data: items });
  } catch (error) {
    console.error('Error fetching coded items:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/cogs/coded-items/:id/categorize
 * Manually categorize an item (and optionally create mapping)
 */
router.put('/coded-items/:id/categorize', (req, res) => {
  try {
    const { category_id, create_mapping = false } = req.body;
    const database = db.getDatabase();

    // Verify item ownership
    const item = database.prepare(`
      SELECT * FROM cogs_coded_items WHERE id = ? AND user_id = ?
    `).get(req.params.id, req.user.id);

    if (!item) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    // Update the item
    database.prepare(`
      UPDATE cogs_coded_items
      SET category_id = ?, coding_method = 'manual', needs_review = 0
      WHERE id = ?
    `).run(category_id, req.params.id);

    // Optionally create a mapping for future items
    if (create_mapping && (item.sku || item.product_name)) {
      database.prepare(`
        INSERT OR IGNORE INTO cogs_sku_mappings (
          user_id, category_id, sku, product_name, vendor_name, source
        ) VALUES (?, ?, ?, ?, ?, 'manual')
      `).run(
        req.user.id,
        category_id,
        item.sku || null,
        item.product_name || null,
        item.vendor_name || null
      );
    }

    res.json({ success: true, message: 'Item categorized successfully' });
  } catch (error) {
    console.error('Error categorizing item:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/cogs/summary
 * Get COGS spending summary
 */
router.get('/summary', (req, res) => {
  try {
    const { period = '30d' } = req.query;
    const database = db.getDatabase();

    // Calculate date range
    let startDate;
    switch (period) {
      case '7d': startDate = "date('now', '-7 days')"; break;
      case '30d': startDate = "date('now', '-30 days')"; break;
      case 'mtd': startDate = "date('now', 'start of month')"; break;
      case 'ytd': startDate = "date('now', 'start of year')"; break;
      default: startDate = "date('now', '-30 days')";
    }

    // Get spending by category
    const categorySpending = database.prepare(`
      SELECT
        c.id,
        c.code,
        c.name,
        c.color,
        c.monthly_budget_cents,
        COALESCE(SUM(ci.extended_price_cents), 0) as total_cents,
        COUNT(ci.id) as item_count
      FROM cogs_categories c
      LEFT JOIN cogs_coded_items ci ON ci.category_id = c.id
        AND ci.invoice_date >= ${startDate}
      WHERE c.user_id = ? AND c.is_active = 1
      GROUP BY c.id
      ORDER BY total_cents DESC
    `).all(req.user.id);

    // Get total uncategorized
    const uncategorized = database.prepare(`
      SELECT
        COALESCE(SUM(extended_price_cents), 0) as total_cents,
        COUNT(*) as item_count
      FROM cogs_coded_items
      WHERE user_id = ? AND category_id IS NULL
        AND invoice_date >= ${startDate}
    `).get(req.user.id);

    // Get totals
    const totals = database.prepare(`
      SELECT
        COALESCE(SUM(extended_price_cents), 0) as total_cents,
        COUNT(*) as item_count,
        COUNT(DISTINCT invoice_number) as invoice_count
      FROM cogs_coded_items
      WHERE user_id = ? AND invoice_date >= ${startDate}
    `).get(req.user.id);

    // Get items needing review
    const needsReview = database.prepare(`
      SELECT COUNT(*) as count FROM cogs_coded_items
      WHERE user_id = ? AND (needs_review = 1 OR category_id IS NULL)
    `).get(req.user.id);

    res.json({
      success: true,
      data: {
        period,
        categories: categorySpending,
        uncategorized,
        totals,
        needs_review_count: needsReview.count
      }
    });
  } catch (error) {
    console.error('Error fetching COGS summary:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/cogs/price-history/:mapping_id
 * Get price history for a specific product
 */
router.get('/price-history/:mapping_id', (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const database = db.getDatabase();

    // Verify mapping ownership
    const mapping = database.prepare(`
      SELECT m.*, c.name as category_name
      FROM cogs_sku_mappings m
      JOIN cogs_categories c ON c.id = m.category_id
      WHERE m.id = ? AND m.user_id = ?
    `).get(req.params.mapping_id, req.user.id);

    if (!mapping) {
      return res.status(404).json({ success: false, error: 'Mapping not found' });
    }

    const history = database.prepare(`
      SELECT * FROM cogs_price_history
      WHERE mapping_id = ? AND user_id = ?
      ORDER BY invoice_date DESC
      LIMIT ?
    `).all(req.params.mapping_id, req.user.id, parseInt(limit));

    res.json({
      success: true,
      data: {
        mapping,
        history,
        stats: {
          avg_price_cents: mapping.avg_unit_price_cents,
          min_price_cents: mapping.min_unit_price_cents,
          max_price_cents: mapping.max_unit_price_cents,
          sample_count: mapping.price_sample_count
        }
      }
    });
  } catch (error) {
    console.error('Error fetching price history:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/cogs/uncategorized
 * Get uncategorized items grouped by product
 */
router.get('/uncategorized', (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const database = db.getDatabase();

    const items = database.prepare(`
      SELECT
        COALESCE(sku, product_name) as identifier,
        sku,
        product_name,
        vendor_name,
        COUNT(*) as occurrence_count,
        SUM(extended_price_cents) as total_spend_cents,
        AVG(unit_price_cents) as avg_unit_price_cents,
        MAX(invoice_date) as last_seen,
        MIN(invoice_date) as first_seen
      FROM cogs_coded_items
      WHERE user_id = ? AND category_id IS NULL
      GROUP BY COALESCE(sku, product_name), vendor_name
      ORDER BY total_spend_cents DESC
      LIMIT ?
    `).all(req.user.id, parseInt(limit));

    res.json({ success: true, data: items });
  } catch (error) {
    console.error('Error fetching uncategorized items:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/cogs/bulk-categorize
 * Categorize multiple uncategorized items at once
 */
router.post('/bulk-categorize', (req, res) => {
  try {
    const { items } = req.body; // Array of { identifier, category_id, create_mapping }

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ success: false, error: 'Items array required' });
    }

    const database = db.getDatabase();
    let categorized = 0;
    let mappingsCreated = 0;

    for (const item of items) {
      if (!item.identifier || !item.category_id) continue;

      // Update all matching uncategorized items
      const result = database.prepare(`
        UPDATE cogs_coded_items
        SET category_id = ?, coding_method = 'manual', needs_review = 0
        WHERE user_id = ? AND category_id IS NULL
          AND (sku = ? OR product_name = ?)
      `).run(item.category_id, req.user.id, item.identifier, item.identifier);

      categorized += result.changes;

      // Create mapping if requested
      if (item.create_mapping) {
        const insertResult = database.prepare(`
          INSERT OR IGNORE INTO cogs_sku_mappings (
            user_id, category_id, product_name, source
          ) VALUES (?, ?, ?, 'manual')
        `).run(req.user.id, item.category_id, item.identifier);

        if (insertResult.changes > 0) mappingsCreated++;
      }
    }

    res.json({
      success: true,
      message: `Categorized ${categorized} items, created ${mappingsCreated} mappings`,
      data: { categorized, mappings_created: mappingsCreated }
    });
  } catch (error) {
    console.error('Error bulk categorizing:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
