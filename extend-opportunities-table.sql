-- Extend opportunities table with rules engine fields
BEGIN TRANSACTION;

ALTER TABLE opportunities ADD COLUMN rule_id INTEGER;
ALTER TABLE opportunities ADD COLUMN trigger_sku TEXT;
ALTER TABLE opportunities ADD COLUMN recommended_sku TEXT;
ALTER TABLE opportunities ADD COLUMN contract_price_cents INTEGER;
ALTER TABLE opportunities ADD COLUMN commission_rate_used REAL;
ALTER TABLE opportunities ADD COLUMN explainability_json TEXT;
ALTER TABLE opportunities ADD COLUMN confidence_score REAL;
ALTER TABLE opportunities ADD COLUMN talk_track TEXT;
ALTER TABLE opportunities ADD COLUMN created_by_user_id INTEGER;
ALTER TABLE opportunities ADD COLUMN dedupe_key TEXT;
ALTER TABLE opportunities ADD COLUMN supersedes_opportunity_id INTEGER;

COMMIT;
