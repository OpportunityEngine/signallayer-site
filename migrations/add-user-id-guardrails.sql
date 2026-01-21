-- Migration: Add user_id guardrails and backfill for ingestion_runs
-- Issue: user_id can be NULL on ingestion_runs, breaking visibility and ownership
-- Solution: Backfill NULL user_id values and add database-level constraints

-- =====================================================
-- STEP 1: BACKFILL NULL user_id VALUES
-- =====================================================

-- For email-based ingestion runs (run_id pattern: 'email-{monitorId}-{timestamp}')
-- Extract monitor_id from run_id and look up user_id from email_monitors
UPDATE ingestion_runs
SET user_id = (
    SELECT em.user_id
    FROM email_monitors em
    WHERE em.id = CAST(
        SUBSTR(
            ingestion_runs.run_id,
            7,  -- Start after 'email-'
            INSTR(SUBSTR(ingestion_runs.run_id, 7), '-') - 1  -- Length until next dash
        ) AS INTEGER
    )
    AND ingestion_runs.run_id LIKE 'email-%'
)
WHERE user_id IS NULL
  AND run_id LIKE 'email-%';

-- For upload-based ingestion runs (run_id pattern: 'upload-{uuid}')
-- Assign to user 1 (admin) as fallback - these need manual review
UPDATE ingestion_runs
SET user_id = 1
WHERE user_id IS NULL
  AND run_id LIKE 'upload-%';

-- For any remaining NULL values (shouldn't happen, but safety net)
-- Assign to user 1 (admin) for manual review
UPDATE ingestion_runs
SET user_id = 1
WHERE user_id IS NULL;

-- =====================================================
-- STEP 2: CREATE TRIGGER TO ENFORCE user_id NOT NULL
-- =====================================================

-- SQLite doesn't support adding NOT NULL constraint to existing column,
-- so we use a BEFORE INSERT trigger to enforce it at the database level

-- Drop trigger if it already exists (idempotent migration)
DROP TRIGGER IF EXISTS enforce_ingestion_runs_user_id;

-- Create trigger to reject NULL user_id on INSERT
CREATE TRIGGER enforce_ingestion_runs_user_id
BEFORE INSERT ON ingestion_runs
FOR EACH ROW
WHEN NEW.user_id IS NULL
BEGIN
    SELECT RAISE(ABORT, 'ingestion_runs.user_id cannot be NULL - every invoice must have an owner');
END;

-- Create trigger to reject NULL user_id on UPDATE
DROP TRIGGER IF EXISTS enforce_ingestion_runs_user_id_update;
CREATE TRIGGER enforce_ingestion_runs_user_id_update
BEFORE UPDATE ON ingestion_runs
FOR EACH ROW
WHEN NEW.user_id IS NULL
BEGIN
    SELECT RAISE(ABORT, 'ingestion_runs.user_id cannot be NULL - every invoice must have an owner');
END;

-- =====================================================
-- STEP 3: ADD INDEXES FOR PERFORMANCE
-- =====================================================

-- user_id is already indexed (idx_ingestion_runs_user), but ensure it exists
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_user ON ingestion_runs(user_id, created_at);

-- Index for run_id pattern matching (used in backfill and debugging)
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_run_id ON ingestion_runs(run_id);

-- =====================================================
-- STEP 4: VALIDATION QUERY
-- =====================================================

-- After migration, this should return 0 rows
-- SELECT COUNT(*) as remaining_nulls FROM ingestion_runs WHERE user_id IS NULL;

-- =====================================================
-- STEP 5: EMAIL_MONITORS GUARDRAIL (BONUS)
-- =====================================================

-- Also ensure email_monitors always has user_id set
-- Backfill email_monitors.user_id from created_by_user_id if missing
UPDATE email_monitors
SET user_id = created_by_user_id
WHERE user_id IS NULL
  AND created_by_user_id IS NOT NULL;

-- Assign orphaned monitors to user 1 (admin)
UPDATE email_monitors
SET user_id = 1
WHERE user_id IS NULL;

-- Add trigger to enforce email_monitors.user_id NOT NULL
DROP TRIGGER IF EXISTS enforce_email_monitors_user_id;
CREATE TRIGGER enforce_email_monitors_user_id
BEFORE INSERT ON email_monitors
FOR EACH ROW
WHEN NEW.user_id IS NULL
BEGIN
    SELECT RAISE(ABORT, 'email_monitors.user_id cannot be NULL - every monitor must have an owner');
END;

DROP TRIGGER IF EXISTS enforce_email_monitors_user_id_update;
CREATE TRIGGER enforce_email_monitors_user_id_update
BEFORE UPDATE ON email_monitors
FOR EACH ROW
WHEN NEW.user_id IS NULL
BEGIN
    SELECT RAISE(ABORT, 'email_monitors.user_id cannot be NULL - every monitor must have an owner');
END;

-- =====================================================
-- MIGRATION COMPLETE
-- =====================================================
-- Summary:
-- 1. Backfilled NULL user_id values in ingestion_runs (email-based from monitors, upload-based to admin)
-- 2. Created triggers to enforce user_id NOT NULL at database level
-- 3. Added indexes for performance
-- 4. Bonus: Applied same guardrails to email_monitors table
--
-- Verification:
-- SELECT COUNT(*) FROM ingestion_runs WHERE user_id IS NULL;  -- Should be 0
-- SELECT COUNT(*) FROM email_monitors WHERE user_id IS NULL;  -- Should be 0
--
-- Test the trigger:
-- INSERT INTO ingestion_runs (run_id, user_id) VALUES ('test', NULL);  -- Should fail
-- =====================================================
