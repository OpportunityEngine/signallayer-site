-- =====================================================
-- EMAIL INVOICE AUTOPILOT SYSTEM - DATABASE SCHEMA
-- =====================================================
-- Feature #71: Automated email invoice monitoring
-- Works for: Enterprise sales, mom & pop shops, accountants, any email invoicing
-- =====================================================

-- Email monitoring accounts (can monitor multiple email addresses per customer)
CREATE TABLE IF NOT EXISTS email_monitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    -- Account identification
    account_name TEXT NOT NULL,           -- Customer name (can have multiple monitors)
    monitor_name TEXT,                    -- Friendly name (e.g., "Site 1 Invoices", "Corporate Billing")

    -- Email credentials
    email_address TEXT NOT NULL,          -- Email to monitor (e.g., apinvoices@company.com)
    imap_host TEXT NOT NULL,              -- IMAP server (e.g., imap.gmail.com)
    imap_port INTEGER DEFAULT 993,        -- IMAP port (993 for SSL)
    username TEXT NOT NULL,               -- Email username
    encrypted_password TEXT NOT NULL,     -- AES-256 encrypted password

    -- Configuration
    is_active BOOLEAN DEFAULT TRUE,       -- Enable/disable monitoring
    check_interval_minutes INTEGER DEFAULT 5,  -- How often to check (5-60 min)
    folders_to_monitor TEXT DEFAULT 'INBOX',   -- Comma-separated folders
    sender_whitelist TEXT,                -- Only process from these emails (optional)
    subject_patterns TEXT,                -- Only process subjects matching pattern (optional)

    -- Industry-specific settings
    industry TEXT,                        -- healthcare, restaurant, retail, manufacturing, etc.
    customer_type TEXT DEFAULT 'business', -- business, accountant_multi_client, enterprise
    enable_cost_savings_detection BOOLEAN DEFAULT TRUE,
    enable_duplicate_detection BOOLEAN DEFAULT TRUE,
    enable_price_increase_alerts BOOLEAN DEFAULT TRUE,
    enable_contract_validation BOOLEAN DEFAULT FALSE,  -- Only for enterprise with MLAs

    -- Statistics
    last_check_at DATETIME,
    last_successful_check DATETIME,
    total_emails_processed INTEGER DEFAULT 0,
    total_invoices_found INTEGER DEFAULT 0,
    total_opportunities_detected INTEGER DEFAULT 0,
    total_savings_detected_cents INTEGER DEFAULT 0,  -- Cumulative savings found

    -- Alert settings
    alert_email TEXT,                     -- Where to send alerts (optional)
    alert_on_critical BOOLEAN DEFAULT TRUE,  -- Email on critical findings
    daily_summary_enabled BOOLEAN DEFAULT FALSE,

    -- Metadata
    created_by_user_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (created_by_user_id) REFERENCES users(id),
    UNIQUE(email_address)
);

-- Queue of emails being processed
CREATE TABLE IF NOT EXISTS email_invoice_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    monitor_id INTEGER NOT NULL,

    -- Email metadata
    email_uid TEXT NOT NULL,              -- Unique ID from IMAP server
    sender_email TEXT,
    sender_name TEXT,
    subject TEXT,
    received_at DATETIME,
    email_body_preview TEXT,              -- First 500 chars for debugging

    -- Attachment info
    attachment_count INTEGER DEFAULT 0,
    attachment_filenames TEXT,            -- JSON array of filenames

    -- Processing status
    status TEXT DEFAULT 'pending',        -- pending, processing, completed, failed, skipped
    skipped_reason TEXT,                  -- Why it was skipped (no attachments, not invoice, etc.)

    -- Results
    ingestion_run_id INTEGER,             -- Links to ingestion_runs table
    opportunities_detected INTEGER DEFAULT 0,
    savings_detected_cents INTEGER DEFAULT 0,

    -- Error handling
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,

    -- Timestamps
    queued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME,

    FOREIGN KEY (monitor_id) REFERENCES email_monitors(id) ON DELETE CASCADE,
    FOREIGN KEY (ingestion_run_id) REFERENCES ingestion_runs(id),
    UNIQUE(monitor_id, email_uid)
);

-- Detected cost savings (for mom & pop / accountant reports)
CREATE TABLE IF NOT EXISTS detected_savings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    -- Source
    monitor_id INTEGER NOT NULL,
    ingestion_run_id INTEGER NOT NULL,
    invoice_date DATE,
    vendor_name TEXT,

    -- Savings details
    savings_type TEXT NOT NULL,           -- duplicate_charge, price_increase, contract_violation, missing_discount, overcharge, irregular_quantity
    description TEXT NOT NULL,            -- Human-readable explanation

    -- Financial impact
    amount_charged_cents INTEGER,         -- What they were charged
    correct_amount_cents INTEGER,         -- What it should have been
    savings_amount_cents INTEGER NOT NULL, -- Difference (or potential savings)

    -- Supporting data
    sku TEXT,
    quantity DECIMAL,
    unit_price_cents INTEGER,
    expected_price_cents INTEGER,
    evidence_json TEXT,                   -- JSON with details for accountant review

    -- Status
    status TEXT DEFAULT 'detected',       -- detected, disputed, recovered, dismissed
    reviewed_by_user_id INTEGER,
    reviewed_at DATETIME,
    recovery_notes TEXT,                  -- What action was taken

    -- Alert
    severity TEXT DEFAULT 'medium',       -- critical, high, medium, low
    alerted BOOLEAN DEFAULT FALSE,

    -- Timestamps
    detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (monitor_id) REFERENCES email_monitors(id),
    FOREIGN KEY (ingestion_run_id) REFERENCES ingestion_runs(id),
    FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id)
);

-- Vendor tracking (auto-learns vendors from invoices)
CREATE TABLE IF NOT EXISTS auto_detected_vendors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    monitor_id INTEGER NOT NULL,
    vendor_name TEXT NOT NULL,            -- Extracted from invoices
    vendor_email TEXT,                    -- Sender email

    -- Statistics
    first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    invoice_count INTEGER DEFAULT 1,
    total_spend_cents INTEGER DEFAULT 0,
    avg_invoice_amount_cents INTEGER DEFAULT 0,

    -- Price tracking (for detecting increases)
    typical_skus_json TEXT,               -- JSON map of {sku: {avgPrice, lastPrice, count}}

    -- Flags
    is_trusted BOOLEAN DEFAULT FALSE,     -- Mark as trusted to reduce false positives
    has_contract BOOLEAN DEFAULT FALSE,   -- Has MLA/contract

    FOREIGN KEY (monitor_id) REFERENCES email_monitors(id) ON DELETE CASCADE,
    UNIQUE(monitor_id, vendor_name)
);

-- Cost savings reports (for accountants managing multiple clients)
CREATE TABLE IF NOT EXISTS savings_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    -- Report metadata
    report_type TEXT DEFAULT 'monthly',   -- daily, weekly, monthly, quarterly, annual
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,

    -- Scope
    monitor_id INTEGER,                   -- Single monitor (or NULL for all)
    account_name TEXT,                    -- Single account (or NULL for all)
    generated_for_user_id INTEGER,        -- Who requested it

    -- Aggregated data
    total_invoices_processed INTEGER,
    total_savings_detected_cents INTEGER,
    critical_findings INTEGER,
    high_priority_findings INTEGER,
    savings_by_category_json TEXT,       -- JSON: {duplicate_charge: 5000, price_increase: 3000, ...}
    top_vendors_json TEXT,               -- JSON: [{vendor, savings}, ...]

    -- Report output
    report_data_json TEXT,               -- Full report data
    pdf_path TEXT,                       -- Generated PDF location (optional)

    -- Status
    status TEXT DEFAULT 'draft',         -- draft, published, emailed
    emailed_to TEXT,                     -- Comma-separated emails
    emailed_at DATETIME,

    -- Timestamps
    generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (monitor_id) REFERENCES email_monitors(id),
    FOREIGN KEY (generated_for_user_id) REFERENCES users(id)
);

-- Activity log (real-time feed for VP dashboard)
CREATE TABLE IF NOT EXISTS email_monitor_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    monitor_id INTEGER NOT NULL,
    activity_type TEXT NOT NULL,          -- email_received, invoice_processed, savings_detected, error, alert_sent
    message TEXT NOT NULL,                -- Human-readable message
    severity TEXT DEFAULT 'info',         -- info, warning, error, critical

    metadata_json TEXT,                   -- Additional data

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (monitor_id) REFERENCES email_monitors(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_email_queue_status ON email_invoice_queue(status, queued_at);
CREATE INDEX IF NOT EXISTS idx_email_queue_monitor ON email_invoice_queue(monitor_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_detected_savings_monitor ON detected_savings(monitor_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_detected_savings_status ON detected_savings(status, severity);
CREATE INDEX IF NOT EXISTS idx_vendors_monitor ON auto_detected_vendors(monitor_id, invoice_count DESC);
CREATE INDEX IF NOT EXISTS idx_activity_monitor ON email_monitor_activity(monitor_id, created_at DESC);

-- Initial demo data for testing
INSERT OR IGNORE INTO email_monitors (
    account_name, monitor_name, email_address, imap_host, imap_port,
    username, encrypted_password, industry, customer_type, created_by_user_id
) VALUES (
    'Demo Restaurant', 'Main Invoices', 'invoices@demorestaurant.com',
    'imap.gmail.com', 993, 'invoices@demorestaurant.com',
    'ENCRYPTED_DEMO_PASSWORD', 'restaurant', 'business', 1
);
