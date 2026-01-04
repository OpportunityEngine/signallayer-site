CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('rep', 'manager', 'admin', 'viewer', 'customer_admin')) DEFAULT 'rep',
    account_name TEXT,
    team_id INTEGER,
    is_active INTEGER DEFAULT 1,
    is_email_verified INTEGER DEFAULT 0,
    email_verification_token TEXT,
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until DATETIME,
    last_login_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_active DATETIME,
    FOREIGN KEY (team_id) REFERENCES teams(id)
);
-- sqlite_sequence is automatically created by SQLite when using AUTOINCREMENT
CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    manager_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (manager_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS ingestion_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL,
    account_name TEXT,
    vendor_name TEXT,
    file_name TEXT,
    file_size INTEGER,
    status TEXT CHECK(status IN ('processing', 'completed', 'failed')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    error_message TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS invoice_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    description TEXT,
    quantity REAL,
    unit_price_cents INTEGER,
    total_cents INTEGER,
    category TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (run_id) REFERENCES ingestion_runs(id)
);
CREATE TABLE IF NOT EXISTS mlas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_name TEXT NOT NULL,
    vendor_name TEXT,
    contract_value_cents INTEGER,
    start_date DATE,
    end_date DATE,
    status TEXT CHECK(status IN ('active', 'expiring', 'expired', 'renewed')),
    renewal_likelihood_pct INTEGER,
    last_reviewed_at DATETIME,
    last_reviewed_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (last_reviewed_by) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS mla_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mla_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    run_id INTEGER,
    action TEXT CHECK(action IN ('viewed', 'analyzed', 'contacted', 'updated')),
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (mla_id) REFERENCES mlas(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (run_id) REFERENCES ingestion_runs(id)
);
CREATE TABLE IF NOT EXISTS opportunities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_name TEXT NOT NULL,
    opportunity_type TEXT CHECK(opportunity_type IN ('mla_renewal', 'equipment_upgrade', 'contract_expansion', 'new_service', 'price_correction')),
    status TEXT CHECK(status IN ('detected', 'contacted', 'in_progress', 'won', 'lost', 'expired')),
    assigned_to INTEGER,
    likelihood_pct INTEGER,
    estimated_value_cents INTEGER,
    estimated_commission_cents INTEGER,
    source_run_id INTEGER,
    mla_id INTEGER,
    urgency TEXT CHECK(urgency IN ('low', 'medium', 'high', 'critical')),
    detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    first_contact_at DATETIME,
    last_activity_at DATETIME,
    close_date DATE,
    notes TEXT,
    FOREIGN KEY (assigned_to) REFERENCES users(id),
    FOREIGN KEY (source_run_id) REFERENCES ingestion_runs(id),
    FOREIGN KEY (mla_id) REFERENCES mlas(id)
);
CREATE TABLE IF NOT EXISTS opportunity_activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    opportunity_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    activity_type TEXT CHECK(activity_type IN ('contacted', 'meeting_scheduled', 'proposal_sent', 'follow_up', 'note_added', 'status_changed')),
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (opportunity_id) REFERENCES opportunities(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS spifs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    spif_type TEXT CHECK(spif_type IN ('mla_review_count', 'deals_closed', 'revenue_target', 'custom_metric')),
    metric_name TEXT, -- e.g., "mlas_reviewed", "deals_closed"
    target_value REAL, -- threshold to win
    prize_amount_cents INTEGER,
    start_date DATETIME NOT NULL,
    end_date DATETIME NOT NULL,
    status TEXT CHECK(status IN ('active', 'ended', 'paused')),
    top_n_winners INTEGER DEFAULT 3, -- top 3 reps win
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS spif_standings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    spif_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    current_value REAL NOT NULL, -- current metric value (e.g., 34 MLAs reviewed)
    rank INTEGER,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (spif_id) REFERENCES spifs(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(spif_id, user_id)
);
CREATE TABLE IF NOT EXISTS commissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    opportunity_id INTEGER,
    amount_cents INTEGER NOT NULL,
    commission_type TEXT CHECK(commission_type IN ('base', 'spif', 'bonus', 'override')),
    period_start DATE,
    period_end DATE,
    status TEXT CHECK(status IN ('pending', 'approved', 'paid')),
    payment_date DATE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (opportunity_id) REFERENCES opportunities(id)
);
CREATE TABLE IF NOT EXISTS telemetry_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    event_type TEXT NOT NULL, -- 'invoice_analyzed', 'mla_reviewed', 'lead_found', 'opportunity_viewed'
    event_data TEXT, -- JSON blob with event-specific data
    page_url TEXT,
    session_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_run_id INTEGER,
    account_name TEXT NOT NULL,
    contact_name TEXT,
    title TEXT,
    email TEXT,
    phone TEXT,
    company TEXT,
    city TEXT,
    state TEXT,
    postal_code TEXT,
    source TEXT CHECK(source IN ('apollo', 'osm', 'manual', 'imported')),
    confidence_score REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_run_id) REFERENCES ingestion_runs(id)
);
CREATE TABLE IF NOT EXISTS analytics_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cache_key TEXT UNIQUE NOT NULL,
    cache_value TEXT NOT NULL, -- JSON blob
    user_id INTEGER,
    team_id INTEGER,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (team_id) REFERENCES teams(id)
);
CREATE INDEX IF NOT EXISTS idx_mla_reviews_user_created ON mla_reviews(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mla_reviews_mla ON mla_reviews(mla_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_assigned ON opportunities(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_opportunities_detected ON opportunities(detected_at);
CREATE INDEX IF NOT EXISTS idx_spif_standings_spif ON spif_standings(spif_id, rank);
CREATE INDEX IF NOT EXISTS idx_telemetry_user_type ON telemetry_events(user_id, event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_commissions_user_period ON commissions(user_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_analytics_cache_key ON analytics_cache(cache_key, expires_at);
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_user ON ingestion_runs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_leads_run ON leads(source_run_id);
DROP VIEW IF EXISTS active_spif_leaderboards;
CREATE VIEW active_spif_leaderboards AS
SELECT
    s.id as spif_id,
    s.name as spif_name,
    s.spif_type,
    s.prize_amount_cents,
    s.end_date,
    ss.user_id,
    u.name as user_name,
    u.email as user_email,
    ss.current_value,
    ss.rank
FROM spifs s
JOIN spif_standings ss ON s.id = ss.spif_id
JOIN users u ON ss.user_id = u.id
WHERE s.status = 'active'
    AND ss.rank <= s.top_n_winners
ORDER BY s.id, ss.rank
/* active_spif_leaderboards(spif_id,spif_name,spif_type,prize_amount_cents,end_date,user_id,user_name,user_email,current_value,rank) */;
DROP VIEW IF EXISTS rep_performance;
CREATE VIEW rep_performance AS
SELECT
    u.id as user_id,
    u.name,
    u.email,
    COUNT(DISTINCT mr.id) as mlas_reviewed_count,
    COUNT(DISTINCT o.id) as opportunities_assigned_count,
    COUNT(DISTINCT CASE WHEN o.status = 'won' THEN o.id END) as opportunities_won_count,
    SUM(CASE WHEN o.status = 'won' THEN o.estimated_commission_cents ELSE 0 END) as total_commission_cents,
    MAX(mr.created_at) as last_activity_at
FROM users u
LEFT JOIN mla_reviews mr ON u.id = mr.user_id
LEFT JOIN opportunities o ON u.id = o.assigned_to
WHERE u.role = 'rep'
GROUP BY u.id, u.name, u.email
/* rep_performance(user_id,name,email,mlas_reviewed_count,opportunities_assigned_count,opportunities_won_count,total_commission_cents,last_activity_at) */;
-- ============================================
-- RULES ENGINE SCHEMA EXTENSIONS
-- Appends to existing database-schema.sql
-- ============================================

-- ============================================
-- MLA CONTRACT PRODUCTS & PRICING
-- ============================================

CREATE TABLE IF NOT EXISTS mla_contracts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contract_number TEXT UNIQUE NOT NULL,
    account_name TEXT NOT NULL,
    vendor_name TEXT,
    effective_date DATE,
    end_date DATE,
    status TEXT CHECK(status IN ('active', 'pending', 'expired', 'terminated')) DEFAULT 'active',
    created_by_user_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS mla_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mla_id INTEGER NOT NULL,
    sku TEXT NOT NULL,
    description TEXT,
    price_cents INTEGER NOT NULL,
    uom TEXT DEFAULT 'EA',
    approved BOOLEAN DEFAULT TRUE,
    min_qty INTEGER,
    max_qty INTEGER,
    effective_date DATE,
    end_date DATE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (mla_id) REFERENCES mla_contracts(id) ON DELETE CASCADE,
    UNIQUE(mla_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_mla_products_sku ON mla_products(sku, mla_id);
CREATE INDEX IF NOT EXISTS idx_mla_products_mla ON mla_products(mla_id, approved);
CREATE INDEX IF NOT EXISTS idx_mla_contracts_account ON mla_contracts(account_name, status);

-- ============================================
-- OPPORTUNITY RULES ENGINE
-- ============================================

CREATE TABLE IF NOT EXISTS opportunity_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_name TEXT,
    industry TEXT,
    name TEXT NOT NULL,
    description TEXT,
    created_by_user_id INTEGER NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    priority INTEGER DEFAULT 100,
    win_rate REAL,
    times_fired INTEGER DEFAULT 0,
    opportunities_created INTEGER DEFAULT 0,
    revenue_generated_cents INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS opportunity_rule_triggers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id INTEGER NOT NULL,
    trigger_sku TEXT NOT NULL,
    FOREIGN KEY (rule_id) REFERENCES opportunity_rules(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS opportunity_rule_conditions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id INTEGER NOT NULL,
    condition_group INTEGER DEFAULT 1,
    left_operand_type TEXT NOT NULL CHECK(left_operand_type IN ('invoice_qty', 'invoice_total', 'sku_present', 'sku_absent')),
    left_operand_value TEXT,
    operator TEXT NOT NULL CHECK(operator IN ('>', '<', '>=', '<=', '==', '!=')),
    right_value TEXT NOT NULL,
    logic TEXT DEFAULT 'AND' CHECK(logic IN ('AND', 'OR')),
    FOREIGN KEY (rule_id) REFERENCES opportunity_rules(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS opportunity_rule_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id INTEGER NOT NULL,
    action_type TEXT NOT NULL CHECK(action_type IN ('recommend_sku', 'flag_compliance', 'create_alert', 'suggest_bundle')),
    recommended_sku TEXT,
    recommended_qty_target INTEGER,
    recommended_qty_min INTEGER,
    notes_talk_track TEXT,
    auto_create_opportunity BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (rule_id) REFERENCES opportunity_rules(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_opportunity_rules_account ON opportunity_rules(account_name, is_active);
CREATE INDEX IF NOT EXISTS idx_opportunity_rules_active ON opportunity_rules(is_active, priority);
CREATE INDEX IF NOT EXISTS idx_rule_triggers_sku ON opportunity_rule_triggers(trigger_sku);

-- ============================================
-- RULE PERFORMANCE TRACKING
-- ============================================

CREATE TABLE IF NOT EXISTS rule_performance_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id INTEGER NOT NULL,
    fired_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    account_name TEXT,
    trigger_values_json TEXT,
    opportunity_created_id INTEGER,
    invoice_run_id INTEGER,
    FOREIGN KEY (rule_id) REFERENCES opportunity_rules(id),
    FOREIGN KEY (invoice_run_id) REFERENCES ingestion_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_rule_performance_rule ON rule_performance_log(rule_id, fired_at);

-- ============================================
-- COMMISSION STRUCTURES
-- ============================================

CREATE TABLE IF NOT EXISTS commission_structures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT CHECK(type IN ('percentage', 'flat_rate', 'tiered')) DEFAULT 'percentage',
    default_rate REAL,
    flat_amount_cents INTEGER,
    config_json TEXT,
    applies_to TEXT CHECK(applies_to IN ('all', 'opportunity_type', 'product_category', 'user')) DEFAULT 'all',
    filter_value TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
