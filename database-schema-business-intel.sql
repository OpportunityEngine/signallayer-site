-- =====================================================
-- REVENUE RADAR - BUSINESS INTELLIGENCE SCHEMA
-- =====================================================
-- Advanced analytics for inventory, payroll, cost savings,
-- opportunity detection, and lead management
-- =====================================================

-- =====================================================
-- INVENTORY MANAGEMENT
-- =====================================================

-- Customer inventory items (uploaded from Excel)
CREATE TABLE IF NOT EXISTS inventory_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    account_id INTEGER,  -- For multi-location businesses
    sku TEXT NOT NULL,
    product_name TEXT NOT NULL,
    category TEXT,
    subcategory TEXT,
    unit_of_measure TEXT DEFAULT 'each',  -- each, case, lb, oz, gal, etc.
    current_quantity REAL DEFAULT 0,
    min_quantity REAL DEFAULT 0,  -- Reorder point
    max_quantity REAL,  -- Max storage capacity
    par_level REAL,  -- Optimal stock level
    last_unit_cost_cents INTEGER,
    avg_unit_cost_cents INTEGER,
    vendor_id INTEGER,
    vendor_name TEXT,
    vendor_sku TEXT,
    lead_time_days INTEGER DEFAULT 7,
    is_active INTEGER DEFAULT 1,
    last_counted_at DATETIME,
    last_ordered_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_inventory_user_sku ON inventory_items(user_id, sku);
CREATE INDEX IF NOT EXISTS idx_inventory_category ON inventory_items(user_id, category);
CREATE INDEX IF NOT EXISTS idx_inventory_vendor ON inventory_items(vendor_name);

-- Inventory snapshots (weekly uploads)
CREATE TABLE IF NOT EXISTS inventory_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    snapshot_date DATE NOT NULL,
    file_name TEXT,
    total_items INTEGER,
    total_value_cents INTEGER,
    items_below_par INTEGER,
    items_overstocked INTEGER,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Inventory snapshot details (item-level data per snapshot)
CREATE TABLE IF NOT EXISTS inventory_snapshot_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL,
    inventory_item_id INTEGER NOT NULL,
    quantity REAL NOT NULL,
    unit_cost_cents INTEGER,
    total_value_cents INTEGER,
    status TEXT CHECK(status IN ('normal', 'low', 'critical', 'overstocked', 'expired')),
    FOREIGN KEY (snapshot_id) REFERENCES inventory_snapshots(id) ON DELETE CASCADE,
    FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id)
);

CREATE INDEX IF NOT EXISTS idx_snapshot_items ON inventory_snapshot_items(snapshot_id, inventory_item_id);

-- Usage tracking (calculated from invoice items + inventory changes)
CREATE TABLE IF NOT EXISTS inventory_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inventory_item_id INTEGER NOT NULL,
    date DATE NOT NULL,
    daily_usage REAL NOT NULL DEFAULT 0,
    quantity_received REAL DEFAULT 0,
    quantity_wasted REAL DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id),
    UNIQUE(inventory_item_id, date)
);

CREATE INDEX IF NOT EXISTS idx_usage_item_date ON inventory_usage(inventory_item_id, date DESC);

-- =====================================================
-- SMART REORDER RECOMMENDATIONS
-- =====================================================

CREATE TABLE IF NOT EXISTS reorder_recommendations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    inventory_item_id INTEGER NOT NULL,
    recommendation_type TEXT,  -- Extended types: urgent_reorder, supply_forecast, discount_opportunity, holiday_prep, bulk_opportunity, overstock_warning, usage_spike, usage_drop
    priority TEXT CHECK(priority IN ('critical', 'high', 'medium', 'low')),
    title TEXT,
    description TEXT,
    suggested_quantity REAL,
    potential_savings_cents INTEGER DEFAULT 0,
    reasoning TEXT,  -- JSON with detailed analysis data
    is_dismissed INTEGER DEFAULT 0,
    is_actioned INTEGER DEFAULT 0,
    actioned_at DATETIME,
    expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id)
);

CREATE INDEX IF NOT EXISTS idx_reorder_user_active ON reorder_recommendations(user_id, is_dismissed, is_actioned);
CREATE INDEX IF NOT EXISTS idx_reorder_priority ON reorder_recommendations(user_id, priority, created_at DESC);

-- =====================================================
-- ENHANCED OPPORTUNITY DETECTION
-- =====================================================

-- Detected opportunities with richer categorization
CREATE TABLE IF NOT EXISTS detected_opportunities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    account_name TEXT,
    opportunity_type TEXT CHECK(opportunity_type IN (
        'price_increase',        -- Vendor raised prices
        'bulk_discount',         -- Volume discount available
        'contract_renewal',      -- MLA expiring soon
        'vendor_consolidation',  -- Multiple vendors for same category
        'payment_terms',         -- Better terms available
        'seasonal_buying',       -- Buy ahead of seasonal price increase
        'new_product',           -- New product from existing vendor
        'competitive_pricing',   -- Found cheaper alternative
        'rebate_eligible',       -- Qualifies for vendor rebate
        'waste_reduction',       -- High waste detected
        'usage_optimization'     -- Can reduce usage
    )),
    source_type TEXT CHECK(source_type IN ('invoice', 'email', 'inventory', 'mla', 'manual')),
    source_id INTEGER,  -- ID of source record
    title TEXT NOT NULL,
    description TEXT,
    impact_type TEXT CHECK(impact_type IN ('cost_savings', 'revenue', 'efficiency', 'risk_mitigation')),
    estimated_value_cents INTEGER,
    confidence_score REAL CHECK(confidence_score BETWEEN 0 AND 100),
    urgency TEXT CHECK(urgency IN ('immediate', 'this_week', 'this_month', 'this_quarter')),
    status TEXT CHECK(status IN ('new', 'viewed', 'in_progress', 'won', 'lost', 'expired')) DEFAULT 'new',
    assigned_to INTEGER,
    vendor_name TEXT,
    sku TEXT,
    current_price_cents INTEGER,
    target_price_cents INTEGER,
    quantity_affected REAL,
    supporting_data TEXT,  -- JSON blob with details
    action_items TEXT,  -- JSON array of recommended actions
    notes TEXT,
    viewed_at DATETIME,
    actioned_at DATETIME,
    closed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (assigned_to) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_opportunities_user_status ON detected_opportunities(user_id, status);
CREATE INDEX IF NOT EXISTS idx_opportunities_type ON detected_opportunities(opportunity_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_urgency ON detected_opportunities(urgency, status);

-- =====================================================
-- COST SAVINGS TRACKING
-- =====================================================

CREATE TABLE IF NOT EXISTS cost_savings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    opportunity_id INTEGER,
    savings_type TEXT CHECK(savings_type IN (
        'negotiated_price',      -- Price reduction from negotiation
        'bulk_purchase',         -- Volume discount
        'vendor_switch',         -- Switched to cheaper vendor
        'contract_renegotiation', -- Better MLA terms
        'waste_reduction',       -- Reduced waste/spoilage
        'process_optimization',  -- Operational efficiency
        'early_payment',         -- Early payment discount
        'rebate',                -- Vendor rebate received
        'avoided_price_increase' -- Locked in price before increase
    )),
    description TEXT,
    vendor_name TEXT,
    sku TEXT,
    original_cost_cents INTEGER,
    new_cost_cents INTEGER,
    quantity REAL,
    savings_cents INTEGER NOT NULL,
    savings_period TEXT CHECK(savings_period IN ('one_time', 'monthly', 'quarterly', 'annual')),
    annualized_savings_cents INTEGER,
    realized_date DATE,
    is_verified INTEGER DEFAULT 0,
    verified_by INTEGER,
    verified_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (opportunity_id) REFERENCES detected_opportunities(id),
    FOREIGN KEY (verified_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_savings_user_date ON cost_savings(user_id, realized_date DESC);
CREATE INDEX IF NOT EXISTS idx_savings_type ON cost_savings(savings_type);

-- =====================================================
-- LEAD CONTACTS (Extracted from invoices/emails)
-- =====================================================

CREATE TABLE IF NOT EXISTS extracted_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    source_type TEXT CHECK(source_type IN ('invoice', 'email', 'mla', 'manual')),
    source_id INTEGER,
    company_name TEXT,
    contact_name TEXT,
    title TEXT,
    email TEXT,
    phone TEXT,
    mobile TEXT,
    fax TEXT,
    address_line1 TEXT,
    address_line2 TEXT,
    city TEXT,
    state TEXT,
    postal_code TEXT,
    country TEXT DEFAULT 'USA',
    website TEXT,
    linkedin_url TEXT,
    contact_type TEXT CHECK(contact_type IN ('sales_rep', 'account_manager', 'billing', 'support', 'executive', 'unknown')),
    department TEXT,
    is_primary INTEGER DEFAULT 0,
    is_verified INTEGER DEFAULT 0,
    last_contacted_at DATETIME,
    notes TEXT,
    tags TEXT,  -- JSON array of tags
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_contacts_user_company ON extracted_contacts(user_id, company_name);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON extracted_contacts(email);
CREATE INDEX IF NOT EXISTS idx_contacts_type ON extracted_contacts(contact_type);

-- =====================================================
-- PAYROLL & EXPENSE TRACKING
-- =====================================================

CREATE TABLE IF NOT EXISTS payroll_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    period_type TEXT CHECK(period_type IN ('weekly', 'biweekly', 'semimonthly', 'monthly')),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    gross_payroll_cents INTEGER NOT NULL,
    employer_taxes_cents INTEGER DEFAULT 0,
    benefits_cents INTEGER DEFAULT 0,
    total_labor_cost_cents INTEGER,  -- Calculated: gross + taxes + benefits
    employee_count INTEGER,
    hours_worked REAL,
    overtime_hours REAL DEFAULT 0,
    overtime_cost_cents INTEGER DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_user_period ON payroll_entries(user_id, period_start DESC);

CREATE TABLE IF NOT EXISTS expense_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    period_type TEXT CHECK(period_type IN ('weekly', 'biweekly', 'semimonthly', 'monthly')),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    category TEXT CHECK(category IN (
        'cogs',              -- Cost of goods sold
        'inventory',         -- Inventory purchases
        'utilities',         -- Electric, gas, water
        'rent',              -- Rent/lease
        'insurance',         -- Business insurance
        'marketing',         -- Advertising, promotions
        'equipment',         -- Equipment, maintenance
        'supplies',          -- Office/operational supplies
        'professional',      -- Legal, accounting, consulting
        'technology',        -- Software, IT
        'travel',            -- Travel, meals
        'other'              -- Miscellaneous
    )),
    subcategory TEXT,
    amount_cents INTEGER NOT NULL,
    vendor_name TEXT,
    description TEXT,
    is_recurring INTEGER DEFAULT 0,
    invoice_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (invoice_id) REFERENCES ingestion_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_expenses_user_period ON expense_entries(user_id, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expense_entries(category);

-- =====================================================
-- FINANCIAL ANALYTICS (Aggregated metrics)
-- =====================================================

CREATE TABLE IF NOT EXISTS financial_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    metric_date DATE NOT NULL,
    period_type TEXT CHECK(period_type IN ('daily', 'weekly', 'monthly', 'quarterly', 'annual')),

    -- Revenue metrics
    gross_revenue_cents INTEGER DEFAULT 0,
    net_revenue_cents INTEGER DEFAULT 0,

    -- Expense metrics
    total_expenses_cents INTEGER DEFAULT 0,
    cogs_cents INTEGER DEFAULT 0,
    labor_costs_cents INTEGER DEFAULT 0,
    overhead_cents INTEGER DEFAULT 0,

    -- Profitability
    gross_profit_cents INTEGER,
    net_profit_cents INTEGER,
    gross_margin_pct REAL,
    net_margin_pct REAL,

    -- Efficiency metrics
    labor_cost_pct REAL,  -- Labor as % of revenue
    cogs_pct REAL,        -- COGS as % of revenue
    prime_cost_pct REAL,  -- (Labor + COGS) as % of revenue

    -- Inventory metrics
    inventory_value_cents INTEGER,
    inventory_turnover REAL,
    days_inventory REAL,

    -- Comparison
    prev_period_revenue_cents INTEGER,
    revenue_change_pct REAL,
    prev_period_expenses_cents INTEGER,
    expenses_change_pct REAL,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, metric_date, period_type)
);

CREATE INDEX IF NOT EXISTS idx_metrics_user_date ON financial_metrics(user_id, metric_date DESC);

-- =====================================================
-- GAMIFICATION & ACHIEVEMENTS
-- =====================================================

CREATE TABLE IF NOT EXISTS user_achievements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    achievement_type TEXT NOT NULL,
    achievement_name TEXT NOT NULL,
    description TEXT,
    icon TEXT,  -- Emoji or icon class
    tier TEXT CHECK(tier IN ('bronze', 'silver', 'gold', 'platinum', 'diamond')),
    points INTEGER DEFAULT 0,
    progress_current REAL,
    progress_target REAL,
    is_unlocked INTEGER DEFAULT 0,
    unlocked_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, achievement_type)
);

CREATE TABLE IF NOT EXISTS savings_streaks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    streak_type TEXT CHECK(streak_type IN ('weekly_savings', 'expense_reduction', 'on_budget', 'inventory_optimal')),
    current_streak INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    last_activity_date DATE,
    total_periods INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, streak_type)
);

-- =====================================================
-- VENDOR PRICING HISTORY (for trend analysis)
-- =====================================================

CREATE TABLE IF NOT EXISTS vendor_price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    vendor_name TEXT NOT NULL,
    sku TEXT NOT NULL,
    product_name TEXT,
    unit_price_cents INTEGER NOT NULL,
    quantity REAL,
    unit_of_measure TEXT,
    invoice_date DATE NOT NULL,
    invoice_id INTEGER,
    price_change_cents INTEGER,  -- vs previous price
    price_change_pct REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (invoice_id) REFERENCES ingestion_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_price_history_vendor_sku ON vendor_price_history(vendor_name, sku, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_price_history_user ON vendor_price_history(user_id, invoice_date DESC);

-- =====================================================
-- VIEWS FOR ANALYTICS
-- =====================================================

-- Active opportunities summary
CREATE VIEW IF NOT EXISTS v_opportunity_summary AS
SELECT
    user_id,
    COUNT(*) as total_opportunities,
    COUNT(CASE WHEN status = 'new' THEN 1 END) as new_count,
    COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_count,
    COUNT(CASE WHEN status = 'won' THEN 1 END) as won_count,
    SUM(CASE WHEN status IN ('new', 'in_progress') THEN estimated_value_cents ELSE 0 END) as potential_value_cents,
    SUM(CASE WHEN status = 'won' THEN estimated_value_cents ELSE 0 END) as realized_value_cents
FROM detected_opportunities
GROUP BY user_id;

-- Cost savings summary by type
CREATE VIEW IF NOT EXISTS v_savings_by_type AS
SELECT
    user_id,
    savings_type,
    COUNT(*) as count,
    SUM(savings_cents) as total_savings_cents,
    AVG(savings_cents) as avg_savings_cents,
    SUM(annualized_savings_cents) as total_annualized_cents
FROM cost_savings
WHERE realized_date >= date('now', '-12 months')
GROUP BY user_id, savings_type;

-- Inventory health summary
CREATE VIEW IF NOT EXISTS v_inventory_health AS
SELECT
    i.user_id,
    COUNT(*) as total_items,
    COUNT(CASE WHEN i.current_quantity <= i.min_quantity THEN 1 END) as items_below_min,
    COUNT(CASE WHEN i.current_quantity <= i.min_quantity * 0.5 THEN 1 END) as items_critical,
    COUNT(CASE WHEN i.max_quantity IS NOT NULL AND i.current_quantity > i.max_quantity THEN 1 END) as items_overstocked,
    SUM(i.current_quantity * i.avg_unit_cost_cents / 100) as total_value_dollars,
    COUNT(CASE WHEN r.id IS NOT NULL AND r.is_dismissed = 0 THEN 1 END) as pending_recommendations
FROM inventory_items i
LEFT JOIN reorder_recommendations r ON i.id = r.inventory_item_id AND r.is_actioned = 0
WHERE i.is_active = 1
GROUP BY i.user_id;
