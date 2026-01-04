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

CREATE INDEX idx_mla_products_sku ON mla_products(sku, mla_id);
CREATE INDEX idx_mla_products_mla ON mla_products(mla_id, approved);
CREATE INDEX idx_mla_contracts_account ON mla_contracts(account_name, status);

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

CREATE INDEX idx_opportunity_rules_account ON opportunity_rules(account_name, is_active);
CREATE INDEX idx_opportunity_rules_active ON opportunity_rules(is_active, priority);
CREATE INDEX idx_rule_triggers_sku ON opportunity_rule_triggers(trigger_sku);

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

CREATE INDEX idx_rule_performance_rule ON rule_performance_log(rule_id, fired_at);

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
