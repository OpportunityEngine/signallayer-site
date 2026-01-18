-- =====================================================
-- INTENT SIGNALS SCHEMA
-- Revenue Radar - Business Intent Detection
-- =====================================================
-- Tracks businesses showing purchase intent in target
-- geographic areas for configured keywords
-- =====================================================

-- User intent signal configurations
CREATE TABLE IF NOT EXISTS intent_signal_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    config_name TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,

    -- Target keywords (JSON array)
    keywords TEXT NOT NULL,  -- e.g., '["restaurant equipment","commercial kitchen","food service supplies"]'

    -- Target zip codes (JSON array)
    zip_codes TEXT NOT NULL,  -- e.g., '["90210","90211","90212"]'

    -- Optional filters
    industry_filter TEXT,              -- JSON array of industry names
    company_size_min INTEGER,          -- Min employees
    company_size_max INTEGER,          -- Max employees
    revenue_min_cents INTEGER,         -- Min annual revenue
    revenue_max_cents INTEGER,         -- Max annual revenue

    -- Notification preferences
    notify_critical INTEGER DEFAULT 1,
    notify_high INTEGER DEFAULT 1,
    notify_medium INTEGER DEFAULT 0,
    notify_low INTEGER DEFAULT 0,
    notification_email TEXT,           -- Optional email for alerts

    -- Check frequency (minutes)
    check_frequency_minutes INTEGER DEFAULT 30,

    -- Stats
    total_matches INTEGER DEFAULT 0,
    total_contacts INTEGER DEFAULT 0,
    total_won INTEGER DEFAULT 0,
    total_revenue_won_cents INTEGER DEFAULT 0,
    last_match_at DATETIME,
    last_check_at DATETIME,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_intent_configs_user ON intent_signal_configs(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_intent_configs_active ON intent_signal_configs(is_active);

-- Detected intent signal matches
CREATE TABLE IF NOT EXISTS intent_signal_matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    config_id INTEGER NOT NULL,

    -- Company info
    company_name TEXT NOT NULL,
    company_address TEXT,
    company_city TEXT,
    company_state TEXT,
    company_zip TEXT,
    company_phone TEXT,
    company_website TEXT,
    company_industry TEXT,
    company_sic_code TEXT,
    company_naics_code TEXT,
    company_employee_count INTEGER,
    company_revenue_cents INTEGER,
    company_founding_year INTEGER,

    -- Match details
    matched_keyword TEXT NOT NULL,
    keyword_match_strength INTEGER CHECK(keyword_match_strength BETWEEN 0 AND 100),  -- 0-100
    search_context TEXT,               -- What they searched or the intent signal content
    intent_source TEXT DEFAULT 'demo' CHECK(intent_source IN ('demo', 'bombora', 'zoominfo', 'google_ads', 'linkedin', 'g2', 'manual')),
    intent_category TEXT CHECK(intent_category IN ('research', 'comparison', 'purchase_ready')),

    -- Scoring (0-100 scale)
    overall_score INTEGER NOT NULL,    -- Composite score
    recency_score INTEGER,             -- Based on signal freshness
    fit_score INTEGER,                 -- Based on company profile match
    engagement_score INTEGER,          -- Based on signal intensity

    -- Priority derived from scores
    priority TEXT CHECK(priority IN ('critical', 'high', 'medium', 'low')) NOT NULL,

    -- Time tracking
    signal_detected_at DATETIME NOT NULL,  -- When the intent was detected
    freshness_hours REAL,              -- How old the signal is (calculated)
    expires_at DATETIME,               -- When signal becomes stale (48 hours default)

    -- Contact info (when available)
    contact_name TEXT,
    contact_title TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    contact_linkedin TEXT,
    decision_maker_likelihood INTEGER CHECK(decision_maker_likelihood BETWEEN 0 AND 100),

    -- Status tracking
    status TEXT CHECK(status IN ('new', 'viewed', 'contacted', 'qualified', 'won', 'lost', 'expired')) DEFAULT 'new',
    viewed_at DATETIME,
    contacted_at DATETIME,
    qualified_at DATETIME,
    closed_at DATETIME,
    outcome TEXT,                      -- Notes on win/loss
    outcome_value_cents INTEGER,       -- If won, what was the deal value?

    -- Metadata
    raw_data TEXT,                     -- JSON blob of original API response
    notes TEXT,
    is_archived INTEGER DEFAULT 0,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (config_id) REFERENCES intent_signal_configs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_intent_matches_user ON intent_signal_matches(user_id, status, priority);
CREATE INDEX IF NOT EXISTS idx_intent_matches_config ON intent_signal_matches(config_id);
CREATE INDEX IF NOT EXISTS idx_intent_matches_priority ON intent_signal_matches(priority, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_intent_matches_fresh ON intent_signal_matches(expires_at, status);
CREATE INDEX IF NOT EXISTS idx_intent_matches_company ON intent_signal_matches(company_zip, matched_keyword);
CREATE INDEX IF NOT EXISTS idx_intent_matches_new ON intent_signal_matches(user_id, status, created_at DESC) WHERE status = 'new';

-- Action tracking for matches (full audit trail)
CREATE TABLE IF NOT EXISTS intent_signal_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    action_type TEXT CHECK(action_type IN (
        'viewed', 'contacted_email', 'contacted_phone', 'contacted_linkedin',
        'meeting_scheduled', 'proposal_sent', 'follow_up', 'qualified',
        'disqualified', 'won', 'lost', 'note_added', 'archived', 'unarchived'
    )) NOT NULL,
    notes TEXT,
    outcome TEXT,
    deal_value_cents INTEGER,
    next_action TEXT,
    next_action_date DATE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (match_id) REFERENCES intent_signal_matches(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_intent_actions_match ON intent_signal_actions(match_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_intent_actions_user ON intent_signal_actions(user_id, created_at DESC);

-- Data source adapters configuration
CREATE TABLE IF NOT EXISTS intent_data_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_name TEXT UNIQUE NOT NULL,  -- 'demo', 'bombora', 'zoominfo', 'google_ads'
    display_name TEXT NOT NULL,
    is_enabled INTEGER DEFAULT 0,
    is_demo INTEGER DEFAULT 0,         -- True for simulation mode
    api_endpoint TEXT,
    api_key_encrypted TEXT,
    api_secret_encrypted TEXT,
    rate_limit_per_minute INTEGER DEFAULT 60,
    rate_limit_per_day INTEGER DEFAULT 10000,
    config_json TEXT,                  -- Additional configuration
    last_sync_at DATETIME,
    last_error TEXT,
    error_count INTEGER DEFAULT 0,
    requests_today INTEGER DEFAULT 0,
    requests_this_minute INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Insert default demo source
INSERT OR IGNORE INTO intent_data_sources (source_name, display_name, is_enabled, is_demo)
VALUES ('demo', 'Demo Mode (Simulated)', 1, 1);

-- Sync history for audit
CREATE TABLE IF NOT EXISTS intent_sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL,
    config_id INTEGER,
    sync_type TEXT CHECK(sync_type IN ('scheduled', 'manual', 'webhook')),
    status TEXT CHECK(status IN ('started', 'completed', 'failed')),
    records_fetched INTEGER DEFAULT 0,
    records_matched INTEGER DEFAULT 0,
    records_new INTEGER DEFAULT 0,
    error_message TEXT,
    duration_ms INTEGER,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    FOREIGN KEY (source_id) REFERENCES intent_data_sources(id),
    FOREIGN KEY (config_id) REFERENCES intent_signal_configs(id)
);

CREATE INDEX IF NOT EXISTS idx_sync_log_source ON intent_sync_log(source_id, started_at DESC);

-- Analytics view for quick dashboard stats
CREATE VIEW IF NOT EXISTS v_intent_signal_summary AS
SELECT
    user_id,
    COUNT(*) as total_signals,
    COUNT(CASE WHEN status = 'new' THEN 1 END) as new_count,
    COUNT(CASE WHEN status = 'viewed' THEN 1 END) as viewed_count,
    COUNT(CASE WHEN status = 'contacted' THEN 1 END) as contacted_count,
    COUNT(CASE WHEN status = 'qualified' THEN 1 END) as qualified_count,
    COUNT(CASE WHEN status = 'won' THEN 1 END) as won_count,
    COUNT(CASE WHEN status = 'lost' THEN 1 END) as lost_count,
    COUNT(CASE WHEN priority = 'critical' AND status = 'new' THEN 1 END) as critical_new,
    COUNT(CASE WHEN priority = 'high' AND status = 'new' THEN 1 END) as high_new,
    COUNT(CASE WHEN priority = 'critical' AND status IN ('new', 'viewed') THEN 1 END) as critical_open,
    COUNT(CASE WHEN priority = 'high' AND status IN ('new', 'viewed') THEN 1 END) as high_open,
    SUM(CASE WHEN status = 'won' THEN outcome_value_cents ELSE 0 END) as total_won_value_cents,
    AVG(CASE WHEN status IN ('contacted', 'qualified', 'won')
        THEN (julianday(contacted_at) - julianday(created_at)) * 24
        ELSE NULL END) as avg_response_time_hours,
    ROUND(
        CAST(COUNT(CASE WHEN status = 'won' THEN 1 END) AS REAL) /
        NULLIF(COUNT(CASE WHEN status IN ('contacted', 'qualified', 'won', 'lost') THEN 1 END), 0) * 100,
        1
    ) as win_rate_pct
FROM intent_signal_matches
WHERE is_archived = 0
GROUP BY user_id;

-- View for active signals (not expired, not archived)
CREATE VIEW IF NOT EXISTS v_active_intent_signals AS
SELECT
    m.*,
    c.config_name,
    c.keywords as config_keywords,
    c.zip_codes as config_zip_codes,
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
WHERE m.is_archived = 0
  AND m.status != 'expired'
  AND m.expires_at > datetime('now');
