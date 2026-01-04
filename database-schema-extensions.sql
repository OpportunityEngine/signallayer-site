-- Rules-Driven Opportunity Engine Schema Extensions
-- Adds: MLA Products, Opportunity Rules, Commission Intelligence
-- Compatible with existing database-schema.sql

-- ============================================
-- MLA CONTRACT PRODUCTS & PRICING
-- ============================================

-- Enhanced MLA table (extends existing mlas table via ALTER or new fields)
-- Note: If mlas table exists, these fields may need to be added via ALTER TABLE
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

-- MLA Products with contract pricing
CREATE TABLE IF NOT EXISTS mla_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mla_id INTEGER NOT NULL,
    sku TEXT NOT NULL,
    description TEXT,
    price_cents INTEGER NOT NULL, -- Contract price in cents
    uom TEXT, -- Unit of measure (EA, BX, CS, etc.)
    approved BOOLEAN DEFAULT TRUE,
    min_qty INTEGER, -- Minimum order quantity
    max_qty INTEGER, -- Maximum order quantity
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

-- Main rules table
CREATE TABLE IF NOT EXISTS opportunity_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_name TEXT, -- NULL = applies to all accounts
    industry TEXT, -- NULL = applies to all industries
    name TEXT NOT NULL,
    description TEXT,
    created_by_user_id INTEGER NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    priority INTEGER DEFAULT 100, -- Lower number = higher priority
    win_rate REAL, -- Historical success rate (0-1)
    times_fired INTEGER DEFAULT 0,
    opportunities_created INTEGER DEFAULT 0,
    revenue_generated_cents INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by_user_id) REFERENCES users(id)
);

-- Trigger SKUs that activate the rule
CREATE TABLE IF NOT EXISTS opportunity_rule_triggers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id INTEGER NOT NULL,
    trigger_sku TEXT NOT NULL,
    FOREIGN KEY (rule_id) REFERENCES opportunity_rules(id) ON DELETE CASCADE
);

-- Conditions that must be met (qty comparisons, etc.)
CREATE TABLE IF NOT EXISTS opportunity_rule_conditions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id INTEGER NOT NULL,
    condition_group INTEGER DEFAULT 1, -- For OR logic grouping
    left_operand_type TEXT NOT NULL CHECK(left_operand_type IN ('invoice_qty', 'invoice_total', 'sku_present', 'sku_absent')),
    left_operand_value TEXT, -- SKU for qty checks
    operator TEXT NOT NULL CHECK(operator IN ('>', '<', '>=', '<=', '==', '!=')),
    right_value TEXT NOT NULL, -- Number for comparisons
    logic TEXT DEFAULT 'AND' CHECK(logic IN ('AND', 'OR')),
    FOREIGN KEY (rule_id) REFERENCES opportunity_rules(id) ON DELETE CASCADE
);

-- Actions to take when rule fires
CREATE TABLE IF NOT EXISTS opportunity_rule_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id INTEGER NOT NULL,
    action_type TEXT NOT NULL CHECK(action_type IN ('recommend_sku', 'flag_compliance', 'create_alert', 'suggest_bundle')),
    recommended_sku TEXT,
    recommended_qty_target INTEGER,
    recommended_qty_min INTEGER,
    notes_talk_track TEXT, -- What rep should say
    auto_create_opportunity BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (rule_id) REFERENCES opportunity_rules(id) ON DELETE CASCADE
);

CREATE INDEX idx_opportunity_rules_account ON opportunity_rules(account_name, is_active);
CREATE INDEX idx_opportunity_rules_active ON opportunity_rules(is_active, priority);
CREATE INDEX idx_rule_triggers_sku ON opportunity_rule_triggers(trigger_sku);

-- ============================================
-- ENHANCED OPPORTUNITIES TABLE
-- ============================================

-- Extend existing opportunities table with new fields
-- Note: If running on existing DB, use ALTER TABLE statements below

CREATE TABLE IF NOT EXISTS opportunities_extended (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- Existing fields
    account_name TEXT NOT NULL,
    opportunity_type TEXT CHECK(opportunity_type IN ('mla_renewal', 'equipment_upgrade', 'contract_expansion', 'new_service', 'price_correction', 'contract_approved', 'compliance', 'bundle')),
    status TEXT CHECK(status IN ('detected', 'open', 'contacted', 'in_progress', 'won', 'lost', 'deferred', 'closed')) DEFAULT 'detected',
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
    
    -- NEW FIELDS for rules engine
    source_type TEXT CHECK(source_type IN ('invoice', 'rule', 'manager_manual', 'ml_prediction')) DEFAULT 'invoice',
    rule_id INTEGER, -- Which rule created this
    trigger_sku TEXT, -- SKU that triggered the rule
    recommended_sku TEXT, -- SKU being recommended
    contract_price_cents INTEGER, -- Price from MLA
    commission_rate_used REAL, -- Actual rate used (0-1)
    explainability_json TEXT, -- JSON: why this opportunity exists
    confidence_score REAL, -- How confident are we (0-1)
    talk_track TEXT, -- What rep should say
    created_by_user_id INTEGER, -- For manual opportunities
    
    -- Deduplication fields
    dedupe_key TEXT, -- account_name:recommended_sku:YYYY-MM-DD
    supersedes_opportunity_id INTEGER, -- If this replaces an older one
    
    FOREIGN KEY (assigned_to) REFERENCES users(id),
    FOREIGN KEY (source_run_id) REFERENCES ingestion_runs(id),
    FOREIGN KEY (mla_id) REFERENCES mla_contracts(id),
    FOREIGN KEY (rule_id) REFERENCES opportunity_rules(id),
    FOREIGN KEY (created_by_user_id) REFERENCES users(id),
    FOREIGN KEY (supersedes_opportunity_id) REFERENCES opportunities_extended(id)
);

CREATE INDEX idx_opportunities_source ON opportunities_extended(source_type, status, created_at);
CREATE INDEX idx_opportunities_rule ON opportunities_extended(rule_id, status);
CREATE INDEX idx_opportunities_dedupe ON opportunities_extended(dedupe_key, status);
CREATE INDEX idx_opportunities_recommended ON opportunities_extended(recommended_sku, account_name);

-- ============================================
-- COMMISSION STRUCTURES (Future-proofing)
-- ============================================

CREATE TABLE IF NOT EXISTS commission_structures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT CHECK(type IN ('percentage', 'flat_rate', 'tiered')) DEFAULT 'percentage',
    default_rate REAL, -- For percentage type
    flat_amount_cents INTEGER, -- For flat_rate type
    config_json TEXT, -- For tiered: JSON array of thresholds/rates
    applies_to TEXT CHECK(applies_to IN ('all', 'opportunity_type', 'product_category', 'user')) DEFAULT 'all',
    filter_value TEXT, -- e.g., 'mla_renewal' or user_id
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- RULE PERFORMANCE TRACKING
-- ============================================

CREATE TABLE IF NOT EXISTS rule_performance_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id INTEGER NOT NULL,
    fired_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    account_name TEXT,
    trigger_values_json TEXT, -- What triggered it
    opportunity_created_id INTEGER,
    invoice_run_id INTEGER,
    FOREIGN KEY (rule_id) REFERENCES opportunity_rules(id),
    FOREIGN KEY (opportunity_created_id) REFERENCES opportunities_extended(id),
    FOREIGN KEY (invoice_run_id) REFERENCES ingestion_runs(id)
);

CREATE INDEX idx_rule_performance_rule ON rule_performance_log(rule_id, fired_at);

-- ============================================
-- ALTER STATEMENTS (for existing databases)
-- ============================================
-- Run these if opportunities table already exists:

-- ALTER TABLE opportunities ADD COLUMN source_type TEXT DEFAULT 'invoice';
-- ALTER TABLE opportunities ADD COLUMN rule_id INTEGER;
-- ALTER TABLE opportunities ADD COLUMN trigger_sku TEXT;
-- ALTER TABLE opportunities ADD COLUMN recommended_sku TEXT;
-- ALTER TABLE opportunities ADD COLUMN contract_price_cents INTEGER;
-- ALTER TABLE opportunities ADD COLUMN commission_rate_used REAL;
-- ALTER TABLE opportunities ADD COLUMN explainability_json TEXT;
-- ALTER TABLE opportunities ADD COLUMN confidence_score REAL;
-- ALTER TABLE opportunities ADD COLUMN talk_track TEXT;
-- ALTER TABLE opportunities ADD COLUMN created_by_user_id INTEGER;
-- ALTER TABLE opportunities ADD COLUMN dedupe_key TEXT;
-- ALTER TABLE opportunities ADD COLUMN supersedes_opportunity_id INTEGER;

-- If mlas table needs contract_number:
-- ALTER TABLE mlas ADD COLUMN contract_number TEXT;
-- CREATE UNIQUE INDEX idx_mlas_contract_number ON mlas(contract_number);

