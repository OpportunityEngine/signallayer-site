// =====================================================
// INTENT SIGNALS API ROUTES
// Revenue Radar - Business Intent Detection
// =====================================================

const express = require('express');
const router = express.Router();
const db = require('./database');

// =====================================================
// CONFIGURATION ENDPOINTS
// =====================================================

/**
 * GET /api/intent-signals/configs
 * List all intent signal configurations for the current user
 */
router.get('/configs', (req, res) => {
  try {
    const database = db.getDatabase();
    const configs = database.prepare(`
      SELECT
        c.*,
        (SELECT COUNT(*) FROM intent_signal_matches m WHERE m.config_id = c.id AND m.status = 'new') as new_matches,
        (SELECT COUNT(*) FROM intent_signal_matches m WHERE m.config_id = c.id AND m.priority = 'critical' AND m.status IN ('new', 'viewed')) as critical_count
      FROM intent_signal_configs c
      WHERE c.user_id = ?
      ORDER BY c.created_at DESC
    `).all(req.user.id);

    // Parse JSON fields
    const parsedConfigs = configs.map(c => ({
      ...c,
      keywords: JSON.parse(c.keywords || '[]'),
      zip_codes: JSON.parse(c.zip_codes || '[]'),
      industry_filter: c.industry_filter ? JSON.parse(c.industry_filter) : null
    }));

    res.json({ success: true, data: parsedConfigs });
  } catch (error) {
    console.error('Error fetching intent configs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/intent-signals/configs/:id
 * Get a single configuration
 */
router.get('/configs/:id', (req, res) => {
  try {
    const database = db.getDatabase();
    const config = database.prepare(`
      SELECT * FROM intent_signal_configs
      WHERE id = ? AND user_id = ?
    `).get(req.params.id, req.user.id);

    if (!config) {
      return res.status(404).json({ success: false, error: 'Configuration not found' });
    }

    // Parse JSON fields
    config.keywords = JSON.parse(config.keywords || '[]');
    config.zip_codes = JSON.parse(config.zip_codes || '[]');
    config.industry_filter = config.industry_filter ? JSON.parse(config.industry_filter) : null;

    res.json({ success: true, data: config });
  } catch (error) {
    console.error('Error fetching intent config:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/intent-signals/configs
 * Create a new intent signal configuration
 */
router.post('/configs', (req, res) => {
  try {
    const {
      config_name,
      keywords,
      zip_codes,
      industry_filter,
      company_size_min,
      company_size_max,
      revenue_min_cents,
      revenue_max_cents,
      notify_critical = 1,
      notify_high = 1,
      notify_medium = 0,
      notify_low = 0,
      notification_email,
      check_frequency_minutes = 30
    } = req.body;

    // Validation
    if (!config_name || !keywords || !zip_codes) {
      return res.status(400).json({
        success: false,
        error: 'config_name, keywords, and zip_codes are required'
      });
    }

    // Normalize keywords and zip codes to arrays
    const keywordArray = Array.isArray(keywords)
      ? keywords
      : keywords.split('\n').map(k => k.trim()).filter(k => k);

    const zipCodeArray = Array.isArray(zip_codes)
      ? zip_codes
      : zip_codes.split(',').map(z => z.trim()).filter(z => z);

    if (keywordArray.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one keyword is required' });
    }

    if (zipCodeArray.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one zip code is required' });
    }

    const database = db.getDatabase();
    const result = database.prepare(`
      INSERT INTO intent_signal_configs (
        user_id, config_name, keywords, zip_codes, industry_filter,
        company_size_min, company_size_max, revenue_min_cents, revenue_max_cents,
        notify_critical, notify_high, notify_medium, notify_low,
        notification_email, check_frequency_minutes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user.id,
      config_name,
      JSON.stringify(keywordArray),
      JSON.stringify(zipCodeArray),
      industry_filter ? JSON.stringify(industry_filter) : null,
      company_size_min || null,
      company_size_max || null,
      revenue_min_cents || null,
      revenue_max_cents || null,
      notify_critical ? 1 : 0,
      notify_high ? 1 : 0,
      notify_medium ? 1 : 0,
      notify_low ? 1 : 0,
      notification_email || null,
      check_frequency_minutes
    );

    res.json({
      success: true,
      data: { id: result.lastInsertRowid },
      message: 'Intent signal configuration created successfully'
    });
  } catch (error) {
    console.error('Error creating intent config:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/intent-signals/configs/:id
 * Update an existing configuration
 */
router.put('/configs/:id', (req, res) => {
  try {
    const database = db.getDatabase();

    // Verify ownership
    const existing = database.prepare(`
      SELECT id FROM intent_signal_configs WHERE id = ? AND user_id = ?
    `).get(req.params.id, req.user.id);

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Configuration not found' });
    }

    const {
      config_name,
      keywords,
      zip_codes,
      industry_filter,
      company_size_min,
      company_size_max,
      revenue_min_cents,
      revenue_max_cents,
      notify_critical,
      notify_high,
      notify_medium,
      notify_low,
      notification_email,
      check_frequency_minutes
    } = req.body;

    // Build update query dynamically
    const updates = [];
    const values = [];

    if (config_name !== undefined) {
      updates.push('config_name = ?');
      values.push(config_name);
    }
    if (keywords !== undefined) {
      const keywordArray = Array.isArray(keywords)
        ? keywords
        : keywords.split('\n').map(k => k.trim()).filter(k => k);
      updates.push('keywords = ?');
      values.push(JSON.stringify(keywordArray));
    }
    if (zip_codes !== undefined) {
      const zipCodeArray = Array.isArray(zip_codes)
        ? zip_codes
        : zip_codes.split(',').map(z => z.trim()).filter(z => z);
      updates.push('zip_codes = ?');
      values.push(JSON.stringify(zipCodeArray));
    }
    if (industry_filter !== undefined) {
      updates.push('industry_filter = ?');
      values.push(industry_filter ? JSON.stringify(industry_filter) : null);
    }
    if (company_size_min !== undefined) {
      updates.push('company_size_min = ?');
      values.push(company_size_min);
    }
    if (company_size_max !== undefined) {
      updates.push('company_size_max = ?');
      values.push(company_size_max);
    }
    if (revenue_min_cents !== undefined) {
      updates.push('revenue_min_cents = ?');
      values.push(revenue_min_cents);
    }
    if (revenue_max_cents !== undefined) {
      updates.push('revenue_max_cents = ?');
      values.push(revenue_max_cents);
    }
    if (notify_critical !== undefined) {
      updates.push('notify_critical = ?');
      values.push(notify_critical ? 1 : 0);
    }
    if (notify_high !== undefined) {
      updates.push('notify_high = ?');
      values.push(notify_high ? 1 : 0);
    }
    if (notify_medium !== undefined) {
      updates.push('notify_medium = ?');
      values.push(notify_medium ? 1 : 0);
    }
    if (notify_low !== undefined) {
      updates.push('notify_low = ?');
      values.push(notify_low ? 1 : 0);
    }
    if (notification_email !== undefined) {
      updates.push('notification_email = ?');
      values.push(notification_email);
    }
    if (check_frequency_minutes !== undefined) {
      updates.push('check_frequency_minutes = ?');
      values.push(check_frequency_minutes);
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(req.params.id, req.user.id);

    database.prepare(`
      UPDATE intent_signal_configs
      SET ${updates.join(', ')}
      WHERE id = ? AND user_id = ?
    `).run(...values);

    res.json({ success: true, message: 'Configuration updated successfully' });
  } catch (error) {
    console.error('Error updating intent config:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/intent-signals/configs/:id
 * Delete a configuration
 */
router.delete('/configs/:id', (req, res) => {
  try {
    const database = db.getDatabase();

    const result = database.prepare(`
      DELETE FROM intent_signal_configs
      WHERE id = ? AND user_id = ?
    `).run(req.params.id, req.user.id);

    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: 'Configuration not found' });
    }

    res.json({ success: true, message: 'Configuration deleted successfully' });
  } catch (error) {
    console.error('Error deleting intent config:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/intent-signals/configs/:id/toggle
 * Enable or disable a configuration
 */
router.post('/configs/:id/toggle', (req, res) => {
  try {
    const database = db.getDatabase();

    const config = database.prepare(`
      SELECT id, is_active FROM intent_signal_configs
      WHERE id = ? AND user_id = ?
    `).get(req.params.id, req.user.id);

    if (!config) {
      return res.status(404).json({ success: false, error: 'Configuration not found' });
    }

    const newStatus = config.is_active ? 0 : 1;

    database.prepare(`
      UPDATE intent_signal_configs
      SET is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newStatus, req.params.id);

    res.json({
      success: true,
      data: { is_active: newStatus },
      message: newStatus ? 'Configuration enabled' : 'Configuration disabled'
    });
  } catch (error) {
    console.error('Error toggling intent config:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// SIGNAL FEED & MATCHES ENDPOINTS
// =====================================================

/**
 * GET /api/intent-signals/feed
 * Get the real-time signal feed (paginated)
 */
router.get('/feed', (req, res) => {
  try {
    const database = db.getDatabase();
    const {
      limit = 20,
      offset = 0,
      priority,
      status,
      config_id,
      search
    } = req.query;

    let query = `
      SELECT
        m.*,
        c.config_name,
        CASE
          WHEN m.expires_at < datetime('now') THEN 'expired'
          WHEN m.freshness_hours <= 2 THEN 'hot'
          WHEN m.freshness_hours <= 8 THEN 'warm'
          WHEN m.freshness_hours <= 24 THEN 'cooling'
          ELSE 'cold'
        END as freshness_indicator,
        ROUND((julianday(m.expires_at) - julianday('now')) * 24, 1) as hours_until_expiry,
        (SELECT COUNT(*) FROM intent_signal_actions a WHERE a.match_id = m.id) as action_count
      FROM intent_signal_matches m
      JOIN intent_signal_configs c ON m.config_id = c.id
      WHERE m.user_id = ? AND m.is_archived = 0
    `;
    const params = [req.user.id];

    // Apply filters
    if (priority) {
      query += ' AND m.priority = ?';
      params.push(priority);
    }
    if (status) {
      query += ' AND m.status = ?';
      params.push(status);
    }
    if (config_id) {
      query += ' AND m.config_id = ?';
      params.push(config_id);
    }
    if (search) {
      query += ' AND (m.company_name LIKE ? OR m.matched_keyword LIKE ? OR m.search_context LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    // Order by priority (critical first), then recency
    query += ` ORDER BY
      CASE m.priority
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
      END,
      m.signal_detected_at DESC
      LIMIT ? OFFSET ?
    `;
    params.push(parseInt(limit), parseInt(offset));

    const matches = database.prepare(query).all(...params);

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(*) as total
      FROM intent_signal_matches m
      WHERE m.user_id = ? AND m.is_archived = 0
    `;
    const countParams = [req.user.id];

    if (priority) {
      countQuery += ' AND m.priority = ?';
      countParams.push(priority);
    }
    if (status) {
      countQuery += ' AND m.status = ?';
      countParams.push(status);
    }
    if (config_id) {
      countQuery += ' AND m.config_id = ?';
      countParams.push(config_id);
    }

    const { total } = database.prepare(countQuery).get(...countParams);

    // Get summary stats for the dashboard
    const summary = database.prepare(`
      SELECT
        COUNT(*) as total_signals,
        COUNT(CASE WHEN status = 'new' THEN 1 END) as new_count,
        COUNT(CASE WHEN status = 'viewed' THEN 1 END) as viewed_count,
        COUNT(CASE WHEN status = 'contacted' THEN 1 END) as contacted_count,
        COUNT(CASE WHEN status = 'qualified' THEN 1 END) as qualified_count,
        COUNT(CASE WHEN status = 'won' THEN 1 END) as won_count,
        COUNT(CASE WHEN priority = 'critical' AND status = 'new' THEN 1 END) as critical_new,
        COUNT(CASE WHEN priority = 'high' AND status = 'new' THEN 1 END) as high_new,
        COUNT(CASE WHEN priority = 'critical' AND status IN ('new', 'viewed') THEN 1 END) as critical_open,
        COUNT(CASE WHEN priority = 'high' AND status IN ('new', 'viewed') THEN 1 END) as high_open
      FROM intent_signal_matches
      WHERE user_id = ? AND is_archived = 0
    `).get(req.user.id);

    res.json({
      success: true,
      signals: matches,  // Frontend expects 'signals'
      data: matches,     // Keep for backwards compatibility
      summary: summary,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total,
        hasMore: parseInt(offset) + matches.length < total
      }
    });
  } catch (error) {
    console.error('Error fetching intent feed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/intent-signals/matches/:id
 * Get a single match with full details and action history
 */
router.get('/matches/:id', (req, res) => {
  try {
    const database = db.getDatabase();

    const match = database.prepare(`
      SELECT
        m.*,
        c.config_name,
        c.keywords as config_keywords,
        CASE
          WHEN m.expires_at < datetime('now') THEN 'expired'
          WHEN m.freshness_hours <= 2 THEN 'hot'
          WHEN m.freshness_hours <= 8 THEN 'warm'
          WHEN m.freshness_hours <= 24 THEN 'cooling'
          ELSE 'cold'
        END as freshness_indicator,
        ROUND((julianday(m.expires_at) - julianday('now')) * 24, 1) as hours_until_expiry
      FROM intent_signal_matches m
      JOIN intent_signal_configs c ON m.config_id = c.id
      WHERE m.id = ? AND m.user_id = ?
    `).get(req.params.id, req.user.id);

    if (!match) {
      return res.status(404).json({ success: false, error: 'Match not found' });
    }

    // Get action history
    const actions = database.prepare(`
      SELECT * FROM intent_signal_actions
      WHERE match_id = ?
      ORDER BY created_at DESC
    `).all(req.params.id);

    // Mark as viewed if status is 'new'
    if (match.status === 'new') {
      database.prepare(`
        UPDATE intent_signal_matches
        SET status = 'viewed', viewed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(req.params.id);

      // Log the view action
      database.prepare(`
        INSERT INTO intent_signal_actions (match_id, user_id, action_type)
        VALUES (?, ?, 'viewed')
      `).run(req.params.id, req.user.id);

      match.status = 'viewed';
      match.viewed_at = new Date().toISOString();
    }

    res.json({
      success: true,
      data: {
        ...match,
        actions
      }
    });
  } catch (error) {
    console.error('Error fetching intent match:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/intent-signals/matches/:id/status
 * Update the status of a match
 */
router.put('/matches/:id/status', (req, res) => {
  try {
    const { status, outcome, outcome_value_cents, notes } = req.body;
    const database = db.getDatabase();

    // Verify ownership
    const match = database.prepare(`
      SELECT id, config_id FROM intent_signal_matches WHERE id = ? AND user_id = ?
    `).get(req.params.id, req.user.id);

    if (!match) {
      return res.status(404).json({ success: false, error: 'Match not found' });
    }

    const validStatuses = ['new', 'viewed', 'contacted', 'qualified', 'won', 'lost', 'expired'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }

    // Build update
    const updates = ['status = ?', 'updated_at = CURRENT_TIMESTAMP'];
    const values = [status];

    if (status === 'contacted') {
      updates.push('contacted_at = CURRENT_TIMESTAMP');
    } else if (status === 'qualified') {
      updates.push('qualified_at = CURRENT_TIMESTAMP');
    } else if (status === 'won' || status === 'lost') {
      updates.push('closed_at = CURRENT_TIMESTAMP');
      if (outcome) {
        updates.push('outcome = ?');
        values.push(outcome);
      }
      if (outcome_value_cents && status === 'won') {
        updates.push('outcome_value_cents = ?');
        values.push(outcome_value_cents);
      }
    }

    values.push(req.params.id);

    database.prepare(`
      UPDATE intent_signal_matches
      SET ${updates.join(', ')}
      WHERE id = ?
    `).run(...values);

    // Log action
    database.prepare(`
      INSERT INTO intent_signal_actions (match_id, user_id, action_type, notes, outcome, deal_value_cents)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      req.params.id,
      req.user.id,
      status === 'won' ? 'won' : status === 'lost' ? 'lost' : status === 'qualified' ? 'qualified' : 'note_added',
      notes || null,
      outcome || null,
      outcome_value_cents || null
    );

    // Update config stats if won
    if (status === 'won') {
      database.prepare(`
        UPDATE intent_signal_configs
        SET total_won = total_won + 1,
            total_revenue_won_cents = total_revenue_won_cents + ?
        WHERE id = ?
      `).run(outcome_value_cents || 0, match.config_id);
    }

    res.json({ success: true, message: `Status updated to ${status}` });
  } catch (error) {
    console.error('Error updating match status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/intent-signals/matches/:id/action
 * Log an action on a match
 */
router.post('/matches/:id/action', (req, res) => {
  try {
    const { action_type, notes, outcome, next_action, next_action_date, deal_value_cents } = req.body;
    const database = db.getDatabase();

    // Verify ownership
    const match = database.prepare(`
      SELECT id FROM intent_signal_matches WHERE id = ? AND user_id = ?
    `).get(req.params.id, req.user.id);

    if (!match) {
      return res.status(404).json({ success: false, error: 'Match not found' });
    }

    const validActions = [
      'viewed', 'contacted_email', 'contacted_phone', 'contacted_linkedin',
      'meeting_scheduled', 'proposal_sent', 'follow_up', 'qualified',
      'disqualified', 'won', 'lost', 'note_added', 'archived', 'unarchived'
    ];

    if (!validActions.includes(action_type)) {
      return res.status(400).json({ success: false, error: 'Invalid action type' });
    }

    database.prepare(`
      INSERT INTO intent_signal_actions (
        match_id, user_id, action_type, notes, outcome, next_action, next_action_date, deal_value_cents
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.params.id,
      req.user.id,
      action_type,
      notes || null,
      outcome || null,
      next_action || null,
      next_action_date || null,
      deal_value_cents || null
    );

    // Update match status based on action
    if (['contacted_email', 'contacted_phone', 'contacted_linkedin'].includes(action_type)) {
      database.prepare(`
        UPDATE intent_signal_matches
        SET status = 'contacted', contacted_at = COALESCE(contacted_at, CURRENT_TIMESTAMP)
        WHERE id = ? AND status IN ('new', 'viewed')
      `).run(req.params.id);

      // Update config stats
      database.prepare(`
        UPDATE intent_signal_configs
        SET total_contacts = total_contacts + 1
        WHERE id = (SELECT config_id FROM intent_signal_matches WHERE id = ?)
      `).run(req.params.id);
    }

    res.json({ success: true, message: 'Action logged successfully' });
  } catch (error) {
    console.error('Error logging action:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/intent-signals/matches/:id/archive
 * Archive a match
 */
router.post('/matches/:id/archive', (req, res) => {
  try {
    const database = db.getDatabase();

    const result = database.prepare(`
      UPDATE intent_signal_matches
      SET is_archived = 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `).run(req.params.id, req.user.id);

    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: 'Match not found' });
    }

    // Log action
    database.prepare(`
      INSERT INTO intent_signal_actions (match_id, user_id, action_type)
      VALUES (?, ?, 'archived')
    `).run(req.params.id, req.user.id);

    res.json({ success: true, message: 'Match archived' });
  } catch (error) {
    console.error('Error archiving match:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// SUMMARY & ANALYTICS ENDPOINTS
// =====================================================

/**
 * GET /api/intent-signals/summary
 * Get dashboard summary stats
 */
router.get('/summary', (req, res) => {
  try {
    const database = db.getDatabase();

    // Get summary from view or calculate
    const stats = database.prepare(`
      SELECT
        COUNT(*) as total_signals,
        COUNT(CASE WHEN status = 'new' THEN 1 END) as new_count,
        COUNT(CASE WHEN status = 'viewed' THEN 1 END) as viewed_count,
        COUNT(CASE WHEN status = 'contacted' THEN 1 END) as contacted_count,
        COUNT(CASE WHEN status = 'won' THEN 1 END) as won_count,
        COUNT(CASE WHEN priority = 'critical' AND status IN ('new', 'viewed') THEN 1 END) as critical_open,
        COUNT(CASE WHEN priority = 'high' AND status IN ('new', 'viewed') THEN 1 END) as high_open,
        SUM(CASE WHEN status = 'won' THEN outcome_value_cents ELSE 0 END) as total_won_cents
      FROM intent_signal_matches
      WHERE user_id = ? AND is_archived = 0
    `).get(req.user.id);

    // Get active configs count
    const { config_count } = database.prepare(`
      SELECT COUNT(*) as config_count FROM intent_signal_configs
      WHERE user_id = ? AND is_active = 1
    `).get(req.user.id);

    // Get recent critical/high signals
    const urgentSignals = database.prepare(`
      SELECT id, company_name, matched_keyword, priority, freshness_hours, overall_score
      FROM intent_signal_matches
      WHERE user_id = ? AND status IN ('new', 'viewed') AND priority IN ('critical', 'high')
      ORDER BY
        CASE priority WHEN 'critical' THEN 1 ELSE 2 END,
        signal_detected_at DESC
      LIMIT 5
    `).all(req.user.id);

    res.json({
      success: true,
      data: {
        ...stats,
        config_count,
        urgentSignals,
        total_won_dollars: (stats.total_won_cents || 0) / 100
      }
    });
  } catch (error) {
    console.error('Error fetching intent summary:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/intent-signals/analytics
 * Get detailed analytics
 */
router.get('/analytics', (req, res) => {
  try {
    const database = db.getDatabase();
    const { days = 30 } = req.query;

    // Signals by day
    const signalsByDay = database.prepare(`
      SELECT
        DATE(created_at) as date,
        COUNT(*) as count,
        COUNT(CASE WHEN priority = 'critical' THEN 1 END) as critical,
        COUNT(CASE WHEN priority = 'high' THEN 1 END) as high
      FROM intent_signal_matches
      WHERE user_id = ? AND created_at >= datetime('now', '-' || ? || ' days')
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `).all(req.user.id, days);

    // Top performing keywords
    const topKeywords = database.prepare(`
      SELECT
        matched_keyword,
        COUNT(*) as total_matches,
        COUNT(CASE WHEN status = 'contacted' THEN 1 END) as contacted,
        COUNT(CASE WHEN status = 'won' THEN 1 END) as won,
        SUM(CASE WHEN status = 'won' THEN outcome_value_cents ELSE 0 END) as revenue_cents
      FROM intent_signal_matches
      WHERE user_id = ?
      GROUP BY matched_keyword
      ORDER BY total_matches DESC
      LIMIT 10
    `).all(req.user.id);

    // Conversion funnel
    const funnel = database.prepare(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN status != 'new' THEN 1 END) as viewed,
        COUNT(CASE WHEN status IN ('contacted', 'qualified', 'won', 'lost') THEN 1 END) as contacted,
        COUNT(CASE WHEN status IN ('qualified', 'won', 'lost') THEN 1 END) as qualified,
        COUNT(CASE WHEN status = 'won' THEN 1 END) as won
      FROM intent_signal_matches
      WHERE user_id = ? AND is_archived = 0
    `).get(req.user.id);

    // Response time analysis
    const responseTime = database.prepare(`
      SELECT
        AVG(CASE WHEN contacted_at IS NOT NULL
            THEN (julianday(contacted_at) - julianday(created_at)) * 24
            ELSE NULL END) as avg_response_hours,
        MIN(CASE WHEN contacted_at IS NOT NULL
            THEN (julianday(contacted_at) - julianday(created_at)) * 24
            ELSE NULL END) as min_response_hours
      FROM intent_signal_matches
      WHERE user_id = ? AND contacted_at IS NOT NULL
    `).get(req.user.id);

    res.json({
      success: true,
      data: {
        signalsByDay,
        topKeywords,
        funnel,
        responseTime
      }
    });
  } catch (error) {
    console.error('Error fetching intent analytics:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// DEMO DATA GENERATION
// =====================================================

/**
 * POST /api/intent-signals/demo/generate
 * Generate demo signals for testing
 * Accepts: config_id (optional), keywords (optional), zip_codes (optional), count (optional)
 */
router.post('/demo/generate', async (req, res) => {
  try {
    const { config_id, count = 5, keywords: reqKeywords, zip_codes: reqZipCodes } = req.body;
    const database = db.getDatabase();

    let config = null;
    let keywords = [];
    let zipCodes = [];
    let configId = null;

    // Try to get an existing config first
    if (config_id) {
      config = database.prepare(`
        SELECT * FROM intent_signal_configs WHERE id = ? AND user_id = ?
      `).get(config_id, req.user.id);
    } else {
      // Get first active config
      config = database.prepare(`
        SELECT * FROM intent_signal_configs WHERE user_id = ? AND is_active = 1 LIMIT 1
      `).get(req.user.id);
    }

    // If no config exists but keywords/zip_codes were provided, create a default config
    if (!config && reqKeywords && reqKeywords.length > 0 && reqZipCodes && reqZipCodes.length > 0) {
      // Create a default demo config
      const result = database.prepare(`
        INSERT INTO intent_signal_configs (user_id, config_name, keywords, zip_codes, is_active)
        VALUES (?, ?, ?, ?, 1)
      `).run(
        req.user.id,
        'Demo Configuration',
        JSON.stringify(reqKeywords),
        JSON.stringify(reqZipCodes)
      );
      configId = result.lastInsertRowid;
      keywords = reqKeywords;
      zipCodes = reqZipCodes;
      console.log(`Created default demo config ${configId} for user ${req.user.id}`);
    } else if (config) {
      configId = config.id;
      keywords = JSON.parse(config.keywords || '[]');
      zipCodes = JSON.parse(config.zip_codes || '[]');
    } else {
      // No config and no keywords/zip_codes provided
      return res.status(400).json({
        success: false,
        error: 'No configuration found. Please create an intent signal configuration first, or provide keywords and zip_codes in the request.'
      });
    }

    // Use the demo adapter to generate signals
    const DemoIntentAdapter = require('./intent-signal-demo-adapter');
    const adapter = new DemoIntentAdapter();

    const signals = await adapter.generateSignals(keywords, zipCodes, count, {
      company_size_min: config ? config.company_size_min : null,
      company_size_max: config ? config.company_size_max : null
    });

    // Insert signals into database
    const insertStmt = database.prepare(`
      INSERT INTO intent_signal_matches (
        user_id, config_id, company_name, company_address, company_city, company_state,
        company_zip, company_phone, company_website, company_industry, company_employee_count,
        company_revenue_cents, matched_keyword, keyword_match_strength, search_context,
        intent_source, intent_category, overall_score, recency_score, fit_score,
        engagement_score, priority, signal_detected_at, freshness_hours, expires_at,
        contact_name, contact_title, contact_email, contact_phone, decision_maker_likelihood
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertedIds = [];
    for (const signal of signals) {
      const result = insertStmt.run(
        req.user.id,
        configId,
        signal.company_name,
        signal.company_address,
        signal.company_city,
        signal.company_state,
        signal.company_zip,
        signal.company_phone,
        signal.company_website,
        signal.company_industry,
        signal.company_employee_count,
        signal.company_revenue_cents,
        signal.matched_keyword,
        signal.keyword_match_strength,
        signal.search_context,
        signal.intent_source,
        signal.intent_category,
        signal.overall_score,
        signal.recency_score,
        signal.fit_score,
        signal.engagement_score,
        signal.priority,
        signal.signal_detected_at,
        signal.freshness_hours,
        signal.expires_at,
        signal.contact_name,
        signal.contact_title,
        signal.contact_email,
        signal.contact_phone,
        signal.decision_maker_likelihood
      );
      insertedIds.push(result.lastInsertRowid);
    }

    // Update config stats
    database.prepare(`
      UPDATE intent_signal_configs
      SET total_matches = total_matches + ?, last_match_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(signals.length, configId);

    res.json({
      success: true,
      message: `Generated ${signals.length} demo signals`,
      generated: signals.length,  // Direct count for frontend
      data: { count: signals.length, ids: insertedIds }
    });
  } catch (error) {
    console.error('Error generating demo signals:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
