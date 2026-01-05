-- Add trial/freemium tracking fields to users table
-- Run this migration to enable trial limits for self-service signups

-- Trial status tracking
ALTER TABLE users ADD COLUMN is_trial INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN trial_started_at DATETIME;
ALTER TABLE users ADD COLUMN trial_expires_at DATETIME;
ALTER TABLE users ADD COLUMN trial_invoices_used INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN trial_invoices_limit INTEGER DEFAULT 20;
ALTER TABLE users ADD COLUMN trial_days_limit INTEGER DEFAULT 30;
ALTER TABLE users ADD COLUMN subscription_status TEXT DEFAULT 'trial' CHECK(subscription_status IN ('trial', 'active', 'expired', 'cancelled'));
ALTER TABLE users ADD COLUMN signup_source TEXT DEFAULT 'manual'; -- 'manual', 'self_service', 'invitation'

-- Create index for trial expiration queries
CREATE INDEX IF NOT EXISTS idx_users_trial_expires ON users(trial_expires_at) WHERE is_trial = 1;
CREATE INDEX IF NOT EXISTS idx_users_subscription_status ON users(subscription_status);
