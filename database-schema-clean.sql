CREATE TABLE users (
CREATE TABLE teams (
CREATE TABLE ingestion_runs (
CREATE TABLE invoice_items (
CREATE TABLE mlas (
CREATE TABLE mla_reviews (
CREATE TABLE opportunities (
CREATE TABLE opportunity_activities (
CREATE TABLE spifs (
CREATE TABLE spif_standings (
CREATE TABLE commissions (
CREATE TABLE telemetry_events (
CREATE TABLE leads (
CREATE TABLE analytics_cache (
CREATE INDEX idx_mla_reviews_user_created ON mla_reviews(user_id, created_at);
CREATE INDEX idx_mla_reviews_mla ON mla_reviews(mla_id);
CREATE INDEX idx_opportunities_assigned ON opportunities(assigned_to, status);
CREATE INDEX idx_opportunities_detected ON opportunities(detected_at);
CREATE INDEX idx_spif_standings_spif ON spif_standings(spif_id, rank);
CREATE INDEX idx_telemetry_user_type ON telemetry_events(user_id, event_type, created_at);
CREATE INDEX idx_commissions_user_period ON commissions(user_id, period_start, period_end);
CREATE INDEX idx_analytics_cache_key ON analytics_cache(cache_key, expires_at);
CREATE INDEX idx_ingestion_runs_user ON ingestion_runs(user_id, created_at);
CREATE INDEX idx_leads_run ON leads(source_run_id);
CREATE VIEW active_spif_leaderboards AS
CREATE VIEW rep_performance AS
