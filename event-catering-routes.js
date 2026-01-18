/**
 * Revenue Radar - Events & Catering API Routes
 *
 * Endpoints for:
 * - Private event planning and management
 * - Catering orders and profitability tracking
 * - Smart recommendations for quantities and timing
 * - Document upload and parsing
 */

const express = require('express');
const db = require('./database');
const multer = require('multer');
const path = require('path');

const router = express.Router();

// File upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'event-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.txt', '.doc', '.docx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// Middleware to get user context from JWT
function getUserContext(req) {
  // From JWT auth middleware
  if (req.user && req.user.id) {
    return req.user;
  }

  // Fallback for header-based auth
  const userEmail = req.headers['x-user-email'];
  if (userEmail) {
    const database = db.getDatabase();
    const user = database.prepare('SELECT * FROM users WHERE email = ?').get(userEmail);
    if (user) return user;
  }

  return null;
}

// Per-person consumption rates by category
const perPersonRates = {
  wine: 0.5,
  beer: 1.5,
  spirits: 0.15,
  champagne: 0.3,
  appetizers: 6,
  entrees: 1,
  desserts: 1.2,
  beverages: 2
};

// Event type multipliers
const eventTypeMultipliers = {
  wedding_reception: { wine: 1.5, champagne: 1.5, appetizers: 1.2 },
  corporate_lunch: { spirits: 0.3, wine: 0.5, appetizers: 0.8 },
  birthday_party: { beer: 1.3, desserts: 1.5 },
  cocktail_party: { spirits: 1.5, appetizers: 1.8, entrees: 0 },
  holiday_party: { wine: 1.3, spirits: 1.4, appetizers: 1.3 }
};

// Lead time requirements (days before event)
const leadTimes = {
  spirits: 7,
  wine: 7,
  beer: 5,
  fresh_produce: 2,
  meat: 3,
  seafood: 2,
  dry_goods: 14,
  specialty_items: 21
};

// Bulk discount thresholds
const bulkThresholds = {
  wine: { quantity: 12, discount: 0.15 },
  spirits: { quantity: 12, discount: 0.10 },
  beer: { quantity: 48, discount: 0.12 }
};

// =====================================================
// EVENTS ENDPOINTS
// =====================================================

// GET /api/events/summary - Summary for dashboard tile
router.get('/events/summary', (req, res) => {
  try {
    const user = getUserContext(req);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const database = db.getDatabase();

    // Get upcoming events count
    const upcoming = database.prepare(`
      SELECT COUNT(*) as count FROM events
      WHERE user_id = ? AND status IN ('planning', 'confirmed') AND event_date >= date('now')
    `).get(user.id);

    // Get next event
    const nextEvent = database.prepare(`
      SELECT event_name, event_date FROM events
      WHERE user_id = ? AND status IN ('planning', 'confirmed') AND event_date >= date('now')
      ORDER BY event_date ASC LIMIT 1
    `).get(user.id);

    // Get this month's revenue
    const revenue = database.prepare(`
      SELECT COALESCE(SUM(revenue_cents), 0) as total FROM events
      WHERE user_id = ? AND strftime('%Y-%m', event_date) = strftime('%Y-%m', 'now')
    `).get(user.id);

    res.json({
      success: true,
      data: {
        upcomingCount: upcoming?.count || 0,
        nextEvent: nextEvent ? {
          name: nextEvent.event_name,
          date: nextEvent.event_date
        } : null,
        monthRevenue: revenue?.total || 0
      }
    });
  } catch (error) {
    console.error('[Events] Summary error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/events - List all events
router.get('/events', (req, res) => {
  try {
    const user = getUserContext(req);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { status, type, from_date, to_date } = req.query;
    const database = db.getDatabase();

    let query = 'SELECT * FROM events WHERE user_id = ?';
    const params = [user.id];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    if (type) {
      query += ' AND event_type = ?';
      params.push(type);
    }
    if (from_date) {
      query += ' AND event_date >= ?';
      params.push(from_date);
    }
    if (to_date) {
      query += ' AND event_date <= ?';
      params.push(to_date);
    }

    query += ' ORDER BY event_date ASC';

    const events = database.prepare(query).all(...params);

    res.json({
      success: true,
      data: events,
      count: events.length
    });
  } catch (error) {
    console.error('[Events] List error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/events/:id - Get single event with items
router.get('/events/:id', (req, res) => {
  try {
    const user = getUserContext(req);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const database = db.getDatabase();

    const event = database.prepare(`
      SELECT * FROM events WHERE id = ? AND user_id = ?
    `).get(req.params.id, user.id);

    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    // Get event items
    const items = database.prepare(`
      SELECT * FROM event_items WHERE event_id = ?
    `).all(event.id);

    // Get recommendations
    const recommendations = database.prepare(`
      SELECT * FROM event_recommendations
      WHERE event_id = ? AND is_dismissed = 0
      ORDER BY
        CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END
    `).all(event.id);

    res.json({
      success: true,
      data: {
        ...event,
        items,
        recommendations
      }
    });
  } catch (error) {
    console.error('[Events] Get error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/events - Create new event
router.post('/events', (req, res) => {
  try {
    const user = getUserContext(req);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const {
      event_name, event_type, event_date, event_time, duration_hours,
      guest_count, venue_type, venue_name, budget_cents,
      contact_name, contact_email, contact_phone,
      dietary_vegetarian, dietary_vegan, dietary_gluten_free, dietary_other,
      notes, special_requests, template_id
    } = req.body;

    if (!event_name || !event_date || !guest_count) {
      return res.status(400).json({
        success: false,
        error: 'Event name, date, and guest count are required'
      });
    }

    const database = db.getDatabase();

    // If creating from template, get template items
    let templateItems = [];
    if (template_id) {
      const template = database.prepare(`
        SELECT * FROM event_templates WHERE id = ?
      `).get(template_id);

      if (template && template.default_items) {
        templateItems = JSON.parse(template.default_items);
      }
    }

    // Create event
    const result = database.prepare(`
      INSERT INTO events (
        user_id, event_name, event_type, event_date, event_time, duration_hours,
        guest_count, venue_type, venue_name, budget_cents,
        contact_name, contact_email, contact_phone,
        dietary_vegetarian, dietary_vegan, dietary_gluten_free, dietary_other,
        notes, special_requests
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user.id, event_name, event_type || 'other', event_date, event_time,
      duration_hours || 4, guest_count, venue_type, venue_name, budget_cents,
      contact_name, contact_email, contact_phone,
      dietary_vegetarian || 0, dietary_vegan || 0, dietary_gluten_free || 0, dietary_other,
      notes, special_requests
    );

    const eventId = result.lastInsertRowid;

    // Add template items with calculated quantities
    if (templateItems.length > 0) {
      const insertItem = database.prepare(`
        INSERT INTO event_items (event_id, item_name, category, quantity_needed, unit_of_measure)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (const item of templateItems) {
        const baseQuantity = item.quantity_per_guest * guest_count;
        const multiplier = eventTypeMultipliers[event_type]?.[item.category] || 1;
        const quantity = Math.ceil(baseQuantity * multiplier * 1.1); // 10% buffer

        insertItem.run(eventId, item.name, item.category, quantity, 'servings');
      }
    }

    // Generate initial recommendations
    generateEventRecommendations(eventId, user.id, database);

    const newEvent = database.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
    const items = database.prepare('SELECT * FROM event_items WHERE event_id = ?').all(eventId);

    res.json({
      success: true,
      data: { ...newEvent, items }
    });
  } catch (error) {
    console.error('[Events] Create error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/events/:id - Update event
router.put('/events/:id', (req, res) => {
  try {
    const user = getUserContext(req);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const database = db.getDatabase();

    // Verify ownership
    const existing = database.prepare(`
      SELECT id FROM events WHERE id = ? AND user_id = ?
    `).get(req.params.id, user.id);

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    const {
      event_name, event_type, event_date, event_time, duration_hours,
      guest_count, guest_count_confirmed, venue_type, venue_name, status,
      budget_cents, estimated_cost_cents, actual_cost_cents, revenue_cents,
      contact_name, contact_email, contact_phone,
      dietary_vegetarian, dietary_vegan, dietary_gluten_free, dietary_other,
      notes, special_requests
    } = req.body;

    database.prepare(`
      UPDATE events SET
        event_name = COALESCE(?, event_name),
        event_type = COALESCE(?, event_type),
        event_date = COALESCE(?, event_date),
        event_time = COALESCE(?, event_time),
        duration_hours = COALESCE(?, duration_hours),
        guest_count = COALESCE(?, guest_count),
        guest_count_confirmed = COALESCE(?, guest_count_confirmed),
        venue_type = COALESCE(?, venue_type),
        venue_name = COALESCE(?, venue_name),
        status = COALESCE(?, status),
        budget_cents = COALESCE(?, budget_cents),
        estimated_cost_cents = COALESCE(?, estimated_cost_cents),
        actual_cost_cents = COALESCE(?, actual_cost_cents),
        revenue_cents = COALESCE(?, revenue_cents),
        contact_name = COALESCE(?, contact_name),
        contact_email = COALESCE(?, contact_email),
        contact_phone = COALESCE(?, contact_phone),
        dietary_vegetarian = COALESCE(?, dietary_vegetarian),
        dietary_vegan = COALESCE(?, dietary_vegan),
        dietary_gluten_free = COALESCE(?, dietary_gluten_free),
        dietary_other = COALESCE(?, dietary_other),
        notes = COALESCE(?, notes),
        special_requests = COALESCE(?, special_requests),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      event_name, event_type, event_date, event_time, duration_hours,
      guest_count, guest_count_confirmed, venue_type, venue_name, status,
      budget_cents, estimated_cost_cents, actual_cost_cents, revenue_cents,
      contact_name, contact_email, contact_phone,
      dietary_vegetarian, dietary_vegan, dietary_gluten_free, dietary_other,
      notes, special_requests, req.params.id
    );

    // Regenerate recommendations if guest count changed
    if (guest_count) {
      generateEventRecommendations(req.params.id, user.id, database);
    }

    const updated = database.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);

    res.json({
      success: true,
      data: updated
    });
  } catch (error) {
    console.error('[Events] Update error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/events/:id - Delete/cancel event
router.delete('/events/:id', (req, res) => {
  try {
    const user = getUserContext(req);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const database = db.getDatabase();

    const result = database.prepare(`
      UPDATE events SET status = 'cancelled', updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).run(req.params.id, user.id);

    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[Events] Delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/events/:id/items - Add items to event
router.post('/events/:id/items', (req, res) => {
  try {
    const user = getUserContext(req);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const database = db.getDatabase();

    // Verify ownership
    const event = database.prepare(`
      SELECT * FROM events WHERE id = ? AND user_id = ?
    `).get(req.params.id, user.id);

    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    const { items } = req.body;

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ success: false, error: 'Items array required' });
    }

    const insertItem = database.prepare(`
      INSERT INTO event_items (
        event_id, inventory_item_id, item_name, category, quantity_needed,
        unit_of_measure, unit_cost_cents, estimated_cost_cents, vendor_name, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertedIds = [];

    for (const item of items) {
      const result = insertItem.run(
        req.params.id, item.inventory_item_id, item.item_name, item.category,
        item.quantity_needed, item.unit_of_measure || 'each',
        item.unit_cost_cents, item.estimated_cost_cents, item.vendor_name, item.notes
      );
      insertedIds.push(result.lastInsertRowid);
    }

    // Regenerate recommendations
    generateEventRecommendations(req.params.id, user.id, database);

    const newItems = database.prepare(`
      SELECT * FROM event_items WHERE id IN (${insertedIds.join(',')})
    `).all();

    res.json({
      success: true,
      data: newItems
    });
  } catch (error) {
    console.error('[Events] Add items error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/events/:id/recommendations - Get recommendations
router.get('/events/:id/recommendations', (req, res) => {
  try {
    const user = getUserContext(req);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const database = db.getDatabase();

    // Verify ownership
    const event = database.prepare(`
      SELECT id FROM events WHERE id = ? AND user_id = ?
    `).get(req.params.id, user.id);

    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    const recommendations = database.prepare(`
      SELECT * FROM event_recommendations
      WHERE event_id = ? AND is_dismissed = 0
      ORDER BY
        CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END
    `).all(req.params.id);

    res.json({
      success: true,
      data: recommendations
    });
  } catch (error) {
    console.error('[Events] Recommendations error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/events/:id/generate-recommendations - Regenerate recommendations
router.post('/events/:id/generate-recommendations', (req, res) => {
  try {
    const user = getUserContext(req);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const database = db.getDatabase();

    const event = database.prepare(`
      SELECT * FROM events WHERE id = ? AND user_id = ?
    `).get(req.params.id, user.id);

    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    // Clear old recommendations
    database.prepare(`
      DELETE FROM event_recommendations WHERE event_id = ?
    `).run(req.params.id);

    // Generate new ones
    const count = generateEventRecommendations(req.params.id, user.id, database);

    const recommendations = database.prepare(`
      SELECT * FROM event_recommendations WHERE event_id = ?
      ORDER BY CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END
    `).all(req.params.id);

    res.json({
      success: true,
      data: recommendations,
      generated: count
    });
  } catch (error) {
    console.error('[Events] Generate recommendations error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/events/:id/complete - Mark event complete and save to history
router.post('/events/:id/complete', (req, res) => {
  try {
    const user = getUserContext(req);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { guest_count_actual, actual_cost_cents, revenue_cents, waste_pct, satisfaction_rating, lessons_learned } = req.body;

    const database = db.getDatabase();

    const event = database.prepare(`
      SELECT * FROM events WHERE id = ? AND user_id = ?
    `).get(req.params.id, user.id);

    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    // Update event status
    database.prepare(`
      UPDATE events SET
        status = 'completed',
        guest_count_confirmed = COALESCE(?, guest_count_confirmed),
        actual_cost_cents = COALESCE(?, actual_cost_cents),
        revenue_cents = COALESCE(?, revenue_cents),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(guest_count_actual, actual_cost_cents, revenue_cents, req.params.id);

    // Get item count
    const itemCount = database.prepare(`
      SELECT COUNT(*) as count FROM event_items WHERE event_id = ?
    `).get(req.params.id);

    // Save to history for learning
    database.prepare(`
      INSERT INTO event_history (
        user_id, event_id, event_type, guest_count_planned, guest_count_actual,
        items_count, total_cost_cents, revenue_cents, profit_cents,
        waste_pct, satisfaction_rating, lessons_learned
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user.id, req.params.id, event.event_type,
      event.guest_count, guest_count_actual || event.guest_count,
      itemCount?.count || 0,
      actual_cost_cents || event.actual_cost_cents,
      revenue_cents || event.revenue_cents,
      (revenue_cents || 0) - (actual_cost_cents || 0),
      waste_pct, satisfaction_rating, lessons_learned
    );

    res.json({ success: true });
  } catch (error) {
    console.error('[Events] Complete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// CATERING ENDPOINTS
// =====================================================

// GET /api/catering/summary - Summary for dashboard tile
router.get('/catering/summary', (req, res) => {
  try {
    const user = getUserContext(req);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const database = db.getDatabase();

    // Get active orders count
    const active = database.prepare(`
      SELECT COUNT(*) as count FROM catering_orders
      WHERE user_id = ? AND status IN ('draft', 'quoted', 'confirmed', 'preparing')
    `).get(user.id);

    // Get this month's revenue
    const revenue = database.prepare(`
      SELECT COALESCE(SUM(selling_price_cents), 0) as total FROM catering_orders
      WHERE user_id = ? AND status = 'completed'
      AND strftime('%Y-%m', order_date) = strftime('%Y-%m', 'now')
    `).get(user.id);

    // Get average profit margin
    const margin = database.prepare(`
      SELECT AVG(profit_margin_pct) as avg_margin FROM catering_orders
      WHERE user_id = ? AND status = 'completed' AND profit_margin_pct IS NOT NULL
    `).get(user.id);

    res.json({
      success: true,
      data: {
        activeCount: active?.count || 0,
        monthRevenue: revenue?.total || 0,
        avgMargin: margin?.avg_margin || 0
      }
    });
  } catch (error) {
    console.error('[Catering] Summary error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/catering - List catering orders
router.get('/catering', (req, res) => {
  try {
    const user = getUserContext(req);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { status, from_date, to_date } = req.query;
    const database = db.getDatabase();

    let query = 'SELECT * FROM catering_orders WHERE user_id = ?';
    const params = [user.id];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    if (from_date) {
      query += ' AND order_date >= ?';
      params.push(from_date);
    }
    if (to_date) {
      query += ' AND order_date <= ?';
      params.push(to_date);
    }

    query += ' ORDER BY order_date DESC';

    const orders = database.prepare(query).all(...params);

    res.json({
      success: true,
      data: orders,
      count: orders.length
    });
  } catch (error) {
    console.error('[Catering] List error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/catering/:id - Get single catering order with items
router.get('/catering/:id', (req, res) => {
  try {
    const user = getUserContext(req);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const database = db.getDatabase();

    const order = database.prepare(`
      SELECT * FROM catering_orders WHERE id = ? AND user_id = ?
    `).get(req.params.id, user.id);

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    const items = database.prepare(`
      SELECT * FROM catering_order_items WHERE catering_order_id = ?
    `).all(order.id);

    // Calculate profit metrics
    const totalCost = items.reduce((sum, i) => sum + (i.total_cost_cents || 0), 0);
    const totalRevenue = items.reduce((sum, i) => sum + (i.total_selling_price_cents || 0), 0);

    res.json({
      success: true,
      data: {
        ...order,
        items,
        profitAnalysis: {
          totalCostCents: totalCost,
          totalRevenueCents: totalRevenue || order.selling_price_cents,
          profitCents: (totalRevenue || order.selling_price_cents || 0) - totalCost,
          marginPct: totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue * 100).toFixed(1) : 0,
          costPerGuest: order.guest_count > 0 ? Math.round(totalCost / order.guest_count) : 0,
          revenuePerGuest: order.guest_count > 0 ? Math.round((totalRevenue || order.selling_price_cents || 0) / order.guest_count) : 0
        }
      }
    });
  } catch (error) {
    console.error('[Catering] Get error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/catering - Create catering order
router.post('/catering', (req, res) => {
  try {
    const user = getUserContext(req);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const {
      order_name, order_type, order_date, delivery_time, delivery_address,
      guest_count, per_person_budget_cents, selling_price_cents,
      contact_name, contact_email, contact_phone, company_name,
      dietary_notes, setup_instructions, staff_needed, equipment_needed, notes
    } = req.body;

    if (!order_name || !order_date || !guest_count) {
      return res.status(400).json({
        success: false,
        error: 'Order name, date, and guest count are required'
      });
    }

    const database = db.getDatabase();

    const result = database.prepare(`
      INSERT INTO catering_orders (
        user_id, order_name, order_type, order_date, delivery_time, delivery_address,
        guest_count, per_person_budget_cents, selling_price_cents,
        contact_name, contact_email, contact_phone, company_name,
        dietary_notes, setup_instructions, staff_needed, equipment_needed, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user.id, order_name, order_type || 'drop_off', order_date, delivery_time, delivery_address,
      guest_count, per_person_budget_cents, selling_price_cents,
      contact_name, contact_email, contact_phone, company_name,
      dietary_notes, setup_instructions, staff_needed || 0, equipment_needed, notes
    );

    const newOrder = database.prepare('SELECT * FROM catering_orders WHERE id = ?').get(result.lastInsertRowid);

    res.json({
      success: true,
      data: newOrder
    });
  } catch (error) {
    console.error('[Catering] Create error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/catering/:id - Update catering order
router.put('/catering/:id', (req, res) => {
  try {
    const user = getUserContext(req);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const database = db.getDatabase();

    // Verify ownership
    const existing = database.prepare(`
      SELECT id FROM catering_orders WHERE id = ? AND user_id = ?
    `).get(req.params.id, user.id);

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    const fields = [
      'order_name', 'order_type', 'order_date', 'delivery_time', 'delivery_address',
      'guest_count', 'per_person_budget_cents', 'total_cost_cents', 'selling_price_cents',
      'profit_cents', 'profit_margin_pct', 'status',
      'contact_name', 'contact_email', 'contact_phone', 'company_name',
      'dietary_notes', 'setup_instructions', 'pickup_time', 'staff_needed', 'equipment_needed', 'notes'
    ];

    const updates = [];
    const params = [];

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        params.push(req.body[field]);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }

    updates.push("updated_at = datetime('now')");
    params.push(req.params.id);

    database.prepare(`
      UPDATE catering_orders SET ${updates.join(', ')} WHERE id = ?
    `).run(...params);

    const updated = database.prepare('SELECT * FROM catering_orders WHERE id = ?').get(req.params.id);

    res.json({
      success: true,
      data: updated
    });
  } catch (error) {
    console.error('[Catering] Update error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/catering/:id/items - Add items to catering order
router.post('/catering/:id/items', (req, res) => {
  try {
    const user = getUserContext(req);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const database = db.getDatabase();

    const order = database.prepare(`
      SELECT * FROM catering_orders WHERE id = ? AND user_id = ?
    `).get(req.params.id, user.id);

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    const { items } = req.body;

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ success: false, error: 'Items array required' });
    }

    const insertItem = database.prepare(`
      INSERT INTO catering_order_items (
        catering_order_id, inventory_item_id, item_name, category, quantity,
        unit_of_measure, unit_cost_cents, total_cost_cents,
        selling_price_per_unit_cents, total_selling_price_cents, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let totalCost = 0;
    let totalRevenue = 0;

    for (const item of items) {
      const itemTotalCost = (item.unit_cost_cents || 0) * (item.quantity || 1);
      const itemTotalRevenue = (item.selling_price_per_unit_cents || 0) * (item.quantity || 1);

      insertItem.run(
        req.params.id, item.inventory_item_id, item.item_name, item.category,
        item.quantity, item.unit_of_measure || 'serving',
        item.unit_cost_cents, itemTotalCost,
        item.selling_price_per_unit_cents, itemTotalRevenue, item.notes
      );

      totalCost += itemTotalCost;
      totalRevenue += itemTotalRevenue;
    }

    // Update order totals
    const profitCents = totalRevenue - totalCost;
    const marginPct = totalRevenue > 0 ? (profitCents / totalRevenue * 100) : 0;

    database.prepare(`
      UPDATE catering_orders SET
        total_cost_cents = (SELECT SUM(total_cost_cents) FROM catering_order_items WHERE catering_order_id = ?),
        selling_price_cents = COALESCE(selling_price_cents, (SELECT SUM(total_selling_price_cents) FROM catering_order_items WHERE catering_order_id = ?)),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(req.params.id, req.params.id, req.params.id);

    // Recalculate profit margin
    const updatedOrder = database.prepare('SELECT * FROM catering_orders WHERE id = ?').get(req.params.id);
    const profit = (updatedOrder.selling_price_cents || 0) - (updatedOrder.total_cost_cents || 0);
    const margin = updatedOrder.selling_price_cents > 0 ? (profit / updatedOrder.selling_price_cents * 100) : 0;

    database.prepare(`
      UPDATE catering_orders SET profit_cents = ?, profit_margin_pct = ? WHERE id = ?
    `).run(profit, margin, req.params.id);

    const allItems = database.prepare('SELECT * FROM catering_order_items WHERE catering_order_id = ?').all(req.params.id);

    res.json({
      success: true,
      data: allItems
    });
  } catch (error) {
    console.error('[Catering] Add items error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/catering/:id/profit - Calculate profit analysis
router.get('/catering/:id/profit', (req, res) => {
  try {
    const user = getUserContext(req);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const database = db.getDatabase();

    const order = database.prepare(`
      SELECT * FROM catering_orders WHERE id = ? AND user_id = ?
    `).get(req.params.id, user.id);

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    const items = database.prepare(`
      SELECT * FROM catering_order_items WHERE catering_order_id = ?
    `).all(order.id);

    const totalCost = items.reduce((sum, i) => sum + (i.total_cost_cents || 0), 0);
    const totalRevenue = order.selling_price_cents || items.reduce((sum, i) => sum + (i.total_selling_price_cents || 0), 0);
    const profit = totalRevenue - totalCost;

    res.json({
      success: true,
      data: {
        totalCostCents: totalCost,
        totalRevenueCents: totalRevenue,
        profitCents: profit,
        marginPct: totalRevenue > 0 ? ((profit / totalRevenue) * 100).toFixed(1) : 0,
        costPerGuest: order.guest_count > 0 ? Math.round(totalCost / order.guest_count) : 0,
        revenuePerGuest: order.guest_count > 0 ? Math.round(totalRevenue / order.guest_count) : 0,
        profitPerGuest: order.guest_count > 0 ? Math.round(profit / order.guest_count) : 0,
        breakEvenGuests: totalRevenue > 0 ? Math.ceil(totalCost / (totalRevenue / order.guest_count)) : 0,
        marginStatus: profit / totalRevenue > 0.4 ? 'excellent' : profit / totalRevenue > 0.25 ? 'good' : 'low'
      }
    });
  } catch (error) {
    console.error('[Catering] Profit error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// TEMPLATES ENDPOINTS
// =====================================================

// GET /api/event-templates - List all templates
router.get('/event-templates', (req, res) => {
  try {
    const user = getUserContext(req);
    const database = db.getDatabase();

    let templates;
    if (user) {
      templates = database.prepare(`
        SELECT * FROM event_templates
        WHERE is_system_template = 1 OR user_id = ?
        ORDER BY is_system_template DESC, usage_count DESC
      `).all(user.id);
    } else {
      templates = database.prepare(`
        SELECT * FROM event_templates WHERE is_system_template = 1
        ORDER BY usage_count DESC
      `).all();
    }

    // Parse JSON fields
    const parsed = templates.map(t => ({
      ...t,
      default_items: t.default_items ? JSON.parse(t.default_items) : [],
      default_dietary_options: t.default_dietary_options ? JSON.parse(t.default_dietary_options) : []
    }));

    res.json({
      success: true,
      data: parsed
    });
  } catch (error) {
    console.error('[Templates] List error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// DOCUMENT PARSING ENDPOINTS
// =====================================================

// POST /api/events/parse-document - Parse uploaded document
router.post('/events/parse-document', upload.single('file'), async (req, res) => {
  try {
    const user = getUserContext(req);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const fs = require('fs');
    const text = fs.readFileSync(req.file.path, 'utf8');

    // Parse the document
    const parsed = parseEventDocument(text);

    // Clean up file
    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      data: parsed
    });
  } catch (error) {
    console.error('[Events] Parse document error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// HELPER FUNCTIONS
// =====================================================

function generateEventRecommendations(eventId, userId, database) {
  const event = database.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!event) return 0;

  const items = database.prepare('SELECT * FROM event_items WHERE event_id = ?').all(eventId);
  const recommendations = [];

  const eventDate = new Date(event.event_date);
  const today = new Date();
  const daysUntilEvent = Math.ceil((eventDate - today) / (1000 * 60 * 60 * 24));

  // 1. Check quantities against per-person rates
  for (const item of items) {
    if (!item.category) continue;

    const baseRate = perPersonRates[item.category];
    if (!baseRate) continue;

    const multiplier = eventTypeMultipliers[event.event_type]?.[item.category] || 1;
    const suggestedQty = Math.ceil(event.guest_count * baseRate * multiplier * 1.1);

    if (item.quantity_needed < suggestedQty * 0.8) {
      recommendations.push({
        type: 'quantity_adjustment',
        priority: 'high',
        title: `Increase ${item.item_name} quantity`,
        description: `For ${event.guest_count} guests, we recommend ${suggestedQty} (you have ${item.quantity_needed} planned)`,
        item_name: item.item_name,
        current_quantity: item.quantity_needed,
        suggested_quantity: suggestedQty,
        confidence_score: 85
      });
    }
  }

  // 2. Check order timing
  for (const item of items) {
    if (item.is_ordered) continue;

    const leadTime = leadTimes[item.category] || 7;
    const daysUntilOrderDeadline = daysUntilEvent - leadTime;

    if (daysUntilOrderDeadline <= 0) {
      recommendations.push({
        type: 'timing_alert',
        priority: 'critical',
        title: `URGENT: Order ${item.item_name} immediately`,
        description: `This item needs ${leadTime} days lead time. Order today to ensure delivery.`,
        item_name: item.item_name,
        confidence_score: 100
      });
    } else if (daysUntilOrderDeadline <= 3) {
      const orderByDate = new Date(eventDate);
      orderByDate.setDate(orderByDate.getDate() - leadTime);

      recommendations.push({
        type: 'timing_alert',
        priority: 'high',
        title: `Order ${item.item_name} soon`,
        description: `Order by ${orderByDate.toLocaleDateString()} to ensure timely delivery.`,
        item_name: item.item_name,
        confidence_score: 95
      });
    }
  }

  // 3. Check bulk discount opportunities
  for (const item of items) {
    const threshold = bulkThresholds[item.category];
    if (!threshold) continue;

    if (item.quantity_needed >= threshold.quantity * 0.8 && item.quantity_needed < threshold.quantity) {
      const additionalNeeded = threshold.quantity - item.quantity_needed;
      const potentialSavings = Math.floor((item.unit_cost_cents || 0) * threshold.quantity * threshold.discount);

      recommendations.push({
        type: 'bulk_opportunity',
        priority: 'medium',
        title: `Bulk discount on ${item.item_name}`,
        description: `Order ${additionalNeeded} more to get ${(threshold.discount * 100).toFixed(0)}% off`,
        item_name: item.item_name,
        potential_savings_cents: potentialSavings,
        confidence_score: 90
      });
    }
  }

  // 4. Dietary reminders
  const totalDietary = (event.dietary_vegetarian || 0) + (event.dietary_vegan || 0) + (event.dietary_gluten_free || 0);
  if (totalDietary > 0) {
    recommendations.push({
      type: 'dietary_reminder',
      priority: 'medium',
      title: 'Dietary accommodations needed',
      description: `Remember: ${event.dietary_vegetarian || 0} vegetarian, ${event.dietary_vegan || 0} vegan, ${event.dietary_gluten_free || 0} gluten-free guests`,
      confidence_score: 100
    });
  }

  // Store recommendations
  const insertRec = database.prepare(`
    INSERT INTO event_recommendations (
      user_id, event_id, recommendation_type, priority, title, description,
      item_name, current_quantity, suggested_quantity, potential_savings_cents, confidence_score
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const rec of recommendations) {
    insertRec.run(
      userId, eventId, rec.type, rec.priority, rec.title, rec.description,
      rec.item_name, rec.current_quantity, rec.suggested_quantity,
      rec.potential_savings_cents || 0, rec.confidence_score
    );
  }

  return recommendations.length;
}

function parseEventDocument(text) {
  const result = {
    guestCount: null,
    eventDate: null,
    items: [],
    dietary: [],
    budget: null,
    confidence: 0
  };

  // Guest count patterns
  const guestPatterns = [
    /(\d+)\s*(?:guests?|people|persons?|attendees?|pax)/gi,
    /(?:party of|group of|expecting)\s*(\d+)/gi,
    /headcount[:\s]*(\d+)/gi
  ];

  for (const pattern of guestPatterns) {
    const match = text.match(pattern);
    if (match) {
      const num = match[0].match(/\d+/);
      if (num) {
        result.guestCount = parseInt(num[0]);
        break;
      }
    }
  }

  // Date patterns
  const datePatterns = [
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/g,
    /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/gi
  ];

  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (match) {
      result.eventDate = match[0];
      break;
    }
  }

  // Item patterns
  const itemPatterns = [
    /(\d+)\s*(?:cases?|bottles?|boxes?)\s+(?:of\s+)?([a-zA-Z\s]+)/gi,
    /([a-zA-Z\s]+)[:\s]+(\d+)\s*(?:each|units?|servings?)?/gi
  ];

  for (const pattern of itemPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (match[1] && match[2]) {
        const isQuantityFirst = !isNaN(parseInt(match[1]));
        result.items.push({
          name: isQuantityFirst ? match[2].trim() : match[1].trim(),
          quantity: isQuantityFirst ? parseInt(match[1]) : parseInt(match[2])
        });
      }
    }
  }

  // Dietary keywords
  const dietaryKeywords = ['vegetarian', 'vegan', 'gluten-free', 'gluten free', 'dairy-free', 'nut-free', 'kosher', 'halal'];
  for (const keyword of dietaryKeywords) {
    if (text.toLowerCase().includes(keyword)) {
      // Try to find count
      const countPattern = new RegExp(`(\\d+)\\s*${keyword}`, 'gi');
      const countMatch = text.match(countPattern);
      if (countMatch) {
        const num = countMatch[0].match(/\d+/);
        result.dietary.push({ type: keyword, count: parseInt(num[0]) });
      } else {
        result.dietary.push({ type: keyword, count: null });
      }
    }
  }

  // Budget patterns
  const budgetPatterns = [
    /budget[:\s]*\$?([\d,]+(?:\.\d{2})?)/gi,
    /\$([\d,]+(?:\.\d{2})?)\s*(?:per person|pp|each)/gi
  ];

  for (const pattern of budgetPatterns) {
    const match = text.match(pattern);
    if (match) {
      const amount = match[0].match(/[\d,]+(?:\.\d{2})?/);
      if (amount) {
        result.budget = parseFloat(amount[0].replace(',', '')) * 100; // Convert to cents
      }
      break;
    }
  }

  // Calculate confidence
  let confidence = 0;
  if (result.guestCount) confidence += 30;
  if (result.eventDate) confidence += 20;
  if (result.items.length > 0) confidence += 25;
  if (result.dietary.length > 0) confidence += 15;
  if (result.budget) confidence += 10;
  result.confidence = confidence;

  return result;
}

function suggestStaffing(guestCount, eventType) {
  const ratios = {
    wedding_reception: 20,
    corporate_lunch: 25,
    cocktail_party: 30,
    birthday_party: 25,
    holiday_party: 22,
    default: 25
  };

  const ratio = ratios[eventType] || ratios.default;

  return {
    servers: Math.ceil(guestCount / ratio),
    bartenders: Math.ceil(guestCount / 75),
    bussers: Math.ceil(guestCount / ratio / 2),
    kitchen: Math.ceil(guestCount / 50)
  };
}

module.exports = router;
