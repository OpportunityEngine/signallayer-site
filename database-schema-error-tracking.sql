-- =====================================================
-- ERROR TRACKING & MONITORING SYSTEM
-- =====================================================
-- Captures all system errors with plain English explanations
-- Auto-categorizes and assigns severity ratings
-- =====================================================

CREATE TABLE IF NOT EXISTS error_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    -- Error identification
    error_code TEXT,                      -- HTTP status or custom error code
    error_type TEXT NOT NULL,             -- database, api, email, validation, system, etc.
    technical_message TEXT NOT NULL,      -- Original error message
    plain_english TEXT NOT NULL,          -- 8th grade reading level explanation

    -- Severity & urgency
    severity TEXT NOT NULL CHECK(severity IN ('critical', 'high', 'medium', 'low')),
    severity_reason TEXT NOT NULL,        -- Why this severity was assigned
    is_user_facing BOOLEAN DEFAULT FALSE, -- Did a user see this error?

    -- Context
    endpoint TEXT,                        -- Which API endpoint failed
    user_id INTEGER,                      -- Which user encountered it (if applicable)
    account_name TEXT,                    -- Which customer account
    request_data TEXT,                    -- Request that caused error (sanitized)

    -- Technical details
    stack_trace TEXT,                     -- Full error stack for debugging
    error_count INTEGER DEFAULT 1,        -- How many times this exact error occurred
    last_occurrence DATETIME DEFAULT CURRENT_TIMESTAMP,

    -- Resolution
    status TEXT DEFAULT 'new' CHECK(status IN ('new', 'investigating', 'resolved', 'ignored')),
    resolved_at DATETIME,
    resolved_by TEXT,
    resolution_notes TEXT,

    -- Metadata
    server_version TEXT,
    node_version TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Error categories for grouping similar errors
CREATE TABLE IF NOT EXISTS error_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_name TEXT UNIQUE NOT NULL,
    description TEXT,
    default_severity TEXT,
    auto_assign_pattern TEXT,             -- Regex pattern to auto-categorize
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- System health snapshots (taken when errors occur)
CREATE TABLE IF NOT EXISTS error_context_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    error_log_id INTEGER NOT NULL,

    -- System state at time of error
    memory_usage_mb INTEGER,
    cpu_usage_percent REAL,
    active_connections INTEGER,
    database_size_mb REAL,

    -- Request context
    user_agent TEXT,
    ip_address TEXT,
    request_method TEXT,
    request_url TEXT,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (error_log_id) REFERENCES error_logs(id) ON DELETE CASCADE
);

-- Error rate tracking (for detecting sudden spikes)
CREATE TABLE IF NOT EXISTS error_rate_tracking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    error_type TEXT NOT NULL,
    time_window TEXT NOT NULL,            -- '5min', '1hour', '24hour'
    error_count INTEGER NOT NULL,
    threshold_exceeded BOOLEAN DEFAULT FALSE,
    alerted BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_error_severity ON error_logs(severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_status ON error_logs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_type ON error_logs(error_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_user ON error_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_account ON error_logs(account_name, created_at DESC);

-- Seed default error categories
INSERT OR IGNORE INTO error_categories (category_name, description, default_severity, auto_assign_pattern) VALUES
('Database Connection', 'Problems connecting to or querying the database', 'critical', 'SQLITE|database|connection|query'),
('Email Service', 'Issues with email monitoring or sending', 'high', 'IMAP|SMTP|email|mailparser'),
('API Request', 'Errors in API endpoints or requests', 'medium', 'fetch|axios|API|endpoint'),
('File Processing', 'Problems reading or processing uploaded files', 'medium', 'PDF|Excel|XLSX|file|parse'),
('Authentication', 'Login or permission issues', 'high', 'auth|login|permission|token'),
('Memory/Performance', 'Server resource issues', 'high', 'memory|heap|CPU|timeout'),
('Data Validation', 'Invalid data from users or external sources', 'low', 'validation|invalid|missing|required'),
('External Service', 'Third-party service failures (Claude AI, etc.)', 'medium', 'Claude|OpenAI|external|timeout');
