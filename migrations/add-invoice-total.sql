-- Migration: Add invoice_total_cents column to ingestion_runs
-- This stores the parser-extracted total (from TOTAL/TOTAL USD line)
-- rather than relying on summing invoice_items (which may be incomplete or have duplicates)

-- Add the column
ALTER TABLE ingestion_runs ADD COLUMN invoice_total_cents INTEGER DEFAULT 0;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_total ON ingestion_runs(invoice_total_cents);

-- Update existing rows to calculate total from invoice_items (best effort migration)
-- This uses the sum of items as a fallback for historical data
UPDATE ingestion_runs
SET invoice_total_cents = (
    SELECT COALESCE(SUM(total_cents), 0)
    FROM invoice_items
    WHERE invoice_items.run_id = ingestion_runs.id
)
WHERE invoice_total_cents IS NULL OR invoice_total_cents = 0;
