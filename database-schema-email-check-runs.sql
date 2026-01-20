-- =====================================================
-- EMAIL CHECK RUNS SCHEMA
-- Single source of truth for each email check operation
-- =====================================================

-- Track each email check run with full diagnostic info
CREATE TABLE IF NOT EXISTS email_check_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    monitor_id INTEGER NOT NULL,
    run_uuid TEXT UNIQUE NOT NULL,
    triggered_by TEXT NOT NULL DEFAULT 'manual', -- 'manual', 'scheduled', 'diagnose'
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME,
    status TEXT NOT NULL DEFAULT 'started', -- 'started', 'success', 'partial', 'error'

    -- IMAP connection info
    folder_opened TEXT,
    uidvalidity INTEGER,
    search_query TEXT,

    -- Counts at each stage
    found_messages INTEGER DEFAULT 0,
    fetched_messages INTEGER DEFAULT 0,
    attachments_total INTEGER DEFAULT 0,
    attachments_supported INTEGER DEFAULT 0,
    emails_skipped INTEGER DEFAULT 0,
    emails_processed INTEGER DEFAULT 0,
    invoices_created INTEGER DEFAULT 0,
    errors_count INTEGER DEFAULT 0,

    -- Error tracking
    error_message TEXT,
    last_stage TEXT, -- 'connect', 'auth', 'open_folder', 'search', 'fetch', 'process', 'complete'

    -- Timing info (milliseconds)
    connect_time_ms INTEGER,
    search_time_ms INTEGER,
    fetch_time_ms INTEGER,
    process_time_ms INTEGER,
    total_time_ms INTEGER,

    -- Debug info (JSON, no sensitive data)
    debug_json TEXT,

    FOREIGN KEY (monitor_id) REFERENCES email_monitors(id) ON DELETE CASCADE
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_email_check_runs_monitor ON email_check_runs(monitor_id);
CREATE INDEX IF NOT EXISTS idx_email_check_runs_uuid ON email_check_runs(run_uuid);
CREATE INDEX IF NOT EXISTS idx_email_check_runs_started ON email_check_runs(started_at DESC);

-- Monitor locks for concurrency control
CREATE TABLE IF NOT EXISTS email_monitor_locks (
    monitor_id INTEGER PRIMARY KEY,
    locked_at DATETIME NOT NULL,
    lock_owner TEXT NOT NULL, -- process identifier or run_uuid
    lock_expires_at DATETIME NOT NULL,
    FOREIGN KEY (monitor_id) REFERENCES email_monitors(id) ON DELETE CASCADE
);

-- Enhanced email processing log with skip reasons
-- Note: This adds columns to existing table via migration in database.js
