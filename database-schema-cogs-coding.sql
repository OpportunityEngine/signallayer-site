-- =====================================================
-- COGS CODING SCHEMA
-- Revenue Radar - Invoice Cost Categorization
-- =====================================================
-- Enables restaurant managers to define expense categories
-- and map SKUs/products to automatically categorize and
-- code invoices from the Email Autopilot system
-- =====================================================

-- User-defined COGS categories (expense codes)
CREATE TABLE IF NOT EXISTS cogs_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,

    -- Category details
    code TEXT NOT NULL,                    -- Short code: "PROD", "MEAT", "DAIRY"
    name TEXT NOT NULL,                    -- Full name: "Produce", "Meat & Poultry"
    description TEXT,                      -- Optional description
    color TEXT DEFAULT '#6366f1',          -- Color for UI display
    icon TEXT DEFAULT 'tag',               -- Icon identifier

    -- Budget tracking (optional)
    monthly_budget_cents INTEGER,          -- Target monthly spend
    alert_threshold_pct INTEGER DEFAULT 90, -- Alert when this % of budget reached

    -- Organization
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,

    -- Stats (updated by trigger/background process)
    total_spend_cents INTEGER DEFAULT 0,
    mtd_spend_cents INTEGER DEFAULT 0,     -- Month-to-date
    ytd_spend_cents INTEGER DEFAULT 0,     -- Year-to-date
    item_count INTEGER DEFAULT 0,          -- Number of SKUs mapped
    last_transaction_at DATETIME,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, code)
);

CREATE INDEX IF NOT EXISTS idx_cogs_categories_user ON cogs_categories(user_id, is_active);

-- SKU to Category mappings
CREATE TABLE IF NOT EXISTS cogs_sku_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    category_id INTEGER NOT NULL,

    -- SKU identification (flexible matching)
    sku TEXT,                              -- Exact SKU number
    product_name TEXT,                     -- Product name (for fuzzy matching)
    vendor_name TEXT,                      -- Optional: vendor-specific mapping

    -- Match rules
    match_type TEXT DEFAULT 'exact',       -- exact, contains, starts_with, regex
    match_priority INTEGER DEFAULT 0,      -- Higher = checked first

    -- Learned pricing (auto-updated from invoices)
    last_unit_price_cents INTEGER,
    avg_unit_price_cents INTEGER,
    min_unit_price_cents INTEGER,
    max_unit_price_cents INTEGER,
    price_sample_count INTEGER DEFAULT 0,
    last_price_updated_at DATETIME,

    -- Unit info
    unit_of_measure TEXT,                  -- ea, lb, cs, gal, etc.
    pack_size TEXT,                        -- "12ct", "6/5lb", etc.

    -- Stats
    times_matched INTEGER DEFAULT 0,
    total_spend_cents INTEGER DEFAULT 0,
    last_matched_at DATETIME,

    -- Source
    source TEXT DEFAULT 'manual',          -- manual, auto_learned, imported
    confidence_score INTEGER DEFAULT 100,  -- For auto-learned mappings

    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES cogs_categories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cogs_sku_user ON cogs_sku_mappings(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_cogs_sku_category ON cogs_sku_mappings(category_id);
CREATE INDEX IF NOT EXISTS idx_cogs_sku_lookup ON cogs_sku_mappings(user_id, sku);
CREATE INDEX IF NOT EXISTS idx_cogs_product_lookup ON cogs_sku_mappings(user_id, product_name);

-- Coded invoice line items (links scanned invoices to categories)
CREATE TABLE IF NOT EXISTS cogs_coded_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,

    -- Source invoice
    ingestion_run_id INTEGER,              -- From email autopilot
    monitor_id INTEGER,
    invoice_date DATE NOT NULL,
    vendor_name TEXT,
    invoice_number TEXT,

    -- Line item details
    sku TEXT,
    product_name TEXT NOT NULL,
    quantity DECIMAL,
    unit_of_measure TEXT,
    unit_price_cents INTEGER,
    extended_price_cents INTEGER NOT NULL, -- quantity * unit_price

    -- Categorization
    category_id INTEGER,                   -- NULL if uncategorized
    mapping_id INTEGER,                    -- Which SKU mapping matched
    coding_method TEXT DEFAULT 'auto',     -- auto, manual, suggested
    confidence_score INTEGER,              -- How confident the auto-match was

    -- For uncategorized items
    suggested_category_id INTEGER,         -- AI suggestion
    needs_review INTEGER DEFAULT 0,

    -- Timestamps
    invoice_received_at DATETIME,
    coded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    reviewed_at DATETIME,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES cogs_categories(id) ON DELETE SET NULL,
    FOREIGN KEY (mapping_id) REFERENCES cogs_sku_mappings(id) ON DELETE SET NULL,
    FOREIGN KEY (monitor_id) REFERENCES email_monitors(id) ON DELETE SET NULL,
    FOREIGN KEY (ingestion_run_id) REFERENCES ingestion_runs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_coded_items_user ON cogs_coded_items(user_id, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_coded_items_category ON cogs_coded_items(category_id, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_coded_items_review ON cogs_coded_items(user_id, needs_review) WHERE needs_review = 1;
CREATE INDEX IF NOT EXISTS idx_coded_items_uncategorized ON cogs_coded_items(user_id, category_id) WHERE category_id IS NULL;

-- Price history for tracked products
CREATE TABLE IF NOT EXISTS cogs_price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mapping_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,

    -- Price data
    unit_price_cents INTEGER NOT NULL,
    quantity DECIMAL,
    vendor_name TEXT,
    invoice_date DATE NOT NULL,

    -- Source
    coded_item_id INTEGER,
    ingestion_run_id INTEGER,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (mapping_id) REFERENCES cogs_sku_mappings(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (coded_item_id) REFERENCES cogs_coded_items(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_price_history_mapping ON cogs_price_history(mapping_id, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_price_history_user ON cogs_price_history(user_id, invoice_date DESC);

-- COGS spending summaries (pre-aggregated for fast reporting)
CREATE TABLE IF NOT EXISTS cogs_spending_summary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    category_id INTEGER NOT NULL,

    -- Time period
    period_type TEXT NOT NULL,             -- daily, weekly, monthly, yearly
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,

    -- Aggregated data
    total_spend_cents INTEGER DEFAULT 0,
    item_count INTEGER DEFAULT 0,
    invoice_count INTEGER DEFAULT 0,
    avg_item_price_cents INTEGER DEFAULT 0,

    -- Comparison
    prev_period_spend_cents INTEGER,
    spend_change_pct DECIMAL,

    -- Budget tracking
    budget_cents INTEGER,
    budget_remaining_cents INTEGER,
    budget_pct_used DECIMAL,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES cogs_categories(id) ON DELETE CASCADE,
    UNIQUE(user_id, category_id, period_type, period_start)
);

CREATE INDEX IF NOT EXISTS idx_spending_summary_lookup ON cogs_spending_summary(user_id, period_type, period_start DESC);

-- Auto-learning suggestions (for uncategorized items)
CREATE TABLE IF NOT EXISTS cogs_learning_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,

    -- Item to learn
    sku TEXT,
    product_name TEXT NOT NULL,
    vendor_name TEXT,

    -- Suggested category based on patterns
    suggested_category_id INTEGER,
    suggestion_reason TEXT,                -- "Similar to other Produce items"
    confidence_score INTEGER,

    -- Stats
    occurrence_count INTEGER DEFAULT 1,
    total_spend_cents INTEGER DEFAULT 0,
    first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    -- Status
    status TEXT DEFAULT 'pending',         -- pending, approved, rejected, ignored
    resolved_at DATETIME,
    resolved_category_id INTEGER,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (suggested_category_id) REFERENCES cogs_categories(id) ON DELETE SET NULL,
    FOREIGN KEY (resolved_category_id) REFERENCES cogs_categories(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_learning_queue_user ON cogs_learning_queue(user_id, status);

-- View for COGS dashboard summary
CREATE VIEW IF NOT EXISTS v_cogs_summary AS
SELECT
    c.user_id,
    c.id as category_id,
    c.code,
    c.name,
    c.color,
    c.monthly_budget_cents,
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
    COALESCE(SUM(ci.extended_price_cents), 0) as total_spend_cents,
    COUNT(DISTINCT ci.id) as item_count,
    COUNT(DISTINCT sm.id) as mapped_sku_count
FROM cogs_categories c
LEFT JOIN cogs_coded_items ci ON ci.category_id = c.id
LEFT JOIN cogs_sku_mappings sm ON sm.category_id = c.id AND sm.is_active = 1
WHERE c.is_active = 1
GROUP BY c.id;

-- View for uncategorized items needing attention
CREATE VIEW IF NOT EXISTS v_uncategorized_items AS
SELECT
    ci.user_id,
    ci.sku,
    ci.product_name,
    ci.vendor_name,
    COUNT(*) as occurrence_count,
    SUM(ci.extended_price_cents) as total_spend_cents,
    MAX(ci.invoice_date) as last_seen,
    lq.suggested_category_id,
    cat.name as suggested_category_name,
    lq.confidence_score
FROM cogs_coded_items ci
LEFT JOIN cogs_learning_queue lq ON lq.user_id = ci.user_id
    AND (lq.sku = ci.sku OR lq.product_name = ci.product_name)
    AND lq.status = 'pending'
LEFT JOIN cogs_categories cat ON cat.id = lq.suggested_category_id
WHERE ci.category_id IS NULL
GROUP BY ci.user_id, COALESCE(ci.sku, ci.product_name)
ORDER BY total_spend_cents DESC;

-- Insert default categories for new users (called from application code)
-- Common restaurant COGS categories:
-- INSERT INTO cogs_categories (user_id, code, name, color, icon, sort_order) VALUES
-- (?, 'FOOD', 'Food & Beverage', '#22c55e', 'utensils', 1),
-- (?, 'PROD', 'Produce', '#84cc16', 'leaf', 2),
-- (?, 'MEAT', 'Meat & Poultry', '#ef4444', 'drumstick', 3),
-- (?, 'SFOOD', 'Seafood', '#3b82f6', 'fish', 4),
-- (?, 'DAIRY', 'Dairy & Eggs', '#fbbf24', 'cheese', 5),
-- (?, 'BEV', 'Beverages', '#8b5cf6', 'wine', 6),
-- (?, 'DRY', 'Dry Goods & Grocery', '#f97316', 'box', 7),
-- (?, 'PAPER', 'Paper & Disposables', '#64748b', 'package', 8),
-- (?, 'CLEAN', 'Cleaning & Chemicals', '#06b6d4', 'sparkles', 9),
-- (?, 'EQUIP', 'Equipment & Smallwares', '#ec4899', 'wrench', 10),
-- (?, 'OTHER', 'Other/Miscellaneous', '#94a3b8', 'ellipsis', 99);
