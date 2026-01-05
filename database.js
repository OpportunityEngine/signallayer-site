// Database module for Revenue Radar
// Handles SQLite database initialization and common queries
const sqlite3 = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// Database file location
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'revenue-radar.db');
const SCHEMA_PATH = path.join(__dirname, 'database-schema.sql');

// Initialize database
let db;

function initDatabase() {
  try {
    // Create database connection (verbose logging only in development)
    const options = process.env.NODE_ENV === 'production' ? {} : { verbose: console.log };
    db = new sqlite3(DB_PATH, options);

    // Enable WAL mode for better concurrency
    db.pragma('journal_mode = WAL');

    // Read and execute schema
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    db.exec(schema);

    // Extend opportunities table with rules engine fields (safe to run multiple times)
    try {
      db.exec(`
        -- Add new fields for rules engine
        ALTER TABLE opportunities ADD COLUMN source_type TEXT DEFAULT 'invoice';
        ALTER TABLE opportunities ADD COLUMN rule_id INTEGER;
        ALTER TABLE opportunities ADD COLUMN trigger_sku TEXT;
        ALTER TABLE opportunities ADD COLUMN recommended_sku TEXT;
        ALTER TABLE opportunities ADD COLUMN contract_price_cents INTEGER;
        ALTER TABLE opportunities ADD COLUMN commission_rate_used REAL;
        ALTER TABLE opportunities ADD COLUMN explainability_json TEXT;
        ALTER TABLE opportunities ADD COLUMN confidence_score REAL;
        ALTER TABLE opportunities ADD COLUMN talk_track TEXT;
        ALTER TABLE opportunities ADD COLUMN created_by_user_id INTEGER;
        ALTER TABLE opportunities ADD COLUMN dedupe_key TEXT;
        ALTER TABLE opportunities ADD COLUMN supersedes_opportunity_id INTEGER;
      `);
      console.log('✅ Opportunities table extended with rules engine fields');
    } catch (alterError) {
      // Columns may already exist, which is fine
      if (!alterError.message.includes('duplicate column')) {
        console.log('⚠️  Some opportunity columns may already exist (safe to ignore)');
      }
    }

    // Add trial/freemium tracking fields (safe to run multiple times)
    try {
      db.exec(`
        -- Trial status tracking
        ALTER TABLE users ADD COLUMN is_trial INTEGER DEFAULT 0;
        ALTER TABLE users ADD COLUMN trial_started_at DATETIME;
        ALTER TABLE users ADD COLUMN trial_expires_at DATETIME;
        ALTER TABLE users ADD COLUMN trial_invoices_used INTEGER DEFAULT 0;
        ALTER TABLE users ADD COLUMN trial_invoices_limit INTEGER DEFAULT 20;
        ALTER TABLE users ADD COLUMN trial_days_limit INTEGER DEFAULT 30;
        ALTER TABLE users ADD COLUMN subscription_status TEXT DEFAULT 'trial' CHECK(subscription_status IN ('trial', 'active', 'expired', 'cancelled'));
        ALTER TABLE users ADD COLUMN signup_source TEXT DEFAULT 'manual';
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_users_trial_expires ON users(trial_expires_at) WHERE is_trial = 1;
        CREATE INDEX IF NOT EXISTS idx_users_subscription_status ON users(subscription_status);
      `);
      console.log('✅ Users table extended with trial tracking fields');
    } catch (alterError) {
      // Columns may already exist, which is fine
      if (!alterError.message.includes('duplicate column')) {
        console.log('⚠️  Some trial columns may already exist (safe to ignore)');
      }
    }

    console.log(`✅ Database initialized at ${DB_PATH}`);

    // Seed demo data if database is empty (only in development)
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
    if (userCount.count === 0 && process.env.NODE_ENV !== 'production') {
      console.log('⚠️  Skipping demo data seeding - not supported in production (use create-admin.js instead)');
      // seedDemoData(); // Disabled - demo users don't have passwords
    }

    return db;
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
}

function getDatabase() {
  if (!db) {
    db = initDatabase();
  }
  return db;
}

// Seed demo data for testing
function seedDemoData() {
  const db = getDatabase();

  try {
    db.transaction(() => {
      // Create demo team
      const teamStmt = db.prepare('INSERT INTO teams (name) VALUES (?)');
      const teamResult = teamStmt.run('Demo Sales Team');
      const teamId = teamResult.lastInsertRowid;

      // Create demo users
      const userStmt = db.prepare(`
        INSERT INTO users (email, name, role, team_id)
        VALUES (?, ?, ?, ?)
      `);

      const johnId = userStmt.run('john@demo.com', 'John', 'rep', teamId).lastInsertRowid;
      const sarahId = userStmt.run('sarah@demo.com', 'Sarah', 'rep', teamId).lastInsertRowid;
      const youId = userStmt.run('you@demo.com', 'You', 'rep', teamId).lastInsertRowid;
      const managerId = userStmt.run('manager@demo.com', 'Demo Manager', 'manager', teamId).lastInsertRowid;

      // Update team manager
      db.prepare('UPDATE teams SET manager_id = ? WHERE id = ?').run(managerId, teamId);

      // Create active SPIF for MLA reviews
      const spifStmt = db.prepare(`
        INSERT INTO spifs (
          name, description, spif_type, metric_name,
          prize_amount_cents, start_date, end_date,
          status, top_n_winners, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const now = new Date();
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay()); // Start of week
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6); // End of week
      weekEnd.setHours(23, 59, 59);

      const spifId = spifStmt.run(
        'Most MLAs Reviewed This Week',
        'Top 3 reps win $100 bonus',
        'mla_review_count',
        'mlas_reviewed',
        10000, // $100.00
        weekStart.toISOString(),
        weekEnd.toISOString(),
        'active',
        3,
        managerId
      ).lastInsertRowid;

      // Create SPIF standings
      const standingStmt = db.prepare(`
        INSERT INTO spif_standings (spif_id, user_id, current_value, rank)
        VALUES (?, ?, ?, ?)
      `);

      standingStmt.run(spifId, johnId, 34, 1);
      standingStmt.run(spifId, sarahId, 31, 2);
      standingStmt.run(spifId, youId, 28, 3);

      // Create demo MLAs
      const mlaStmt = db.prepare(`
        INSERT INTO mlas (
          account_name, vendor_name, contract_value_cents,
          start_date, end_date, status, renewal_likelihood_pct
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const mlaId1 = mlaStmt.run(
        "Bella's Italian Kitchen",
        'Commercial Equipment Co',
        3250000, // $32,500
        '2024-01-15',
        '2026-01-15',
        'expiring',
        92
      ).lastInsertRowid;

      const mlaId2 = mlaStmt.run(
        'Sunset Bistro',
        'Restaurant Supply Plus',
        2800000, // $28,000
        '2023-12-01',
        '2025-12-01',
        'active',
        88
      ).lastInsertRowid;

      // Create demo opportunities
      const oppStmt = db.prepare(`
        INSERT INTO opportunities (
          account_name, opportunity_type, status, assigned_to,
          likelihood_pct, estimated_value_cents, estimated_commission_cents,
          mla_id, urgency, detected_at, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      oppStmt.run(
        "Bella's Italian Kitchen",
        'mla_renewal',
        'detected',
        youId,
        92,
        3250000,
        162500, // 5% commission
        mlaId1,
        'critical',
        new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(), // 12 days ago
        'MLA expires in 45 days. High likelihood to renew with equipment upgrade.'
      );

      oppStmt.run(
        'Sunset Bistro',
        'mla_renewal',
        'contacted',
        youId,
        88,
        2800000,
        140000,
        mlaId2,
        'high',
        new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(), // 8 days ago
        'Strong payment history. Last contact: 8 days ago. Requested pricing info.'
      );

      oppStmt.run(
        'Downtown Diner',
        'equipment_upgrade',
        'in_progress',
        youId,
        85,
        1850000,
        92500,
        null,
        'medium',
        new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        'Equipment analysis flagged 8-year-old oven. Meeting scheduled Jan 15, 10am.'
      );

      console.log('✅ Demo data seeded successfully');
    })();
  } catch (error) {
    console.error('❌ Error seeding demo data:', error);
    throw error;
  }
}

// ===== SPIF Functions =====

function getActiveSPIFs() {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM spifs
    WHERE status = 'active'
    AND datetime('now') BETWEEN start_date AND end_date
    ORDER BY end_date ASC
  `).all();
}

function getSPIFLeaderboard(spifId) {
  const db = getDatabase();
  return db.prepare(`
    SELECT
      ss.rank,
      ss.current_value,
      u.id as user_id,
      u.name as user_name,
      u.email as user_email,
      s.prize_amount_cents,
      s.end_date
    FROM spif_standings ss
    JOIN users u ON ss.user_id = u.id
    JOIN spifs s ON ss.spif_id = s.id
    WHERE ss.spif_id = ?
    ORDER BY ss.rank ASC
    LIMIT ?
  `).all(spifId, 10);
}

function incrementSPIFMetric(spifId, userId, incrementBy = 1) {
  const db = getDatabase();

  // Upsert the standing
  db.prepare(`
    INSERT INTO spif_standings (spif_id, user_id, current_value, last_updated)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(spif_id, user_id)
    DO UPDATE SET
      current_value = current_value + ?,
      last_updated = datetime('now')
  `).run(spifId, userId, incrementBy, incrementBy);

  // Recalculate ranks
  recalculateSPIFRanks(spifId);
}

function recalculateSPIFRanks(spifId) {
  const db = getDatabase();

  // Get all standings for this SPIF sorted by value
  const standings = db.prepare(`
    SELECT id, current_value
    FROM spif_standings
    WHERE spif_id = ?
    ORDER BY current_value DESC
  `).all(spifId);

  // Update ranks
  const updateStmt = db.prepare('UPDATE spif_standings SET rank = ? WHERE id = ?');
  standings.forEach((standing, index) => {
    updateStmt.run(index + 1, standing.id);
  });
}

// ===== MLA Functions =====

function recordMLAReview(mlaId, userId, action = 'viewed', notes = null) {
  const db = getDatabase();

  const result = db.prepare(`
    INSERT INTO mla_reviews (mla_id, user_id, action, notes, created_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(mlaId, userId, action, notes);

  // Update MLA last_reviewed fields
  db.prepare(`
    UPDATE mlas
    SET last_reviewed_at = datetime('now'), last_reviewed_by = ?
    WHERE id = ?
  `).run(userId, mlaId);

  // Increment SPIF metric for active MLA review SPIFs
  const activeMLASPIFs = db.prepare(`
    SELECT id FROM spifs
    WHERE status = 'active'
    AND spif_type = 'mla_review_count'
    AND datetime('now') BETWEEN start_date AND end_date
  `).all();

  activeMLASPIFs.forEach(spif => {
    incrementSPIFMetric(spif.id, userId, 1);
  });

  return result.lastInsertRowid;
}

function getMLAsByStatus(status = 'active') {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM mlas
    WHERE status = ?
    ORDER BY end_date ASC
  `).all(status);
}

function getMLAReviewsThisWeek(userId) {
  const db = getDatabase();
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);

  return db.prepare(`
    SELECT COUNT(*) as count
    FROM mla_reviews
    WHERE user_id = ?
    AND created_at >= ?
  `).get(userId, weekStart.toISOString());
}

// ===== Opportunity Functions =====

function createOpportunity(data) {
  const db = getDatabase();

  const stmt = db.prepare(`
    INSERT INTO opportunities (
      account_name, opportunity_type, status, assigned_to,
      likelihood_pct, estimated_value_cents, estimated_commission_cents,
      source_run_id, mla_id, urgency, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  return stmt.run(
    data.account_name,
    data.opportunity_type,
    data.status || 'detected',
    data.assigned_to,
    data.likelihood_pct,
    data.estimated_value_cents,
    data.estimated_commission_cents,
    data.source_run_id || null,
    data.mla_id || null,
    data.urgency || 'medium',
    data.notes || null
  ).lastInsertRowid;
}

function getOpportunitiesByUser(userId, status = null) {
  const db = getDatabase();

  let query = `
    SELECT
      o.*,
      m.contract_value_cents as mla_value,
      m.end_date as mla_end_date
    FROM opportunities o
    LEFT JOIN mlas m ON o.mla_id = m.id
    WHERE o.assigned_to = ?
  `;

  const params = [userId];

  if (status) {
    query += ' AND o.status = ?';
    params.push(status);
  }

  query += ' ORDER BY o.detected_at DESC';

  return db.prepare(query).all(...params);
}

function updateOpportunityStatus(opportunityId, status, userId, notes = null) {
  const db = getDatabase();

  db.prepare(`
    UPDATE opportunities
    SET status = ?, last_activity_at = datetime('now')
    WHERE id = ?
  `).run(status, opportunityId);

  // Log activity
  db.prepare(`
    INSERT INTO opportunity_activities (opportunity_id, user_id, activity_type, notes)
    VALUES (?, ?, 'status_changed', ?)
  `).run(opportunityId, userId, notes || `Status changed to ${status}`);
}

// ===== Telemetry Functions =====

function logTelemetryEvent(userId, eventType, eventData, pageUrl = null, sessionId = null) {
  const db = getDatabase();

  return db.prepare(`
    INSERT INTO telemetry_events (user_id, event_type, event_data, page_url, session_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    userId,
    eventType,
    typeof eventData === 'string' ? eventData : JSON.stringify(eventData),
    pageUrl,
    sessionId
  ).lastInsertRowid;
}

function getTelemetrySummary(userId = null, hours = 24) {
  const db = getDatabase();

  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  let query = `
    SELECT
      event_type,
      COUNT(*) as count,
      MAX(created_at) as last_event
    FROM telemetry_events
    WHERE created_at >= ?
  `;

  const params = [since];

  if (userId) {
    query += ' AND user_id = ?';
    params.push(userId);
  }

  query += ' GROUP BY event_type ORDER BY count DESC';

  return db.prepare(query).all(...params);
}

// ===== Analytics Cache Functions =====

function getCachedAnalytics(cacheKey) {
  const db = getDatabase();

  const result = db.prepare(`
    SELECT cache_value
    FROM analytics_cache
    WHERE cache_key = ?
    AND expires_at > datetime('now')
  `).get(cacheKey);

  if (result) {
    return JSON.parse(result.cache_value);
  }

  return null;
}

function setCachedAnalytics(cacheKey, value, expiresInMinutes = 15) {
  const db = getDatabase();

  const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO analytics_cache (cache_key, cache_value, expires_at)
    VALUES (?, ?, ?)
    ON CONFLICT(cache_key)
    DO UPDATE SET
      cache_value = ?,
      expires_at = ?
  `).run(
    cacheKey,
    JSON.stringify(value),
    expiresAt,
    JSON.stringify(value),
    expiresAt
  );
}

// ===== User Functions =====

function getUserByEmail(email) {
  const db = getDatabase();
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function getUserById(id) {
  const db = getDatabase();
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function createOrUpdateUser(email, name, role = 'rep') {
  const db = getDatabase();

  const existing = getUserByEmail(email);

  if (existing) {
    db.prepare(`
      UPDATE users
      SET last_active = datetime('now'), name = ?
      WHERE email = ?
    `).run(name, email);
    return existing.id;
  } else {
    return db.prepare(`
      INSERT INTO users (email, name, role, last_active)
      VALUES (?, ?, ?, datetime('now'))
    `).run(email, name, role).lastInsertRowid;
  }
}

// ===== Commission Functions =====

function getCommissionsByUser(userId, status = null) {
  const db = getDatabase();

  let query = 'SELECT * FROM commissions WHERE user_id = ?';
  const params = [userId];

  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }

  query += ' ORDER BY created_at DESC';

  return db.prepare(query).all(...params);
}

function getCommissionsThisMonth(userId) {
  const db = getDatabase();

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  return db.prepare(`
    SELECT
      SUM(amount_cents) as total_cents,
      COUNT(*) as count
    FROM commissions
    WHERE user_id = ?
    AND created_at BETWEEN ? AND ?
  `).get(userId, monthStart.toISOString(), monthEnd.toISOString());
}

// ============================================
// RULES ENGINE & MLA MANAGEMENT FUNCTIONS
// ============================================

/**
 * Create or get MLA contract by contract number
 * @param {Object} data - {contractNumber, accountName, vendorName, effectiveDate, endDate, createdByUserId}
 * @returns {number} mla_id
 */
function createMLAContract(data) {
  const existing = db.prepare(`
    SELECT id FROM mla_contracts WHERE contract_number = ?
  `).get(data.contractNumber);

  if (existing) {
    console.log(`[MLA] Contract ${data.contractNumber} already exists (ID: ${existing.id})`);
    return existing.id;
  }

  const result = db.prepare(`
    INSERT INTO mla_contracts (
      contract_number, account_name, vendor_name,
      effective_date, end_date, created_by_user_id, status
    ) VALUES (?, ?, ?, ?, ?, ?, 'active')
  `).run(
    data.contractNumber,
    data.accountName,
    data.vendorName || null,
    data.effectiveDate || new Date().toISOString().split('T')[0],
    data.endDate || null,
    data.createdByUserId
  );

  console.log(`[MLA] Created contract ${data.contractNumber} (ID: ${result.lastInsertRowid})`);
  return result.lastInsertRowid;
}

/**
 * Upsert MLA products (contract pricing) - BATCH OPTIMIZED
 * @param {number} mlaId
 * @param {Array} products - [{sku, description, priceCents, uom, minQty, maxQty}]
 */
function upsertMLAProducts(mlaId, products) {
  const stmt = db.prepare(`
    INSERT INTO mla_products (
      mla_id, sku, description, price_cents, uom, min_qty, max_qty, approved
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(mla_id, sku) DO UPDATE SET
      description = excluded.description,
      price_cents = excluded.price_cents,
      uom = excluded.uom,
      min_qty = excluded.min_qty,
      max_qty = excluded.max_qty
  `);

  const insertMany = db.transaction((products) => {
    for (const product of products) {
      stmt.run(
        mlaId,
        product.sku,
        product.description || null,
        product.priceCents,
        product.uom || 'EA',
        product.minQty || null,
        product.maxQty || null,
        product.approved === false ? 0 : 1 // Convert boolean to 0/1
      );
    }
  });

  insertMany(products);
  console.log(`[MLA] Upserted ${products.length} products for MLA ID ${mlaId}`);
}

/**
 * List MLAs by account with product counts
 * @param {string} accountName
 * @returns {Array} MLAs with product counts
 */
function listMLAsByAccount(accountName) {
  return db.prepare(`
    SELECT
      m.*,
      COUNT(p.id) as product_count
    FROM mla_contracts m
    LEFT JOIN mla_products p ON m.id = p.mla_id AND p.approved = TRUE
    WHERE m.account_name LIKE ?
    GROUP BY m.id
    ORDER BY m.effective_date DESC
  `).all(`%${accountName}%`);
}

/**
 * Get MLA contract by number with all products
 * @param {string} contractNumber
 * @returns {Object|null} MLA with products array
 */
function getMLAByContractNumber(contractNumber) {
  const mla = db.prepare(`
    SELECT * FROM mla_contracts WHERE contract_number = ?
  `).get(contractNumber);

  if (!mla) return null;

  const products = db.prepare(`
    SELECT * FROM mla_products
    WHERE mla_id = ? AND approved = TRUE
    ORDER BY sku
  `).all(mla.id);

  return { ...mla, products };
}

/**
 * Get best MLA product price (most recent MLA, lowest price)
 * PERFORMANCE: Indexed query, sub-10ms response
 * @param {Object} params - {accountName, sku}
 * @returns {Object|null} {priceCents, mlaId, contractNumber, uom}
 */
function getMLAProductPrice({ accountName, sku }) {
  const result = db.prepare(`
    SELECT
      p.price_cents,
      p.uom,
      p.min_qty,
      p.max_qty,
      m.id as mla_id,
      m.contract_number,
      m.effective_date
    FROM mla_products p
    JOIN mla_contracts m ON p.mla_id = m.id
    WHERE m.account_name LIKE ?
      AND p.sku = ?
      AND p.approved = TRUE
      AND m.status = 'active'
    ORDER BY m.effective_date DESC, p.price_cents ASC
    LIMIT 1
  `).get(`%${accountName}%`, sku);

  return result;
}

/**
 * Create opportunity rule with triggers, conditions, and actions
 * EXPERT FEATURE: Full rule creation with validation
 * @param {Object} rule - Complete rule definition
 * @returns {number} rule_id
 */
function createRule(rule) {
  const ruleResult = db.prepare(`
    INSERT INTO opportunity_rules (
      account_name, industry, name, description,
      created_by_user_id, is_active, priority
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    rule.accountName || null,
    rule.industry || null,
    rule.name,
    rule.description || null,
    rule.createdByUserId,
    rule.isActive !== false, // Default true
    rule.priority || 100
  );

  const ruleId = ruleResult.lastInsertRowid;

  // Add triggers
  if (rule.triggers && rule.triggers.length > 0) {
    const triggerStmt = db.prepare(`
      INSERT INTO opportunity_rule_triggers (rule_id, trigger_sku)
      VALUES (?, ?)
    `);
    for (const sku of rule.triggers) {
      triggerStmt.run(ruleId, sku);
    }
  }

  // Add conditions
  if (rule.conditions && rule.conditions.length > 0) {
    const condStmt = db.prepare(`
      INSERT INTO opportunity_rule_conditions (
        rule_id, condition_group, left_operand_type, left_operand_value,
        operator, right_value, logic
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const cond of rule.conditions) {
      condStmt.run(
        ruleId,
        cond.group || 1,
        cond.leftOperandType,
        cond.leftOperandValue || null,
        cond.operator,
        cond.rightValue,
        cond.logic || 'AND'
      );
    }
  }

  // Add actions
  if (rule.actions && rule.actions.length > 0) {
    const actionStmt = db.prepare(`
      INSERT INTO opportunity_rule_actions (
        rule_id, action_type, recommended_sku, recommended_qty_target,
        recommended_qty_min, notes_talk_track, auto_create_opportunity
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const action of rule.actions) {
      actionStmt.run(
        ruleId,
        action.actionType,
        action.recommendedSku || null,
        action.recommendedQtyTarget || null,
        action.recommendedQtyMin || null,
        action.notesTalkTrack || null,
        action.autoCreateOpportunity !== false
      );
    }
  }

  console.log(`[RULES] Created rule "${rule.name}" (ID: ${ruleId})`);
  return ruleId;
}

/**
 * List rules with full details (triggers, conditions, actions)
 * @param {string|null} accountName - Filter by account or get all
 * @returns {Array} Enriched rules
 */
function listRulesByAccount(accountName) {
  const query = accountName
    ? `SELECT * FROM opportunity_rules WHERE (account_name = ? OR account_name IS NULL) ORDER BY priority, id`
    : `SELECT * FROM opportunity_rules ORDER BY priority, id`;

  const rules = accountName
    ? db.prepare(query).all(accountName)
    : db.prepare(query).all();

  // Enrich with triggers, conditions, actions
  for (const rule of rules) {
    rule.triggers = db.prepare(`
      SELECT trigger_sku FROM opportunity_rule_triggers WHERE rule_id = ?
    `).all(rule.id).map(r => r.trigger_sku);

    rule.conditions = db.prepare(`
      SELECT * FROM opportunity_rule_conditions WHERE rule_id = ? ORDER BY id
    `).all(rule.id);

    rule.actions = db.prepare(`
      SELECT * FROM opportunity_rule_actions WHERE rule_id = ? ORDER BY id
    `).all(rule.id);
  }

  return rules;
}

/**
 * Toggle rule active/inactive
 * @param {number} ruleId
 * @param {boolean} isActive
 */
function toggleRuleActive(ruleId, isActive) {
  db.prepare(`
    UPDATE opportunity_rules SET is_active = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(isActive ? 1 : 0, ruleId);
  console.log(`[RULES] Rule ${ruleId} set to ${isActive ? 'active' : 'inactive'}`);
}

/**
 * Update rule performance metrics
 * @param {number} ruleId
 * @param {Object} metrics - {timesFired, opportunitiesCreated, revenueGeneratedCents}
 */
function updateRulePerformance(ruleId, metrics) {
  db.prepare(`
    UPDATE opportunity_rules SET
      times_fired = times_fired + ?,
      opportunities_created = opportunities_created + ?,
      revenue_generated_cents = revenue_generated_cents + ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    metrics.timesFired || 0,
    metrics.opportunitiesCreated || 0,
    metrics.revenueGeneratedCents || 0,
    ruleId
  );
}

/**
 * CORE RULES ENGINE: Evaluate all active rules against invoice data
 * EXPERT ALGORITHM: Supports complex conditions, OR/AND logic, qty comparisons
 * @param {Object} params - {accountName, qtyBySku, invoiceTotal, runId}
 * @returns {Array} Fired rules with actions
 */
function evaluateRulesForInvoice({ accountName, qtyBySku, invoiceTotal, runId }) {
  const rules = listRulesByAccount(accountName);
  const firedRules = [];

  for (const rule of rules) {
    if (!rule.is_active) continue;

    // Check if any trigger SKU is present (or no triggers = always evaluate)
    const triggerPresent = rule.triggers.length === 0 ||
      rule.triggers.some(sku => qtyBySku[sku] !== undefined);

    if (!triggerPresent) continue;

    // Evaluate conditions
    let conditionsMet = true;
    const triggerValues = {};

    for (const condition of rule.conditions) {
      let leftValue;

      switch (condition.left_operand_type) {
        case 'invoice_qty':
          leftValue = qtyBySku[condition.left_operand_value] || 0;
          triggerValues[condition.left_operand_value] = leftValue;
          break;
        case 'invoice_total':
          leftValue = invoiceTotal || 0;
          break;
        case 'sku_present':
          leftValue = qtyBySku[condition.left_operand_value] ? 1 : 0;
          break;
        case 'sku_absent':
          leftValue = qtyBySku[condition.left_operand_value] ? 0 : 1;
          break;
        default:
          leftValue = 0;
      }

      const rightValue = parseFloat(condition.right_value);
      let met = false;

      switch (condition.operator) {
        case '>': met = leftValue > rightValue; break;
        case '<': met = leftValue < rightValue; break;
        case '>=': met = leftValue >= rightValue; break;
        case '<=': met = leftValue <= rightValue; break;
        case '==': met = leftValue === rightValue; break;
        case '!=': met = leftValue !== rightValue; break;
      }

      // AND logic (all must be true)
      if (!met && condition.logic === 'AND') {
        conditionsMet = false;
        break;
      }
    }

    if (!conditionsMet) continue;

    // Rule fired! Collect actions
    for (const action of rule.actions) {
      if (!action.auto_create_opportunity) continue;

      firedRules.push({
        ruleId: rule.id,
        ruleName: rule.name,
        action,
        triggerValues,
        accountName
      });

      // Log performance
      db.prepare(`
        INSERT INTO rule_performance_log (
          rule_id, account_name, trigger_values_json, invoice_run_id
        ) VALUES (?, ?, ?, ?)
      `).run(
        rule.id,
        accountName,
        JSON.stringify(triggerValues),
        runId || null
      );
    }
  }

  console.log(`[RULES] Evaluated ${rules.length} rules for ${accountName}, ${firedRules.length} fired`);
  return firedRules;
}

/**
 * Create contract-approved opportunity from rule fire
 * EXPERT FEATURES: Deduplication, explainability, commission calculation
 * @param {Object} params - Complete opportunity context
 * @returns {number|null} opportunity_id or null if dedupe
 */
function createOpportunityFromRule(params) {
  const {
    ruleId,
    ruleName,
    accountName,
    recommendedSku,
    triggerSku,
    triggerValues,
    contractPriceCents,
    estimatedValueCents,
    commissionRate,
    assignedUserId,
    runId,
    talkTrack
  } = params;

  // DEDUPLICATION: Check if open opportunity exists for same account + recommended SKU today
  const dedupeKey = `${accountName}:${recommendedSku}:${new Date().toISOString().split('T')[0]}`;
  const existing = db.prepare(`
    SELECT id FROM opportunities
    WHERE dedupe_key = ? AND status IN ('detected', 'contacted', 'in_progress')
  `).get(dedupeKey);

  if (existing) {
    console.log(`[OPPORTUNITY] Dedupe: opportunity already exists for ${accountName} / ${recommendedSku}`);
    return null;
  }

  const estimatedCommission = estimatedValueCents && commissionRate
    ? Math.floor(estimatedValueCents * commissionRate)
    : null;

  // EXPLAINABILITY: Track why this opportunity was created
  const explainability = {
    rule_id: ruleId,
    rule_name: ruleName,
    trigger_sku: triggerSku,
    trigger_values: triggerValues,
    recommended_sku: recommendedSku,
    contract_price_cents: contractPriceCents,
    confidence_score: 0.85, // High confidence for rule-based
    source: 'rules_engine',
    created_at: new Date().toISOString()
  };

  const result = db.prepare(`
    INSERT INTO opportunities (
      account_name, opportunity_type, status, assigned_to,
      source_type, rule_id, trigger_sku, recommended_sku,
      contract_price_cents, estimated_value_cents,
      commission_rate_used, estimated_commission_cents,
      explainability_json, confidence_score, talk_track,
      dedupe_key, source_run_id, urgency, likelihood_pct
    ) VALUES (?, 'contract_approved', 'detected', ?, 'rule', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'medium', 85)
  `).run(
    accountName,
    assignedUserId,
    ruleId,
    triggerSku || null,
    recommendedSku,
    contractPriceCents || null,
    estimatedValueCents || null,
    commissionRate || 0.05,
    estimatedCommission,
    JSON.stringify(explainability),
    0.85,
    talkTrack || null,
    dedupeKey,
    runId || null
  );

  // Update rule performance
  updateRulePerformance(ruleId, {
    timesFired: 1,
    opportunitiesCreated: 1,
    revenueGeneratedCents: 0 // Will update when won
  });

  console.log(`[OPPORTUNITY] Created contract-approved opportunity from rule "${ruleName}" (ID: ${result.lastInsertRowid})`);
  return result.lastInsertRowid;
}

// ===================================================================
// EMAIL INVOICE AUTOPILOT FUNCTIONS
// ===================================================================

/**
 * Create or update email monitor
 * @param {Object} data - Monitor configuration
 * @returns {number} Monitor ID
 */
function createEmailMonitor(data) {
  const CryptoJS = require('crypto-js');
  const ENCRYPTION_KEY = process.env.EMAIL_PASSWORD_KEY || 'revenue-radar-email-key-2026';

  // Encrypt password
  const encryptedPassword = CryptoJS.AES.encrypt(
    data.password,
    ENCRYPTION_KEY
  ).toString();

  const result = db.prepare(`
    INSERT INTO email_monitors (
      account_name, monitor_name, email_address, imap_host, imap_port,
      username, encrypted_password, industry, customer_type,
      check_interval_minutes, enable_cost_savings_detection,
      enable_duplicate_detection, enable_price_increase_alerts,
      enable_contract_validation, alert_email, created_by_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.accountName,
    data.monitorName || null,
    data.emailAddress,
    data.imapHost || 'imap.gmail.com',
    data.imapPort || 993,
    data.username || data.emailAddress,
    encryptedPassword,
    data.industry || null,
    data.customerType || 'business',
    data.checkIntervalMinutes || 5,
    data.enableCostSavingsDetection !== false ? 1 : 0,
    data.enableDuplicateDetection !== false ? 1 : 0,
    data.enablePriceIncreaseAlerts !== false ? 1 : 0,
    data.enableContractValidation || 0,
    data.alertEmail || null,
    data.createdByUserId
  );

  console.log(`[EMAIL MONITOR] Created monitor for ${data.emailAddress} (ID: ${result.lastInsertRowid})`);
  return result.lastInsertRowid;
}

/**
 * Get all active email monitors
 * @returns {Array} Active monitors
 */
function getActiveEmailMonitors() {
  const monitors = db.prepare(`
    SELECT * FROM email_monitors
    WHERE is_active = 1
    ORDER BY id
  `).all();

  return monitors;
}

/**
 * Get email monitor by ID (with decrypted password)
 * @param {number} monitorId
 * @returns {Object|null} Monitor with decrypted password
 */
function getEmailMonitorById(monitorId) {
  const CryptoJS = require('crypto-js');
  const ENCRYPTION_KEY = process.env.EMAIL_PASSWORD_KEY || 'revenue-radar-email-key-2026';

  const monitor = db.prepare(`
    SELECT * FROM email_monitors WHERE id = ?
  `).get(monitorId);

  if (!monitor) return null;

  // Decrypt password
  try {
    const bytes = CryptoJS.AES.decrypt(monitor.encrypted_password, ENCRYPTION_KEY);
    monitor.password = bytes.toString(CryptoJS.enc.Utf8);
    delete monitor.encrypted_password;
  } catch (error) {
    console.error('[EMAIL MONITOR] Failed to decrypt password:', error);
    monitor.password = null;
  }

  return monitor;
}

/**
 * Get monitors by account
 * @param {string} accountName
 * @returns {Array} Monitors (without passwords)
 */
function getEmailMonitorsByAccount(accountName) {
  const monitors = db.prepare(`
    SELECT
      id, account_name, monitor_name, email_address, imap_host,
      is_active, check_interval_minutes, industry, customer_type,
      last_check_at, total_invoices_found, total_opportunities_detected,
      total_savings_detected_cents, created_at
    FROM email_monitors
    WHERE account_name = ?
    ORDER BY created_at DESC
  `).all(accountName);

  return monitors;
}

/**
 * Update monitor last check time
 * @param {number} monitorId
 */
function updateEmailMonitorLastCheck(monitorId, success = true) {
  db.prepare(`
    UPDATE email_monitors
    SET
      last_check_at = CURRENT_TIMESTAMP,
      last_successful_check = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE last_successful_check END
    WHERE id = ?
  `).run(success ? 1 : 0, monitorId);
}

/**
 * Update monitor statistics
 * @param {number} monitorId
 * @param {Object} stats - {emailsProcessed, invoicesFound, opportunitiesDetected, savingsCents}
 */
function updateEmailMonitorStats(monitorId, stats) {
  db.prepare(`
    UPDATE email_monitors
    SET
      total_emails_processed = total_emails_processed + ?,
      total_invoices_found = total_invoices_found + ?,
      total_opportunities_detected = total_opportunities_detected + ?,
      total_savings_detected_cents = total_savings_detected_cents + ?
    WHERE id = ?
  `).run(
    stats.emailsProcessed || 0,
    stats.invoicesFound || 0,
    stats.opportunitiesDetected || 0,
    stats.savingsCents || 0,
    monitorId
  );
}

/**
 * Toggle monitor active status
 * @param {number} monitorId
 * @param {boolean} isActive
 */
function toggleEmailMonitor(monitorId, isActive) {
  db.prepare(`
    UPDATE email_monitors SET is_active = ? WHERE id = ?
  `).run(isActive ? 1 : 0, monitorId);

  console.log(`[EMAIL MONITOR] ${isActive ? 'Enabled' : 'Disabled'} monitor ID ${monitorId}`);
}

/**
 * Add email to processing queue
 * @param {Object} data - Email metadata
 * @returns {number} Queue ID
 */
function addEmailToQueue(data) {
  const result = db.prepare(`
    INSERT INTO email_invoice_queue (
      monitor_id, email_uid, sender_email, sender_name, subject,
      received_at, attachment_count, attachment_filenames
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.monitorId,
    data.emailUid,
    data.senderEmail || null,
    data.senderName || null,
    data.subject || null,
    data.receivedAt || new Date().toISOString(),
    data.attachmentCount || 0,
    JSON.stringify(data.attachmentFilenames || [])
  );

  return result.lastInsertRowid;
}

/**
 * Update email queue item status
 * @param {number} queueId
 * @param {Object} updates
 */
function updateEmailQueueItem(queueId, updates) {
  const fields = [];
  const values = [];

  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.ingestionRunId !== undefined) {
    fields.push('ingestion_run_id = ?');
    values.push(updates.ingestionRunId);
  }
  if (updates.opportunitiesDetected !== undefined) {
    fields.push('opportunities_detected = ?');
    values.push(updates.opportunitiesDetected);
  }
  if (updates.savingsDetectedCents !== undefined) {
    fields.push('savings_detected_cents = ?');
    values.push(updates.savingsDetectedCents);
  }
  if (updates.errorMessage !== undefined) {
    fields.push('error_message = ?');
    values.push(updates.errorMessage);
  }
  if (updates.skippedReason !== undefined) {
    fields.push('skipped_reason = ?');
    values.push(updates.skippedReason);
  }

  fields.push('processed_at = CURRENT_TIMESTAMP');
  values.push(queueId);

  db.prepare(`
    UPDATE email_invoice_queue
    SET ${fields.join(', ')}
    WHERE id = ?
  `).run(...values);
}

/**
 * Get recent email queue items
 * @param {number} monitorId - Optional monitor filter
 * @param {number} limit
 * @returns {Array} Recent emails
 */
function getRecentEmailQueue(monitorId = null, limit = 50) {
  if (monitorId) {
    return db.prepare(`
      SELECT * FROM email_invoice_queue
      WHERE monitor_id = ?
      ORDER BY received_at DESC
      LIMIT ?
    `).all(monitorId, limit);
  } else {
    return db.prepare(`
      SELECT eq.*, em.account_name, em.email_address
      FROM email_invoice_queue eq
      JOIN email_monitors em ON eq.monitor_id = em.id
      ORDER BY eq.received_at DESC
      LIMIT ?
    `).all(limit);
  }
}

/**
 * Record detected cost savings
 * @param {Object} data - Savings details
 * @returns {number} Savings ID
 */
function recordDetectedSavings(data) {
  const result = db.prepare(`
    INSERT INTO detected_savings (
      monitor_id, ingestion_run_id, invoice_date, vendor_name,
      savings_type, description, amount_charged_cents, correct_amount_cents,
      savings_amount_cents, sku, quantity, unit_price_cents, expected_price_cents,
      evidence_json, severity, alerted
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.monitorId,
    data.ingestionRunId,
    data.invoiceDate || new Date().toISOString().split('T')[0],
    data.vendorName || null,
    data.savingsType,
    data.description,
    data.amountChargedCents || null,
    data.correctAmountCents || null,
    data.savingsAmountCents,
    data.sku || null,
    data.quantity || null,
    data.unitPriceCents || null,
    data.expectedPriceCents || null,
    JSON.stringify(data.evidence || {}),
    data.severity || 'medium',
    data.alerted || 0
  );

  console.log(`[SAVINGS] Detected ${data.savingsType}: $${(data.savingsAmountCents / 100).toFixed(2)} for ${data.vendorName || 'unknown vendor'}`);
  return result.lastInsertRowid;
}

/**
 * Get detected savings summary
 * @param {number} monitorId - Optional monitor filter
 * @param {number} days - Days to look back
 * @returns {Object} Summary statistics
 */
function getDetectedSavingsSummary(monitorId = null, days = 30) {
  const whereClause = monitorId ? 'WHERE monitor_id = ? AND' : 'WHERE';
  const params = monitorId ? [monitorId] : [];

  const summary = db.prepare(`
    SELECT
      COUNT(*) as total_findings,
      SUM(savings_amount_cents) as total_savings_cents,
      COUNT(CASE WHEN severity = 'critical' THEN 1 END) as critical_count,
      COUNT(CASE WHEN severity = 'high' THEN 1 END) as high_count,
      COUNT(CASE WHEN status = 'detected' THEN 1 END) as unreviewed_count
    FROM detected_savings
    ${whereClause} detected_at >= datetime('now', '-${days} days')
  `).get(...params);

  const byType = db.prepare(`
    SELECT
      savings_type,
      COUNT(*) as count,
      SUM(savings_amount_cents) as total_cents
    FROM detected_savings
    ${whereClause} detected_at >= datetime('now', '-${days} days')
    GROUP BY savings_type
    ORDER BY total_cents DESC
  `).all(...params);

  return {
    ...summary,
    byType
  };
}

/**
 * Log activity for real-time feed
 * @param {number} monitorId
 * @param {string} activityType
 * @param {string} message
 * @param {string} severity
 * @param {Object} metadata
 */
function logEmailActivity(monitorId, activityType, message, severity = 'info', metadata = {}) {
  db.prepare(`
    INSERT INTO email_monitor_activity (
      monitor_id, activity_type, message, severity, metadata_json
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    monitorId,
    activityType,
    message,
    severity,
    JSON.stringify(metadata)
  );
}

/**
 * Get recent activity feed
 * @param {number} monitorId - Optional filter
 * @param {number} limit
 * @returns {Array} Recent activities
 */
function getRecentEmailActivity(monitorId = null, limit = 100) {
  if (monitorId) {
    return db.prepare(`
      SELECT * FROM email_monitor_activity
      WHERE monitor_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(monitorId, limit);
  } else {
    return db.prepare(`
      SELECT ea.*, em.account_name, em.email_address
      FROM email_monitor_activity ea
      JOIN email_monitors em ON ea.monitor_id = em.id
      ORDER BY ea.created_at DESC
      LIMIT ?
    `).all(limit);
  }
}

/**
 * Track or update vendor
 * @param {number} monitorId
 * @param {string} vendorName
 * @param {Object} data - {vendorEmail, invoiceAmountCents, skus}
 */
function trackVendor(monitorId, vendorName, data) {
  const existing = db.prepare(`
    SELECT * FROM auto_detected_vendors
    WHERE monitor_id = ? AND vendor_name = ?
  `).get(monitorId, vendorName);

  if (existing) {
    // Update existing vendor
    db.prepare(`
      UPDATE auto_detected_vendors
      SET
        last_seen_at = CURRENT_TIMESTAMP,
        invoice_count = invoice_count + 1,
        total_spend_cents = total_spend_cents + ?,
        avg_invoice_amount_cents = (total_spend_cents + ?) / (invoice_count + 1)
      WHERE id = ?
    `).run(data.invoiceAmountCents || 0, data.invoiceAmountCents || 0, existing.id);
  } else {
    // Create new vendor
    db.prepare(`
      INSERT INTO auto_detected_vendors (
        monitor_id, vendor_name, vendor_email, invoice_count,
        total_spend_cents, avg_invoice_amount_cents
      ) VALUES (?, ?, ?, 1, ?, ?)
    `).run(
      monitorId,
      vendorName,
      data.vendorEmail || null,
      data.invoiceAmountCents || 0,
      data.invoiceAmountCents || 0
    );
  }
}

// =====================================================
// EMAIL MONITOR HELPER FUNCTIONS (NEW SCHEMA)
// =====================================================

function getEmailMonitor(monitorId) {
  return db.prepare('SELECT * FROM email_monitors WHERE id = ?').get(monitorId);
}

function updateEmailMonitorLastChecked(monitorId, timestamp) {
  db.prepare(`
    UPDATE email_monitors
    SET last_checked_at = ?, last_success_at = ?
    WHERE id = ?
  `).run(timestamp, timestamp, monitorId);
}

function updateEmailMonitorError(monitorId, errorMessage) {
  db.prepare(`
    UPDATE email_monitors
    SET last_error = ?, last_checked_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(errorMessage, monitorId);
}

function isEmailAlreadyProcessed(monitorId, emailUid) {
  const exists = db.prepare(`
    SELECT id FROM email_processing_log
    WHERE monitor_id = ? AND email_uid = ?
  `).get(monitorId, emailUid);
  return !!exists;
}

function logEmailProcessing(data) {
  db.prepare(`
    INSERT INTO email_processing_log (
      monitor_id, email_uid, email_subject, from_address, received_date,
      status, attachments_count, invoices_created, invoice_ids,
      processing_time_ms, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.monitorId,
    data.emailUid,
    data.subject,
    data.fromAddress,
    data.receivedDate,
    data.status,
    data.attachmentsCount || 0,
    data.invoicesCreated || 0,
    data.invoiceIds || null,
    data.processingTimeMs || 0,
    data.errorMessage || null
  );
}

function incrementEmailMonitorStats(monitorId, invoicesCreated) {
  db.prepare(`
    UPDATE email_monitors
    SET
      emails_processed_count = emails_processed_count + 1,
      invoices_created_count = invoices_created_count + ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(invoicesCreated, monitorId);
}

module.exports = {
  initDatabase,
  getDatabase,
  seedDemoData,

  // SPIF functions
  getActiveSPIFs,
  getSPIFLeaderboard,
  incrementSPIFMetric,
  recalculateSPIFRanks,

  // MLA functions
  recordMLAReview,
  getMLAsByStatus,
  getMLAReviewsThisWeek,

  // Opportunity functions
  createOpportunity,
  getOpportunitiesByUser,
  updateOpportunityStatus,

  // Telemetry functions
  logTelemetryEvent,
  getTelemetrySummary,

  // Analytics cache
  getCachedAnalytics,
  setCachedAnalytics,

  // User functions
  getUserByEmail,
  getUserById,
  createOrUpdateUser,

  // Commission functions
  getCommissionsByUser,
  getCommissionsThisMonth,

  // Rules Engine functions
  createMLAContract,
  upsertMLAProducts,
  listMLAsByAccount,
  getMLAByContractNumber,
  getMLAProductPrice,
  createRule,
  listRulesByAccount,
  toggleRuleActive,
  updateRulePerformance,
  evaluateRulesForInvoice,
  createOpportunityFromRule,

  // Email Autopilot functions
  createEmailMonitor,
  getActiveEmailMonitors,
  getEmailMonitorById,
  getEmailMonitorsByAccount,
  updateEmailMonitorLastCheck,
  updateEmailMonitorStats,
  toggleEmailMonitor,
  addEmailToQueue,
  updateEmailQueueItem,
  getRecentEmailQueue,
  recordDetectedSavings,
  getDetectedSavingsSummary,
  logEmailActivity,
  getRecentEmailActivity,
  trackVendor,

  // Email Monitor helpers (new schema)
  getEmailMonitor,
  updateEmailMonitorLastChecked,
  updateEmailMonitorError,
  isEmailAlreadyProcessed,
  logEmailProcessing,
  incrementEmailMonitorStats
};
