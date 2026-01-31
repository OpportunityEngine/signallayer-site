/**
 * Revenue Radar - Business Intelligence API Routes
 *
 * Endpoints for:
 * - Opportunity detection and management
 * - Cost savings tracking
 * - Lead/contact extraction
 * - Inventory management
 * - Payroll & expense analytics
 */

const express = require('express');
const db = require('./database');
const OpportunityEngine = require('./opportunity-engine');
const ReorderEngine = require('./reorder-engine');
const InventoryIntelligence = require('./inventory-intelligence');
const emailService = require('./email-service');

const router = express.Router();
const opportunityEngine = new OpportunityEngine();
const reorderEngine = new ReorderEngine();
const inventoryIntelligence = new InventoryIntelligence();

// Middleware to get user context
function getUserContext(req) {
  // In production, extract from JWT
  const userEmail = req.headers['x-user-email'] || req.user?.email || 'demo@example.com';
  let user = db.getUserByEmail(userEmail);

  if (!user) {
    const userId = db.createOrUpdateUser(userEmail, userEmail.split('@')[0], 'rep');
    user = db.getUserById(userId);
  }

  return user;
}

// =====================================================
// OPPORTUNITY ENDPOINTS
// =====================================================

// GET /api/bi/opportunities - Get detected opportunities
router.get('/opportunities', (req, res) => {
  try {
    const user = getUserContext(req);
    const { status, type, urgency, limit, offset } = req.query;

    const opportunities = opportunityEngine.getOpportunities(user.id, {
      status,
      type,
      urgency,
      limit: parseInt(limit) || 50,
      offset: parseInt(offset) || 0
    });

    // Parse JSON fields
    const parsed = opportunities.map(opp => ({
      ...opp,
      supporting_data: opp.supporting_data ? JSON.parse(opp.supporting_data) : null,
      action_items: opp.action_items ? JSON.parse(opp.action_items) : []
    }));

    res.json({
      success: true,
      data: parsed,
      count: parsed.length
    });
  } catch (error) {
    console.error('[BI] Opportunities fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/bi/opportunities/summary - Get opportunity summary stats
router.get('/opportunities/summary', (req, res) => {
  try {
    const user = getUserContext(req);
    const summary = opportunityEngine.getOpportunitySummary(user.id);

    res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    console.error('[BI] Opportunity summary error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/bi/opportunities/analyze - Run opportunity detection
router.post('/opportunities/analyze', async (req, res) => {
  try {
    const user = getUserContext(req);
    const results = await opportunityEngine.analyzeForUser(user.id);

    res.json({
      success: true,
      data: results
    });
  } catch (error) {
    console.error('[BI] Opportunity analysis error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PATCH /api/bi/opportunities/:id - Update opportunity status
router.patch('/opportunities/:id', (req, res) => {
  try {
    const user = getUserContext(req);
    const { id } = req.params;
    const { status, notes } = req.body;

    const validStatuses = ['new', 'viewed', 'in_progress', 'won', 'lost', 'expired'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status'
      });
    }

    opportunityEngine.updateOpportunityStatus(id, status, user.id);

    // If won, create cost savings record
    if (status === 'won') {
      const database = db.getDatabase();
      const opportunity = database.prepare('SELECT * FROM detected_opportunities WHERE id = ?').get(id);

      if (opportunity && opportunity.estimated_value_cents > 0) {
        database.prepare(`
          INSERT INTO cost_savings (
            user_id, opportunity_id, savings_type, description, vendor_name, sku,
            savings_cents, savings_period, annualized_savings_cents, realized_date
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'annual', ?, date('now'))
        `).run(
          user.id,
          id,
          opportunity.opportunity_type === 'price_increase' ? 'negotiated_price' :
          opportunity.opportunity_type === 'bulk_discount' ? 'bulk_purchase' :
          opportunity.opportunity_type === 'vendor_consolidation' ? 'vendor_switch' :
          'process_optimization',
          opportunity.title,
          opportunity.vendor_name,
          opportunity.sku,
          opportunity.estimated_value_cents,
          opportunity.estimated_value_cents
        );
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[BI] Opportunity update error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// COST SAVINGS ENDPOINTS
// =====================================================

// GET /api/bi/savings - Get cost savings records
router.get('/savings', (req, res) => {
  try {
    const user = getUserContext(req);
    const { period, type } = req.query;

    const database = db.getDatabase();
    let query = `
      SELECT
        cs.*,
        do.title as opportunity_title
      FROM cost_savings cs
      LEFT JOIN detected_opportunities do ON cs.opportunity_id = do.id
      WHERE cs.user_id = ?
    `;
    const params = [user.id];

    if (period === '30') {
      query += ` AND cs.realized_date >= date('now', '-30 days')`;
    } else if (period === '90') {
      query += ` AND cs.realized_date >= date('now', '-90 days')`;
    } else if (period === '365') {
      query += ` AND cs.realized_date >= date('now', '-365 days')`;
    }

    if (type) {
      query += ` AND cs.savings_type = ?`;
      params.push(type);
    }

    query += ` ORDER BY cs.realized_date DESC`;

    const savings = database.prepare(query).all(...params);

    res.json({
      success: true,
      data: savings
    });
  } catch (error) {
    console.error('[BI] Savings fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/bi/savings/summary - Get savings summary
router.get('/savings/summary', (req, res) => {
  try {
    const user = getUserContext(req);
    const database = db.getDatabase();

    const summary = database.prepare(`
      SELECT
        COUNT(*) as total_records,
        SUM(savings_cents) as total_savings_cents,
        SUM(annualized_savings_cents) as total_annualized_cents,
        AVG(savings_cents) as avg_savings_cents,
        COUNT(DISTINCT savings_type) as savings_types_count
      FROM cost_savings
      WHERE user_id = ?
        AND realized_date >= date('now', '-365 days')
    `).get(user.id);

    const byType = database.prepare(`
      SELECT
        savings_type,
        COUNT(*) as count,
        SUM(savings_cents) as total_cents
      FROM cost_savings
      WHERE user_id = ?
        AND realized_date >= date('now', '-365 days')
      GROUP BY savings_type
      ORDER BY total_cents DESC
    `).all(user.id);

    const monthly = database.prepare(`
      SELECT
        strftime('%Y-%m', realized_date) as month,
        SUM(savings_cents) as total_cents,
        COUNT(*) as count
      FROM cost_savings
      WHERE user_id = ?
        AND realized_date >= date('now', '-12 months')
      GROUP BY strftime('%Y-%m', realized_date)
      ORDER BY month
    `).all(user.id);

    res.json({
      success: true,
      data: {
        summary,
        byType,
        monthly
      }
    });
  } catch (error) {
    console.error('[BI] Savings summary error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/bi/savings - Record manual cost savings
router.post('/savings', (req, res) => {
  try {
    const user = getUserContext(req);
    const {
      savings_type, description, vendor_name, sku,
      original_cost_cents, new_cost_cents, quantity,
      savings_cents, savings_period
    } = req.body;

    if (!savings_type || !savings_cents) {
      return res.status(400).json({
        success: false,
        error: 'savings_type and savings_cents are required'
      });
    }

    const database = db.getDatabase();
    const annualized = savings_period === 'one_time' ? savings_cents :
                      savings_period === 'monthly' ? savings_cents * 12 :
                      savings_period === 'quarterly' ? savings_cents * 4 : savings_cents;

    const result = database.prepare(`
      INSERT INTO cost_savings (
        user_id, savings_type, description, vendor_name, sku,
        original_cost_cents, new_cost_cents, quantity,
        savings_cents, savings_period, annualized_savings_cents, realized_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, date('now'))
    `).run(
      user.id, savings_type, description, vendor_name, sku,
      original_cost_cents, new_cost_cents, quantity,
      savings_cents, savings_period || 'one_time', annualized
    );

    res.json({
      success: true,
      data: { id: result.lastInsertRowid }
    });
  } catch (error) {
    console.error('[BI] Savings create error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// CONTACT EXTRACTION ENDPOINTS
// =====================================================

// GET /api/bi/contacts - Get extracted contacts
router.get('/contacts', (req, res) => {
  try {
    const user = getUserContext(req);
    const { company, type, format } = req.query;

    const database = db.getDatabase();
    let query = `
      SELECT * FROM extracted_contacts
      WHERE user_id = ?
    `;
    const params = [user.id];

    if (company) {
      query += ` AND company_name LIKE ?`;
      params.push(`%${company}%`);
    }

    if (type) {
      query += ` AND contact_type = ?`;
      params.push(type);
    }

    query += ` ORDER BY company_name, is_primary DESC`;

    const contacts = database.prepare(query).all(...params);

    // Single-line format for sales reps
    if (format === 'single_line') {
      const formatted = contacts.map(c => {
        const parts = [c.company_name];
        if (c.contact_name) parts.push(`| ${c.contact_name}`);
        if (c.title) parts.push(`(${c.title})`);
        if (c.email) parts.push(`| ${c.email}`);
        if (c.phone) parts.push(`| ${c.phone}`);
        return {
          id: c.id,
          single_line: parts.join(' '),
          ...c
        };
      });
      return res.json({ success: true, data: formatted });
    }

    res.json({
      success: true,
      data: contacts
    });
  } catch (error) {
    console.error('[BI] Contacts fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/bi/contacts/extract - Extract contacts from invoice/email
router.post('/contacts/extract', (req, res) => {
  try {
    const user = getUserContext(req);
    const { text, source_type, source_id } = req.body;

    if (!text) {
      return res.status(400).json({
        success: false,
        error: 'Text content required for extraction'
      });
    }

    // Extract contact info using regex patterns
    const extracted = extractContactInfo(text);

    const database = db.getDatabase();
    const insertedIds = [];

    extracted.forEach(contact => {
      // Check for existing contact
      const existing = database.prepare(`
        SELECT id FROM extracted_contacts
        WHERE user_id = ? AND email = ?
      `).get(user.id, contact.email);

      if (!existing && contact.email) {
        const result = database.prepare(`
          INSERT INTO extracted_contacts (
            user_id, source_type, source_id, company_name, contact_name,
            title, email, phone, address_line1, city, state, postal_code
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          user.id, source_type || 'invoice', source_id,
          contact.company_name, contact.contact_name, contact.title,
          contact.email, contact.phone, contact.address,
          contact.city, contact.state, contact.postal_code
        );
        insertedIds.push(result.lastInsertRowid);
      }
    });

    res.json({
      success: true,
      data: {
        extracted_count: extracted.length,
        inserted_count: insertedIds.length,
        contacts: extracted
      }
    });
  } catch (error) {
    console.error('[BI] Contact extraction error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Contact extraction helper
function extractContactInfo(text) {
  const contacts = [];

  // Email pattern
  const emailPattern = /[\w.-]+@[\w.-]+\.\w+/gi;
  const emails = text.match(emailPattern) || [];

  // Phone pattern
  const phonePattern = /(?:\+1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/g;
  const phones = text.match(phonePattern) || [];

  // Name pattern (before email or phone)
  const namePattern = /(?:contact|rep|sales|manager|account)[\s:]+([A-Z][a-z]+ [A-Z][a-z]+)/gi;
  const names = [];
  let nameMatch;
  while ((nameMatch = namePattern.exec(text)) !== null) {
    names.push(nameMatch[1]);
  }

  // Company pattern
  const companyPattern = /(?:from|vendor|supplier|company)[\s:]+([A-Z][A-Za-z\s&]+(?:Inc|LLC|Corp|Co|Ltd)?)/gi;
  const companies = [];
  let companyMatch;
  while ((companyMatch = companyPattern.exec(text)) !== null) {
    companies.push(companyMatch[1].trim());
  }

  // Build contacts from extracted data
  emails.forEach((email, idx) => {
    contacts.push({
      email: email.toLowerCase(),
      phone: phones[idx] || null,
      contact_name: names[idx] || null,
      company_name: companies[idx] || email.split('@')[1]?.split('.')[0] || null
    });
  });

  return contacts;
}

// =====================================================
// INVENTORY ENDPOINTS
// =====================================================

// GET /api/bi/inventory - Get inventory items
router.get('/inventory', (req, res) => {
  try {
    const user = getUserContext(req);
    const { category, status, low_stock } = req.query;

    const database = db.getDatabase();
    let query = `
      SELECT
        i.*,
        (i.current_quantity * i.avg_unit_cost_cents / 100) as total_value_dollars,
        CASE
          WHEN i.current_quantity <= i.min_quantity * 0.5 THEN 'critical'
          WHEN i.current_quantity <= i.min_quantity THEN 'low'
          WHEN i.max_quantity IS NOT NULL AND i.current_quantity > i.max_quantity THEN 'overstocked'
          ELSE 'normal'
        END as stock_status
      FROM inventory_items i
      WHERE i.user_id = ? AND i.is_active = 1
    `;
    const params = [user.id];

    if (category) {
      query += ` AND i.category = ?`;
      params.push(category);
    }

    if (low_stock === 'true') {
      query += ` AND i.current_quantity <= i.min_quantity`;
    }

    query += ` ORDER BY
      CASE
        WHEN i.current_quantity <= i.min_quantity * 0.5 THEN 1
        WHEN i.current_quantity <= i.min_quantity THEN 2
        ELSE 3
      END,
      i.product_name`;

    const items = database.prepare(query).all(...params);

    res.json({
      success: true,
      data: items
    });
  } catch (error) {
    console.error('[BI] Inventory fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/bi/inventory/upload - Bulk upload inventory from Excel
router.post('/inventory/upload', (req, res) => {
  try {
    const user = getUserContext(req);
    const { items } = req.body;

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({
        success: false,
        error: 'Items array required'
      });
    }

    const database = db.getDatabase();
    const results = { inserted: 0, updated: 0, errors: [] };

    // Create snapshot
    const snapshot = database.prepare(`
      INSERT INTO inventory_snapshots (user_id, snapshot_date, file_name, total_items)
      VALUES (?, date('now'), ?, ?)
    `).run(user.id, req.body.file_name || 'upload', items.length);

    const snapshotId = snapshot.lastInsertRowid;

    items.forEach((item, idx) => {
      try {
        // Upsert inventory item
        const existing = database.prepare(`
          SELECT id FROM inventory_items WHERE user_id = ? AND sku = ?
        `).get(user.id, item.sku);

        if (existing) {
          database.prepare(`
            UPDATE inventory_items SET
              product_name = COALESCE(?, product_name),
              category = COALESCE(?, category),
              current_quantity = ?,
              unit_of_measure = COALESCE(?, unit_of_measure),
              min_quantity = COALESCE(?, min_quantity),
              par_level = COALESCE(?, par_level),
              last_unit_cost_cents = COALESCE(?, last_unit_cost_cents),
              vendor_name = COALESCE(?, vendor_name),
              last_counted_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(
            item.product_name, item.category, item.quantity,
            item.unit_of_measure, item.min_quantity, item.par_level,
            item.unit_cost_cents, item.vendor_name, existing.id
          );
          results.updated++;
        } else {
          database.prepare(`
            INSERT INTO inventory_items (
              user_id, sku, product_name, category, current_quantity,
              unit_of_measure, min_quantity, par_level, last_unit_cost_cents,
              avg_unit_cost_cents, vendor_name, last_counted_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          `).run(
            user.id, item.sku, item.product_name, item.category, item.quantity,
            item.unit_of_measure || 'each', item.min_quantity || 0, item.par_level,
            item.unit_cost_cents, item.unit_cost_cents, item.vendor_name
          );
          results.inserted++;
        }
      } catch (err) {
        results.errors.push(`Row ${idx + 1}: ${err.message}`);
      }
    });

    // Update snapshot with totals
    const totals = database.prepare(`
      SELECT
        COUNT(*) as total_items,
        SUM(current_quantity * COALESCE(avg_unit_cost_cents, 0)) as total_value,
        COUNT(CASE WHEN current_quantity <= min_quantity THEN 1 END) as below_par
      FROM inventory_items
      WHERE user_id = ? AND is_active = 1
    `).get(user.id);

    database.prepare(`
      UPDATE inventory_snapshots SET
        total_items = ?,
        total_value_cents = ?,
        items_below_par = ?
      WHERE id = ?
    `).run(totals.total_items, totals.total_value, totals.below_par, snapshotId);

    res.json({
      success: true,
      data: {
        ...results,
        snapshot_id: snapshotId,
        totals
      }
    });
  } catch (error) {
    console.error('[BI] Inventory upload error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/bi/inventory/recommendations - Get smart reorder recommendations
router.get('/inventory/recommendations', (req, res) => {
  try {
    const user = getUserContext(req);
    const database = db.getDatabase();

    const recommendations = database.prepare(`
      SELECT
        r.*,
        i.product_name,
        i.sku,
        i.current_quantity,
        i.min_quantity,
        i.par_level,
        i.vendor_name,
        i.category
      FROM reorder_recommendations r
      JOIN inventory_items i ON r.inventory_item_id = i.id
      WHERE r.user_id = ?
        AND r.is_dismissed = 0
        AND r.is_actioned = 0
        AND (r.expires_at IS NULL OR r.expires_at > CURRENT_TIMESTAMP)
      ORDER BY
        CASE r.priority
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          ELSE 4
        END,
        r.potential_savings_cents DESC
    `).all(user.id);

    // Parse reasoning JSON
    const parsed = recommendations.map(rec => ({
      ...rec,
      reasoning: rec.reasoning ? JSON.parse(rec.reasoning) : null
    }));

    res.json({
      success: true,
      data: parsed
    });
  } catch (error) {
    console.error('[BI] Recommendations fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/bi/inventory/recommendations/generate - Generate fresh recommendations
router.post('/inventory/recommendations/generate', async (req, res) => {
  try {
    const user = getUserContext(req);
    const recommendations = await reorderEngine.generateRecommendations(user.id);

    res.json({
      success: true,
      data: {
        generated_count: recommendations.length,
        recommendations: recommendations.map(rec => ({
          ...rec,
          reasoning: rec.reasoning ? JSON.parse(rec.reasoning) : null
        }))
      }
    });
  } catch (error) {
    console.error('[BI] Recommendation generation error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/bi/inventory/recommendations/summary - Get recommendation summary
router.get('/inventory/recommendations/summary', (req, res) => {
  try {
    const user = getUserContext(req);
    const summary = reorderEngine.getSummary(user.id);

    res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    console.error('[BI] Recommendation summary error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PATCH /api/bi/inventory/recommendations/:id/dismiss - Dismiss a recommendation
router.patch('/inventory/recommendations/:id/dismiss', (req, res) => {
  try {
    const user = getUserContext(req);
    const { id } = req.params;
    const database = db.getDatabase();

    database.prepare(`
      UPDATE reorder_recommendations
      SET is_dismissed = 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `).run(id, user.id);

    res.json({ success: true });
  } catch (error) {
    console.error('[BI] Recommendation dismiss error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PATCH /api/bi/inventory/recommendations/:id/action - Mark recommendation as actioned
router.patch('/inventory/recommendations/:id/action', (req, res) => {
  try {
    const user = getUserContext(req);
    const { id } = req.params;
    const { quantity_ordered, notes } = req.body;
    const database = db.getDatabase();

    database.prepare(`
      UPDATE reorder_recommendations
      SET is_actioned = 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `).run(id, user.id);

    // If savings were involved, record them
    const rec = database.prepare(`
      SELECT * FROM reorder_recommendations WHERE id = ?
    `).get(id);

    if (rec && rec.potential_savings_cents > 0 && quantity_ordered) {
      const item = database.prepare(`
        SELECT * FROM inventory_items WHERE id = ?
      `).get(rec.inventory_item_id);

      if (item) {
        database.prepare(`
          INSERT INTO cost_savings (
            user_id, savings_type, description, vendor_name, sku,
            savings_cents, savings_period, annualized_savings_cents, realized_date
          ) VALUES (?, 'bulk_purchase', ?, ?, ?, ?, 'one_time', ?, date('now'))
        `).run(
          user.id,
          rec.title,
          item.vendor_name,
          item.sku,
          rec.potential_savings_cents,
          rec.potential_savings_cents
        );
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[BI] Recommendation action error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/bi/inventory/usage - Record inventory usage
router.post('/inventory/usage', (req, res) => {
  try {
    const user = getUserContext(req);
    const { inventory_item_id, quantity, date } = req.body;

    if (!inventory_item_id || !quantity) {
      return res.status(400).json({
        success: false,
        error: 'inventory_item_id and quantity are required'
      });
    }

    reorderEngine.recordUsage(inventory_item_id, quantity, date);

    res.json({ success: true });
  } catch (error) {
    console.error('[BI] Usage recording error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/bi/inventory/price - Record a price observation
router.post('/inventory/price', (req, res) => {
  try {
    const user = getUserContext(req);
    const { vendor_name, sku, price_cents, quantity } = req.body;

    if (!vendor_name || !sku || !price_cents) {
      return res.status(400).json({
        success: false,
        error: 'vendor_name, sku, and price_cents are required'
      });
    }

    reorderEngine.recordPrice(user.id, vendor_name, sku, price_cents, quantity || 1);

    res.json({ success: true });
  } catch (error) {
    console.error('[BI] Price recording error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/bi/inventory/forecast/:id - Get detailed supply forecast for an item
router.get('/inventory/forecast/:id', (req, res) => {
  try {
    const user = getUserContext(req);
    const { id } = req.params;
    const database = db.getDatabase();

    const item = database.prepare(`
      SELECT * FROM inventory_items WHERE id = ? AND user_id = ?
    `).get(id, user.id);

    if (!item) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    // Get usage history
    const usageHistory = database.prepare(`
      SELECT date, daily_usage
      FROM inventory_usage
      WHERE inventory_item_id = ?
      ORDER BY date DESC
      LIMIT 90
    `).all(id);

    // Calculate averages
    const avg7d = usageHistory.slice(0, 7).reduce((sum, u) => sum + u.daily_usage, 0) / Math.min(7, usageHistory.length) || 0;
    const avg30d = usageHistory.slice(0, 30).reduce((sum, u) => sum + u.daily_usage, 0) / Math.min(30, usageHistory.length) || 0;
    const avg90d = usageHistory.reduce((sum, u) => sum + u.daily_usage, 0) / usageHistory.length || 0;

    // Project supply duration at each rate
    const today = new Date();
    const projections = {
      at_7d_rate: {
        days: avg7d > 0 ? Math.floor(item.current_quantity / avg7d) : 999,
        date: avg7d > 0 ? new Date(today.getTime() + Math.floor(item.current_quantity / avg7d) * 24 * 60 * 60 * 1000).toISOString() : null
      },
      at_30d_rate: {
        days: avg30d > 0 ? Math.floor(item.current_quantity / avg30d) : 999,
        date: avg30d > 0 ? new Date(today.getTime() + Math.floor(item.current_quantity / avg30d) * 24 * 60 * 60 * 1000).toISOString() : null
      },
      at_90d_rate: {
        days: avg90d > 0 ? Math.floor(item.current_quantity / avg90d) : 999,
        date: avg90d > 0 ? new Date(today.getTime() + Math.floor(item.current_quantity / avg90d) * 24 * 60 * 60 * 1000).toISOString() : null
      }
    };

    // Get price history
    const priceHistory = database.prepare(`
      SELECT * FROM vendor_price_history
      WHERE user_id = ? AND sku = ?
      ORDER BY created_at DESC
      LIMIT 20
    `).all(user.id, item.sku);

    res.json({
      success: true,
      data: {
        item,
        usage: {
          avg_7d: avg7d,
          avg_30d: avg30d,
          avg_90d: avg90d,
          history: usageHistory
        },
        projections,
        priceHistory
      }
    });
  } catch (error) {
    console.error('[BI] Forecast error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// PAYROLL & EXPENSE ENDPOINTS
// =====================================================

// POST /api/bi/payroll - Add payroll entry
router.post('/payroll', (req, res) => {
  try {
    const user = getUserContext(req);
    const {
      period_type, period_start, period_end,
      gross_payroll_cents, employer_taxes_cents, benefits_cents,
      employee_count, hours_worked, overtime_hours, overtime_cost_cents, notes
    } = req.body;

    if (!period_start || !period_end || !gross_payroll_cents) {
      return res.status(400).json({
        success: false,
        error: 'period_start, period_end, and gross_payroll_cents are required'
      });
    }

    const database = db.getDatabase();
    const total_labor_cost = gross_payroll_cents + (employer_taxes_cents || 0) + (benefits_cents || 0);

    const result = database.prepare(`
      INSERT INTO payroll_entries (
        user_id, period_type, period_start, period_end,
        gross_payroll_cents, employer_taxes_cents, benefits_cents,
        total_labor_cost_cents, employee_count, hours_worked,
        overtime_hours, overtime_cost_cents, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user.id, period_type || 'weekly', period_start, period_end,
      gross_payroll_cents, employer_taxes_cents || 0, benefits_cents || 0,
      total_labor_cost, employee_count, hours_worked,
      overtime_hours || 0, overtime_cost_cents || 0, notes
    );

    res.json({
      success: true,
      data: { id: result.lastInsertRowid, total_labor_cost_cents: total_labor_cost }
    });
  } catch (error) {
    console.error('[BI] Payroll create error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/bi/payroll - Get payroll entries
router.get('/payroll', (req, res) => {
  try {
    const user = getUserContext(req);
    const { period } = req.query;

    const database = db.getDatabase();
    let query = `SELECT * FROM payroll_entries WHERE user_id = ?`;
    const params = [user.id];

    if (period) {
      query += ` AND period_start >= date('now', '-' || ? || ' days')`;
      params.push(period);
    }

    query += ` ORDER BY period_start DESC`;

    const entries = database.prepare(query).all(...params);

    res.json({
      success: true,
      data: entries
    });
  } catch (error) {
    console.error('[BI] Payroll fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/bi/expenses - Add expense entry
router.post('/expenses', (req, res) => {
  try {
    const user = getUserContext(req);
    const {
      period_type, period_start, period_end,
      category, subcategory, amount_cents,
      vendor_name, description, is_recurring
    } = req.body;

    if (!period_start || !period_end || !category || !amount_cents) {
      return res.status(400).json({
        success: false,
        error: 'period_start, period_end, category, and amount_cents are required'
      });
    }

    const database = db.getDatabase();
    const result = database.prepare(`
      INSERT INTO expense_entries (
        user_id, period_type, period_start, period_end,
        category, subcategory, amount_cents,
        vendor_name, description, is_recurring
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user.id, period_type || 'weekly', period_start, period_end,
      category, subcategory, amount_cents,
      vendor_name, description, is_recurring ? 1 : 0
    );

    res.json({
      success: true,
      data: { id: result.lastInsertRowid }
    });
  } catch (error) {
    console.error('[BI] Expense create error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/bi/payroll/upload - Upload parsed payroll file data
router.post('/payroll/upload', (req, res) => {
  try {
    const user = getUserContext(req);
    const { provider, period_start, period_end, employees, file_name, totals } = req.body;

    if (!employees || !Array.isArray(employees) || employees.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'employees array is required with at least one employee record'
      });
    }

    const database = db.getDatabase();

    // Calculate totals from employee data if not provided
    const calculatedTotals = {
      gross: 0,
      net: 0,
      hours: 0,
      employeeCount: employees.length
    };

    employees.forEach(emp => {
      if (emp.gross) calculatedTotals.gross += parseFloat(emp.gross) || 0;
      if (emp.net) calculatedTotals.net += parseFloat(emp.net) || 0;
      if (emp.hours) calculatedTotals.hours += parseFloat(emp.hours) || 0;
    });

    // Use provided totals or calculated ones
    const finalTotals = totals || calculatedTotals;

    // Create payroll entry from upload
    const grossCents = Math.round((finalTotals.gross || calculatedTotals.gross) * 100);
    const periodStart = period_start || new Date().toISOString().split('T')[0];
    const periodEnd = period_end || periodStart;

    // Estimate employer taxes (approximately 7.65% for FICA)
    const employerTaxesCents = Math.round(grossCents * 0.0765);

    const result = database.prepare(`
      INSERT INTO payroll_entries (
        user_id, period_type, period_start, period_end,
        gross_payroll_cents, employer_taxes_cents, benefits_cents,
        total_labor_cost_cents, employee_count, hours_worked,
        overtime_hours, overtime_cost_cents, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user.id,
      'weekly', // Default to weekly
      periodStart,
      periodEnd,
      grossCents,
      employerTaxesCents,
      0, // benefits_cents - would need to be parsed from file
      grossCents + employerTaxesCents,
      finalTotals.employeeCount || employees.length,
      Math.round(finalTotals.hours || calculatedTotals.hours),
      0, // overtime_hours - would need special parsing
      0, // overtime_cost_cents
      `Uploaded from ${provider || 'unknown'} file: ${file_name || 'payroll_upload'}`
    );

    // Store individual employee records for detailed reporting
    const insertEmployee = database.prepare(`
      INSERT OR REPLACE INTO payroll_employee_records (
        user_id, payroll_entry_id, employee_name, department,
        gross_cents, net_cents, hours_worked, pay_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Check if table exists, create if not
    try {
      database.exec(`
        CREATE TABLE IF NOT EXISTS payroll_employee_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          payroll_entry_id INTEGER NOT NULL,
          employee_name TEXT,
          department TEXT,
          gross_cents INTEGER DEFAULT 0,
          net_cents INTEGER DEFAULT 0,
          hours_worked REAL DEFAULT 0,
          pay_date TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id),
          FOREIGN KEY (payroll_entry_id) REFERENCES payroll_entries(id)
        )
      `);
    } catch (tableErr) {
      // Table might already exist
    }

    let employeesInserted = 0;
    employees.forEach(emp => {
      try {
        insertEmployee.run(
          user.id,
          result.lastInsertRowid,
          emp.employee || emp.name || 'Unknown',
          emp.department || null,
          Math.round((parseFloat(emp.gross) || 0) * 100),
          Math.round((parseFloat(emp.net) || 0) * 100),
          parseFloat(emp.hours) || 0,
          emp.date || periodStart
        );
        employeesInserted++;
      } catch (empErr) {
        console.warn('[BI] Employee insert warning:', empErr.message);
      }
    });

    console.log(`[BI] Payroll upload: ${employeesInserted} employees, $${(grossCents/100).toFixed(2)} gross from ${provider || 'unknown'}`);

    res.json({
      success: true,
      data: {
        payroll_entry_id: result.lastInsertRowid,
        employees_imported: employeesInserted,
        totals: {
          gross_dollars: (grossCents / 100).toFixed(2),
          employee_count: finalTotals.employeeCount || employees.length,
          hours_worked: Math.round(finalTotals.hours || calculatedTotals.hours),
          total_labor_cost_dollars: ((grossCents + employerTaxesCents) / 100).toFixed(2)
        },
        provider: provider || 'unknown',
        period: { start: periodStart, end: periodEnd }
      }
    });
  } catch (error) {
    console.error('[BI] Payroll upload error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/bi/expenses - Get expense entries
router.get('/expenses', (req, res) => {
  try {
    const user = getUserContext(req);
    const { period, category } = req.query;

    const database = db.getDatabase();
    let query = `SELECT * FROM expense_entries WHERE user_id = ?`;
    const params = [user.id];

    if (period) {
      query += ` AND period_start >= date('now', '-' || ? || ' days')`;
      params.push(period);
    }

    if (category) {
      query += ` AND category = ?`;
      params.push(category);
    }

    query += ` ORDER BY period_start DESC`;

    const entries = database.prepare(query).all(...params);

    res.json({
      success: true,
      data: entries
    });
  } catch (error) {
    console.error('[BI] Expenses fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/bi/financial-summary - Get financial summary for dashboard charts
router.get('/financial-summary', (req, res) => {
  try {
    const user = getUserContext(req);
    const { days = 30 } = req.query;

    const database = db.getDatabase();

    // Get totals for the period
    const payrollTotal = database.prepare(`
      SELECT COALESCE(SUM(gross_payroll_cents), 0) as total
      FROM payroll_entries
      WHERE user_id = ?
        AND period_start >= date('now', '-' || ? || ' days')
    `).get(user.id, days);

    const expensesTotal = database.prepare(`
      SELECT COALESCE(SUM(amount_cents), 0) as total
      FROM expense_entries
      WHERE user_id = ?
        AND period_start >= date('now', '-' || ? || ' days')
    `).get(user.id, days);

    // Get savings from cost_savings table
    const savingsTotal = database.prepare(`
      SELECT COALESCE(SUM(savings_cents), 0) as total
      FROM cost_savings
      WHERE user_id = ?
        AND realized_date >= date('now', '-' || ? || ' days')
    `).get(user.id, days);

    // ===== INVOICE DATA FROM EMAIL AUTOPILOT =====
    // Get user's monitor IDs to find invoices via account_name or run_id pattern
    const userMonitors = database.prepare(`
      SELECT id, account_name FROM email_monitors
      WHERE user_id = ? OR created_by_user_id = ?
    `).all(user.id, user.id);

    const monitorIds = userMonitors.map(m => m.id);
    const accountNames = userMonitors.map(m => m.account_name).filter(Boolean);

    // Build a query that finds invoices by:
    // 1. Direct user_id match
    // 2. run_id pattern matching email monitor (email-{monitor_id}-%)
    // 3. account_name matching a monitor
    let invoiceWhereClause = `user_id = ?`;
    const invoiceParams = [user.id];  // Start with just user.id

    if (monitorIds.length > 0) {
      const runIdPatterns = monitorIds.map(id => `run_id LIKE 'email-${id}-%'`).join(' OR ');
      invoiceWhereClause = `(${invoiceWhereClause} OR ${runIdPatterns})`;
    }
    if (accountNames.length > 0) {
      const accountPlaceholders = accountNames.map(() => '?').join(', ');
      invoiceWhereClause = `(${invoiceWhereClause} OR account_name IN (${accountPlaceholders}))`;
      invoiceParams.push(...accountNames);
    }
    // Add days parameter LAST (for the datetime clause)
    invoiceParams.push(days);

    // Get invoice totals from ingestion_runs (processed by email autopilot)
    const invoiceData = database.prepare(`
      SELECT
        COUNT(*) as invoice_count,
        COALESCE(SUM(invoice_total_cents), 0) as total_cents
      FROM ingestion_runs
      WHERE ${invoiceWhereClause}
        AND status = 'completed'
        AND created_at >= datetime('now', '-' || ? || ' days')
    `).get(...invoiceParams);

    // Get invoice breakdown by vendor
    const invoicesByVendor = database.prepare(`
      SELECT
        COALESCE(vendor_name, 'Unknown') as category,
        SUM(invoice_total_cents) as amount
      FROM ingestion_runs
      WHERE ${invoiceWhereClause}
        AND status = 'completed'
        AND created_at >= datetime('now', '-' || ? || ' days')
      GROUP BY vendor_name
      ORDER BY amount DESC
    `).all(...invoiceParams);

    // Get expense breakdown by category
    const breakdown = database.prepare(`
      SELECT category, SUM(amount_cents) as amount
      FROM expense_entries
      WHERE user_id = ?
        AND period_start >= date('now', '-' || ? || ' days')
      GROUP BY category
      ORDER BY amount DESC
    `).all(user.id, days);

    // Add payroll as a category
    if (payrollTotal.total > 0) {
      breakdown.unshift({ category: 'Payroll', amount: payrollTotal.total });
    }

    // Add invoice vendors to breakdown
    invoicesByVendor.forEach(v => {
      if (v.amount > 0) {
        breakdown.push({ category: `Invoice: ${v.category}`, amount: v.amount });
      }
    });

    // Get daily spending trend (combine expenses and invoices)
    const trend = database.prepare(`
      SELECT
        period_start as date,
        SUM(amount_cents) as amount
      FROM expense_entries
      WHERE user_id = ?
        AND period_start >= date('now', '-' || ? || ' days')
      GROUP BY period_start
      ORDER BY period_start
    `).all(user.id, days);

    // Add invoice spending to trend (using same robust matching)
    const invoiceTrend = database.prepare(`
      SELECT
        DATE(created_at) as date,
        SUM(invoice_total_cents) as amount
      FROM ingestion_runs
      WHERE ${invoiceWhereClause}
        AND status = 'completed'
        AND created_at >= datetime('now', '-' || ? || ' days')
      GROUP BY DATE(created_at)
      ORDER BY date
    `).all(...invoiceParams);

    // Merge trends
    const trendMap = new Map();
    trend.forEach(t => trendMap.set(t.date, t.amount || 0));
    invoiceTrend.forEach(t => {
      const existing = trendMap.get(t.date) || 0;
      trendMap.set(t.date, existing + (t.amount || 0));
    });

    const mergedTrend = Array.from(trendMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, amount]) => ({
        date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        amount
      }));

    // Calculate total expenses including invoices
    const totalExpenses = expensesTotal.total + payrollTotal.total + (invoiceData.total_cents || 0);

    res.json({
      success: true,
      data: {
        totals: {
          expenses: totalExpenses,
          payroll: payrollTotal.total,
          inventory: 0,
          savings: savingsTotal.total,
          invoices: invoiceData.total_cents || 0,
          invoiceCount: invoiceData.invoice_count || 0
        },
        breakdown,
        trend: mergedTrend.length > 0 ? mergedTrend : trend.map(t => ({
          date: new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          amount: t.amount
        })),
        budget: []
      }
    });
  } catch (error) {
    console.error('[BI] Financial summary error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/bi/analytics/financial - Get financial analytics
router.get('/analytics/financial', (req, res) => {
  try {
    const user = getUserContext(req);
    const { period = '90' } = req.query;

    const database = db.getDatabase();

    // Get payroll summary
    const payrollSummary = database.prepare(`
      SELECT
        SUM(total_labor_cost_cents) as total_labor,
        AVG(total_labor_cost_cents) as avg_labor,
        SUM(overtime_cost_cents) as total_overtime,
        SUM(hours_worked) as total_hours,
        COUNT(*) as period_count
      FROM payroll_entries
      WHERE user_id = ?
        AND period_start >= date('now', '-' || ? || ' days')
    `).get(user.id, period);

    // Get expense summary by category
    const expensesByCategory = database.prepare(`
      SELECT
        category,
        SUM(amount_cents) as total_cents,
        COUNT(*) as count
      FROM expense_entries
      WHERE user_id = ?
        AND period_start >= date('now', '-' || ? || ' days')
      GROUP BY category
      ORDER BY total_cents DESC
    `).all(user.id, period);

    // Get weekly trends
    const weeklyTrends = database.prepare(`
      SELECT
        strftime('%Y-%W', p.period_start) as week,
        SUM(p.total_labor_cost_cents) as labor_cents,
        (
          SELECT SUM(e.amount_cents)
          FROM expense_entries e
          WHERE e.user_id = p.user_id
            AND strftime('%Y-%W', e.period_start) = strftime('%Y-%W', p.period_start)
        ) as expenses_cents
      FROM payroll_entries p
      WHERE p.user_id = ?
        AND p.period_start >= date('now', '-' || ? || ' days')
      GROUP BY strftime('%Y-%W', p.period_start)
      ORDER BY week
    `).all(user.id, period);

    // Calculate totals
    const totalExpenses = expensesByCategory.reduce((sum, cat) => sum + cat.total_cents, 0);
    const totalLabor = payrollSummary.total_labor || 0;
    const primeCoast = totalLabor + (expensesByCategory.find(c => c.category === 'cogs')?.total_cents || 0);

    res.json({
      success: true,
      data: {
        payroll: payrollSummary,
        expenses: {
          total: totalExpenses,
          byCategory: expensesByCategory
        },
        primeCost: primeCoast,
        weeklyTrends,
        laborVsExpenses: {
          labor_pct: totalLabor && totalExpenses ? Math.round(totalLabor / (totalLabor + totalExpenses) * 100) : 0,
          expenses_pct: totalLabor && totalExpenses ? Math.round(totalExpenses / (totalLabor + totalExpenses) * 100) : 0
        }
      }
    });
  } catch (error) {
    console.error('[BI] Financial analytics error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// GAMIFICATION / ACHIEVEMENTS
// =====================================================

// GET /api/bi/achievements - Get user achievements
router.get('/achievements', (req, res) => {
  try {
    const user = getUserContext(req);
    const database = db.getDatabase();

    const achievements = database.prepare(`
      SELECT * FROM user_achievements
      WHERE user_id = ?
      ORDER BY is_unlocked DESC, tier DESC, points DESC
    `).all(user.id);

    const streaks = database.prepare(`
      SELECT * FROM savings_streaks
      WHERE user_id = ?
    `).all(user.id);

    // Calculate total points
    const totalPoints = achievements.reduce((sum, a) => sum + (a.is_unlocked ? a.points : 0), 0);

    res.json({
      success: true,
      data: {
        achievements,
        streaks,
        totalPoints
      }
    });
  } catch (error) {
    console.error('[BI] Achievements fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// INVENTORY INTELLIGENCE ENDPOINTS
// =====================================================

// GET /api/bi/inventory/health - Get inventory health score
router.get('/inventory/health', (req, res) => {
  try {
    const user = getUserContext(req);
    const healthScore = inventoryIntelligence.getInventoryHealthScore(user.id);

    res.json({
      success: true,
      data: healthScore
    });
  } catch (error) {
    console.error('[BI] Health score error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/bi/inventory/stockout-alerts - Get predictive stockout alerts
router.get('/inventory/stockout-alerts', (req, res) => {
  try {
    const user = getUserContext(req);
    const { days = 14 } = req.query;

    const alerts = inventoryIntelligence.getStockoutAlerts(user.id, parseInt(days));

    res.json({
      success: true,
      data: alerts,
      count: alerts.length
    });
  } catch (error) {
    console.error('[BI] Stockout alerts error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/bi/inventory/purchase-order - Generate purchase order recommendations
router.get('/inventory/purchase-order', (req, res) => {
  try {
    const user = getUserContext(req);
    const { vendor } = req.query;

    const purchaseOrder = inventoryIntelligence.generatePurchaseOrder(user.id, vendor || null);

    res.json({
      success: true,
      data: purchaseOrder
    });
  } catch (error) {
    console.error('[BI] Purchase order error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/bi/inventory/dashboard - Get comprehensive inventory dashboard
router.get('/inventory/dashboard', (req, res) => {
  try {
    const user = getUserContext(req);
    const dashboardData = inventoryIntelligence.getDashboardData(user.id);

    res.json({
      success: true,
      data: dashboardData
    });
  } catch (error) {
    console.error('[BI] Dashboard error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/bi/suppliers - Get supplier performance report
router.get('/suppliers', (req, res) => {
  try {
    const user = getUserContext(req);
    const { vendor } = req.query;

    const report = inventoryIntelligence.getSupplierReport(user.id, vendor || null);

    res.json({
      success: true,
      data: report,
      count: report.length
    });
  } catch (error) {
    console.error('[BI] Supplier report error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/bi/suppliers/:name/trends - Get price trends for a specific supplier
router.get('/suppliers/:name/trends', (req, res) => {
  try {
    const user = getUserContext(req);
    const { name } = req.params;
    const { days = 90 } = req.query;

    const database = db.getDatabase();

    // Get price history for this vendor
    const priceHistory = database.prepare(`
      SELECT
        sku,
        unit_price_cents,
        quantity,
        created_at,
        DATE(created_at) as date
      FROM vendor_price_history
      WHERE user_id = ? AND vendor_name = ? AND sku != '__VENDOR_STATS__'
        AND created_at >= date('now', '-' || ? || ' days')
      ORDER BY sku, created_at DESC
    `).all(user.id, name, days);

    // Group by SKU and calculate trends
    const skuTrends = {};
    priceHistory.forEach(record => {
      if (!skuTrends[record.sku]) {
        skuTrends[record.sku] = {
          sku: record.sku,
          prices: [],
          latestPrice: null,
          earliestPrice: null,
          avgPrice: 0,
          priceChange: 0,
          priceChangePct: 0
        };
      }
      skuTrends[record.sku].prices.push({
        priceCents: record.unit_price_cents,
        quantity: record.quantity,
        date: record.date
      });
    });

    // Calculate trends for each SKU
    Object.values(skuTrends).forEach(sku => {
      if (sku.prices.length > 0) {
        sku.latestPrice = sku.prices[0].priceCents;
        sku.earliestPrice = sku.prices[sku.prices.length - 1].priceCents;
        sku.avgPrice = Math.round(sku.prices.reduce((sum, p) => sum + p.priceCents, 0) / sku.prices.length);
        sku.priceChange = sku.latestPrice - sku.earliestPrice;
        sku.priceChangePct = sku.earliestPrice > 0
          ? Math.round((sku.priceChange / sku.earliestPrice) * 1000) / 10
          : 0;
      }
    });

    // Sort by absolute price change
    const sortedTrends = Object.values(skuTrends)
      .sort((a, b) => Math.abs(b.priceChangePct) - Math.abs(a.priceChangePct));

    // Calculate overall vendor trend
    const allPriceChanges = sortedTrends.map(t => t.priceChangePct);
    const avgPriceChange = allPriceChanges.length > 0
      ? Math.round(allPriceChanges.reduce((a, b) => a + b, 0) / allPriceChanges.length * 10) / 10
      : 0;

    res.json({
      success: true,
      data: {
        vendor: name,
        period: `${days} days`,
        overallTrend: avgPriceChange > 2 ? 'increasing' : avgPriceChange < -2 ? 'decreasing' : 'stable',
        avgPriceChangePct: avgPriceChange,
        skuCount: sortedTrends.length,
        skuTrends: sortedTrends.slice(0, 50), // Top 50 by price change
        significantIncreases: sortedTrends.filter(t => t.priceChangePct > 5).length,
        significantDecreases: sortedTrends.filter(t => t.priceChangePct < -5).length
      }
    });
  } catch (error) {
    console.error('[BI] Supplier trends error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/bi/inventory/usage/bulk - Record bulk usage from snapshot
router.post('/inventory/usage/bulk', (req, res) => {
  try {
    const user = getUserContext(req);
    const { counts, previous_snapshot_id } = req.body;

    if (!counts || typeof counts !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'counts object required (sku -> quantity)'
      });
    }

    const usageRecords = inventoryIntelligence.recordUsageFromSnapshot(
      user.id,
      counts,
      previous_snapshot_id || null
    );

    res.json({
      success: true,
      data: {
        recorded: usageRecords.length,
        consumed: usageRecords.filter(r => r.type === 'consumed').length,
        received: usageRecords.filter(r => r.type === 'received').length,
        details: usageRecords
      }
    });
  } catch (error) {
    console.error('[BI] Bulk usage error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/bi/price-alerts - Get recent price change alerts
router.get('/price-alerts', (req, res) => {
  try {
    const user = getUserContext(req);
    const { days = 30, threshold = 5 } = req.query;

    const database = db.getDatabase();

    // Get items with price history showing significant changes
    const priceAlerts = database.prepare(`
      WITH price_changes AS (
        SELECT
          vph1.sku,
          vph1.vendor_name,
          vph1.unit_price_cents as current_price,
          vph2.unit_price_cents as previous_price,
          vph1.created_at as current_date,
          vph2.created_at as previous_date,
          ROUND(((vph1.unit_price_cents - vph2.unit_price_cents) * 100.0 / vph2.unit_price_cents), 1) as pct_change
        FROM vendor_price_history vph1
        JOIN vendor_price_history vph2 ON vph1.user_id = vph2.user_id
          AND vph1.sku = vph2.sku
          AND vph1.vendor_name = vph2.vendor_name
          AND vph2.created_at < vph1.created_at
        WHERE vph1.user_id = ?
          AND vph1.sku != '__VENDOR_STATS__'
          AND vph1.created_at >= date('now', '-' || ? || ' days')
          AND vph2.created_at = (
            SELECT MAX(created_at)
            FROM vendor_price_history
            WHERE user_id = vph1.user_id
              AND sku = vph1.sku
              AND vendor_name = vph1.vendor_name
              AND created_at < vph1.created_at
          )
      )
      SELECT * FROM price_changes
      WHERE ABS(pct_change) >= ?
      ORDER BY ABS(pct_change) DESC
      LIMIT 100
    `).all(user.id, days, threshold);

    // Categorize alerts
    const increases = priceAlerts.filter(a => a.pct_change > 0);
    const decreases = priceAlerts.filter(a => a.pct_change < 0);

    res.json({
      success: true,
      data: {
        alerts: priceAlerts,
        summary: {
          total: priceAlerts.length,
          increases: increases.length,
          decreases: decreases.length,
          avgIncrease: increases.length > 0
            ? Math.round(increases.reduce((s, a) => s + a.pct_change, 0) / increases.length * 10) / 10
            : 0,
          avgDecrease: decreases.length > 0
            ? Math.round(decreases.reduce((s, a) => s + a.pct_change, 0) / decreases.length * 10) / 10
            : 0
        }
      }
    });
  } catch (error) {
    console.error('[BI] Price alerts error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/bi/inventory/analyze - Trigger full inventory analysis
router.post('/inventory/analyze', async (req, res) => {
  try {
    const user = getUserContext(req);

    // Run reorder engine
    const recommendations = await reorderEngine.generateRecommendations(user.id);

    // Get updated health score
    const healthScore = inventoryIntelligence.getInventoryHealthScore(user.id);

    // Get stockout alerts
    const stockoutAlerts = inventoryIntelligence.getStockoutAlerts(user.id, 14);

    res.json({
      success: true,
      data: {
        recommendations: recommendations.length,
        healthScore,
        stockoutAlerts: stockoutAlerts.length,
        criticalAlerts: stockoutAlerts.filter(a => a.severity === 'critical').length,
        analyzedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('[BI] Inventory analysis error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/bi/inventory/send-alerts - Send stockout alert emails
router.post('/inventory/send-alerts', async (req, res) => {
  try {
    const user = getUserContext(req);
    const { threshold = 7 } = req.body; // Default to 7 days

    // Get stockout alerts
    const alerts = inventoryIntelligence.getStockoutAlerts(user.id, threshold);

    if (alerts.length === 0) {
      return res.json({
        success: true,
        data: { sent: false, message: 'No stockout alerts to send' }
      });
    }

    // Get user details
    const userDetails = db.getUserById(user.id);
    if (!userDetails || !userDetails.email) {
      return res.status(400).json({
        success: false,
        error: 'User email not found'
      });
    }

    // Send alert email
    const result = await emailService.sendStockoutAlertEmail(
      userDetails.email,
      userDetails.name,
      alerts
    );

    res.json({
      success: true,
      data: {
        sent: true,
        alertCount: alerts.length,
        criticalCount: alerts.filter(a => a.severity === 'critical').length,
        emailResult: result
      }
    });
  } catch (error) {
    console.error('[BI] Send alerts error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/bi/inventory/send-digest - Send daily inventory digest email
router.post('/inventory/send-digest', async (req, res) => {
  try {
    const user = getUserContext(req);

    // Get user details
    const userDetails = db.getUserById(user.id);
    if (!userDetails || !userDetails.email) {
      return res.status(400).json({
        success: false,
        error: 'User email not found'
      });
    }

    // Gather digest data
    const dashboardData = inventoryIntelligence.getDashboardData(user.id);

    // Send digest email
    const result = await emailService.sendInventoryDigestEmail(
      userDetails.email,
      userDetails.name,
      {
        healthScore: dashboardData.healthScore,
        stockoutAlerts: dashboardData.stockoutAlerts,
        recommendations: dashboardData.recommendations,
        stats: dashboardData.stats
      }
    );

    res.json({
      success: true,
      data: {
        sent: true,
        healthScore: dashboardData.healthScore.grade,
        alertCount: dashboardData.stockoutAlerts?.length || 0,
        emailResult: result
      }
    });
  } catch (error) {
    console.error('[BI] Send digest error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/bi/inventory/export-po - Export purchase order as downloadable format
router.get('/inventory/export-po', (req, res) => {
  try {
    const user = getUserContext(req);
    const { vendor, format = 'json' } = req.query;

    const purchaseOrder = inventoryIntelligence.generatePurchaseOrder(user.id, vendor || null);

    if (format === 'csv') {
      // Generate CSV
      const headers = ['SKU', 'Product Name', 'Category', 'Current Qty', 'Order Qty', 'Unit Price', 'Line Total', 'Priority', 'Vendor'];
      const rows = purchaseOrder.lineItems.map(item => [
        item.sku,
        item.productName,
        item.category,
        item.currentQty,
        item.orderQty,
        (item.unitPriceCents / 100).toFixed(2),
        (item.lineTotalCents / 100).toFixed(2),
        item.priority,
        item.vendor
      ]);

      const csv = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${String(cell || '').replace(/"/g, '""')}"`).join(','))
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="purchase-order-${new Date().toISOString().split('T')[0]}.csv"`);
      return res.send(csv);
    }

    res.json({
      success: true,
      data: purchaseOrder
    });
  } catch (error) {
    console.error('[BI] Export PO error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// SMART ORDERING ENDPOINTS
// =====================================================

const SmartOrderingEngine = require('./smart-ordering-engine');
const smartOrderingEngine = new SmartOrderingEngine();

// GET /api/bi/smart-ordering - Get smart ordering insights
router.get('/smart-ordering', async (req, res) => {
  try {
    const user = getUserContext(req);
    const { type, limit = 10, urgency } = req.query;

    // Generate insights
    const allInsights = await smartOrderingEngine.generateInsights(user.id);

    // Filter by type if specified
    let filtered = allInsights;
    if (type) {
      filtered = filtered.filter(i => i.insight_type === type);
    }
    if (urgency) {
      filtered = filtered.filter(i => i.urgency === urgency);
    }

    // Sort by urgency then confidence
    const urgencyOrder = { high: 0, medium: 1, low: 2 };
    filtered.sort((a, b) => {
      const urgencyDiff = (urgencyOrder[a.urgency] || 3) - (urgencyOrder[b.urgency] || 3);
      if (urgencyDiff !== 0) return urgencyDiff;
      return (b.confidence_score || 0) - (a.confidence_score || 0);
    });

    // Apply limit
    const limited = filtered.slice(0, parseInt(limit));

    // Calculate summary stats
    const summary = {
      total_insights: allInsights.length,
      by_type: {
        reorder_prediction: allInsights.filter(i => i.insight_type === 'reorder_prediction').length,
        bulk_consolidation: allInsights.filter(i => i.insight_type === 'bulk_consolidation').length,
        usage_forecast: allInsights.filter(i => i.insight_type === 'usage_forecast').length,
        low_stock_risk: allInsights.filter(i => i.insight_type === 'low_stock_risk').length
      },
      by_urgency: {
        high: allInsights.filter(i => i.urgency === 'high').length,
        medium: allInsights.filter(i => i.urgency === 'medium').length,
        low: allInsights.filter(i => i.urgency === 'low').length
      },
      total_potential_savings_cents: allInsights
        .filter(i => i.insight_type === 'bulk_consolidation')
        .reduce((sum, i) => sum + (i.estimated_value_cents || 0), 0)
    };

    res.json({
      success: true,
      data: limited,
      summary,
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('[BI] Smart ordering error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/bi/smart-ordering/summary - Quick summary for dashboard widgets
router.get('/smart-ordering/summary', async (req, res) => {
  try {
    const user = getUserContext(req);
    const insights = await smartOrderingEngine.generateInsights(user.id);

    const summary = {
      reorder_alerts: insights.filter(i =>
        i.insight_type === 'reorder_prediction' && i.urgency !== 'low'
      ).length,
      bulk_opportunities: insights.filter(i =>
        i.insight_type === 'bulk_consolidation'
      ).length,
      potential_savings_cents: insights
        .filter(i => i.insight_type === 'bulk_consolidation')
        .reduce((sum, i) => sum + (i.estimated_value_cents || 0), 0),
      usage_alerts: insights.filter(i =>
        i.insight_type === 'low_stock_risk' || i.insight_type === 'usage_forecast'
      ).length,
      high_priority_count: insights.filter(i => i.urgency === 'high').length
    };

    res.json({ success: true, data: summary });
  } catch (error) {
    console.error('[BI] Smart ordering summary error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/bi/smart-ordering/tonight - Time-sensitive insights for today
router.get('/smart-ordering/tonight', async (req, res) => {
  try {
    const user = getUserContext(req);
    const { limit = 10 } = req.query;

    // Get tonight-relevant insights
    const insights = await smartOrderingEngine.getTonightInsights(user.id);
    const limited = insights.slice(0, parseInt(limit));

    // Calculate summary
    const summary = {
      total_insights: insights.length,
      high_priority: insights.filter(i => i.urgency === 'high').length,
      total_action_value_cents: insights.reduce((sum, i) => sum + (i.estimated_value_cents || 0), 0),
      by_type: insights.reduce((acc, i) => {
        acc[i.insight_type] = (acc[i.insight_type] || 0) + 1;
        return acc;
      }, {})
    };

    res.json({
      success: true,
      data: limited,
      summary,
      view: 'tonight',
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('[BI] Tonight insights error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/bi/smart-ordering/this-week - Week planning insights
router.get('/smart-ordering/this-week', async (req, res) => {
  try {
    const user = getUserContext(req);
    const { limit = 15 } = req.query;

    // Get this-week-relevant insights
    const insights = await smartOrderingEngine.getThisWeekInsights(user.id);
    const limited = insights.slice(0, parseInt(limit));

    // Calculate summary
    const summary = {
      total_insights: insights.length,
      high_priority: insights.filter(i => i.urgency === 'high').length,
      medium_priority: insights.filter(i => i.urgency === 'medium').length,
      total_potential_savings_cents: insights.reduce((sum, i) => sum + (i.estimated_value_cents || 0), 0),
      by_type: insights.reduce((acc, i) => {
        acc[i.insight_type] = (acc[i.insight_type] || 0) + 1;
        return acc;
      }, {}),
      categories: {
        pricing: insights.filter(i => ['margin_erosion', 'pricing_recommendation', 'cogs_spike_alert'].includes(i.insight_type)).length,
        vendor: insights.filter(i => ['vendor_alternative_found', 'supplier_reliability', 'vendor_consolidation'].includes(i.insight_type)).length,
        demand: insights.filter(i => ['seasonal_demand', 'demand_forecast_7day'].includes(i.insight_type)).length,
        ordering: insights.filter(i => ['bulk_consolidation', 'budget_pacing'].includes(i.insight_type)).length
      }
    };

    res.json({
      success: true,
      data: limited,
      summary,
      view: 'this_week',
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('[BI] This week insights error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// VENDOR ANALYSIS ENDPOINTS
// =====================================================

// GET /api/bi/vendors - Comprehensive vendor scorecard list
router.get('/vendors', (req, res) => {
  try {
    const user = getUserContext(req);
    const { sort = 'spend', order = 'desc', limit = 50 } = req.query;

    let vendors = smartOrderingEngine.calculateVendorScorecard(user.id);

    // Sort by requested field
    const sortKey = {
      'spend': 'total_spend_cents',
      'score': 'overall_score',
      'price': 'price_score',
      'name': 'vendor_name',
      'invoices': 'invoice_count',
      'trend': 'price_trend.change_pct'
    }[sort] || 'total_spend_cents';

    vendors.sort((a, b) => {
      let aVal = sortKey.includes('.') ? a.price_trend?.change_pct : a[sortKey];
      let bVal = sortKey.includes('.') ? b.price_trend?.change_pct : b[sortKey];
      if (typeof aVal === 'string') {
        return order === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return order === 'asc' ? (aVal || 0) - (bVal || 0) : (bVal || 0) - (aVal || 0);
    });

    // Calculate summary metrics
    const totalSpend = vendors.reduce((sum, v) => sum + (v.total_spend_cents || 0), 0);
    const avgScore = vendors.length > 0
      ? Math.round(vendors.reduce((sum, v) => sum + v.overall_score, 0) / vendors.length)
      : 0;
    const totalSavingsPotential = vendors.reduce((sum, v) => {
      const premium = v.price_competitiveness?.avg_premium_pct || 0;
      return sum + Math.round(v.total_spend_cents * premium / 100);
    }, 0);
    const increasingPrices = vendors.filter(v => v.price_trend?.direction === 'increasing').length;
    const decreasingPrices = vendors.filter(v => v.price_trend?.direction === 'decreasing').length;

    res.json({
      success: true,
      data: vendors.slice(0, parseInt(limit)),
      count: vendors.length,
      summary: {
        total_vendors: vendors.length,
        total_spend_cents: totalSpend,
        avg_vendor_score: avgScore,
        savings_potential_cents: totalSavingsPotential,
        price_trends: {
          increasing: increasingPrices,
          stable: vendors.length - increasingPrices - decreasingPrices,
          decreasing: decreasingPrices
        }
      }
    });
  } catch (error) {
    console.error('[BI] Vendor scorecard error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/bi/vendors/compare - SKU price comparison across vendors
router.get('/vendors/compare', (req, res) => {
  try {
    const user = getUserContext(req);
    const { min_vendors = 2 } = req.query;

    const comparison = smartOrderingEngine.getSkuPriceComparison(user.id, parseInt(min_vendors));

    // Calculate savings potential
    const totalSavings = comparison.reduce((sum, c) => sum + (c.potential_savings_cents || 0), 0);

    res.json({
      success: true,
      data: comparison,
      count: comparison.length,
      summary: {
        comparable_skus: comparison.length,
        total_savings_potential_cents: totalSavings,
        avg_spread_pct: comparison.length > 0
          ? Math.round(comparison.reduce((sum, c) => sum + c.spread_pct, 0) / comparison.length * 10) / 10
          : 0
      }
    });
  } catch (error) {
    console.error('[BI] Vendor compare error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/bi/vendors/spend-analysis - Pareto & concentration analysis
router.get('/vendors/spend-analysis', (req, res) => {
  try {
    const user = getUserContext(req);
    const analysis = smartOrderingEngine.analyzeVendorPareto(user.id);

    res.json({
      success: true,
      data: analysis
    });
  } catch (error) {
    console.error('[BI] Spend analysis error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/bi/vendors/risk-assessment - Supply chain risk
router.get('/vendors/risk-assessment', (req, res) => {
  try {
    const user = getUserContext(req);
    const singleSource = smartOrderingEngine.identifySingleSourceItems(user.id);
    const pareto = smartOrderingEngine.analyzeVendorPareto(user.id);

    // Calculate overall risk score (0-100)
    let riskScore = 0;
    if (pareto.concentration_risk === 'high') riskScore += 40;
    else if (pareto.concentration_risk === 'medium') riskScore += 20;
    if (singleSource.single_source_count > 10) riskScore += 30;
    else if (singleSource.single_source_count > 5) riskScore += 15;
    if (pareto.vendors[0]?.spend_pct > 50) riskScore += 20;
    else if (pareto.vendors[0]?.spend_pct > 35) riskScore += 10;

    const riskLevel = riskScore >= 60 ? 'high' : riskScore >= 30 ? 'medium' : 'low';

    res.json({
      success: true,
      data: {
        overall_risk_score: Math.min(100, riskScore),
        overall_risk_level: riskLevel,
        concentration: {
          risk: pareto.concentration_risk,
          hhi: pareto.concentration_hhi,
          top_vendor: pareto.vendors[0]?.vendor_name,
          top_vendor_pct: pareto.vendors[0]?.spend_pct || 0,
          pareto_80_count: pareto.pareto_80_count,
          pareto_80_vendors: pareto.pareto_80_vendors
        },
        single_source: singleSource,
        recommendations: [
          riskScore >= 60 ? 'Critical: Diversify your vendor base to reduce supply chain risk' : null,
          pareto.vendors[0]?.spend_pct > 50 ? `Consider alternatives to ${pareto.vendors[0].vendor_name} (${pareto.vendors[0].spend_pct}% of spend)` : null,
          singleSource.single_source_count > 5 ? `${singleSource.single_source_count} items only available from one vendor - find backup suppliers` : null
        ].filter(Boolean)
      }
    });
  } catch (error) {
    console.error('[BI] Risk assessment error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/bi/vendors/categories - Category-level vendor analysis
router.get('/vendors/categories', (req, res) => {
  try {
    const user = getUserContext(req);
    const categories = smartOrderingEngine.analyzeVendorByCategory(user.id);

    res.json({
      success: true,
      data: categories,
      count: categories.length
    });
  } catch (error) {
    console.error('[BI] Category analysis error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/bi/vendors/:name - Individual vendor deep-dive
router.get('/vendors/:name', (req, res) => {
  try {
    const user = getUserContext(req);
    const vendorName = decodeURIComponent(req.params.name);

    const scorecards = smartOrderingEngine.calculateVendorScorecard(user.id, vendorName);
    const scorecard = scorecards[0];

    if (!scorecard) {
      return res.status(404).json({ success: false, error: 'Vendor not found' });
    }

    const priceTrends = smartOrderingEngine.getVendorPriceTrends(user.id, vendorName, 90);
    const topItems = smartOrderingEngine.getVendorTopItems(user.id, vendorName, 20);

    res.json({
      success: true,
      data: {
        scorecard,
        price_trends: priceTrends,
        top_items: topItems
      }
    });
  } catch (error) {
    console.error('[BI] Vendor detail error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/bi/vendors/:name/price-history - Price trends for charts
router.get('/vendors/:name/price-history', (req, res) => {
  try {
    const user = getUserContext(req);
    const vendorName = decodeURIComponent(req.params.name);
    const days = parseInt(req.query.days) || 90;

    const trends = smartOrderingEngine.getVendorPriceTrends(user.id, vendorName, days);

    res.json({ success: true, data: trends });
  } catch (error) {
    console.error('[BI] Price history error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/bi/vendors/:name/items - Vendor's top items
router.get('/vendors/:name/items', (req, res) => {
  try {
    const user = getUserContext(req);
    const vendorName = decodeURIComponent(req.params.name);
    const limit = parseInt(req.query.limit) || 50;

    const items = smartOrderingEngine.getVendorTopItems(user.id, vendorName, limit);

    res.json({
      success: true,
      data: items,
      count: items.length
    });
  } catch (error) {
    console.error('[BI] Vendor items error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/bi/vendors/:name/negotiation-brief - Negotiation prep data
router.get('/vendors/:name/negotiation-brief', (req, res) => {
  try {
    const user = getUserContext(req);
    const vendorName = decodeURIComponent(req.params.name);

    const brief = smartOrderingEngine.generateNegotiationBrief(user.id, vendorName);

    res.json({ success: true, data: brief });
  } catch (error) {
    console.error('[BI] Negotiation brief error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
