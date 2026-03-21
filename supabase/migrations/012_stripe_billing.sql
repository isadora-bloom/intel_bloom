ALTER TABLE venues ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS plan_status TEXT DEFAULT 'trial';
ALTER TABLE venues ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '14 days';
CREATE INDEX IF NOT EXISTS idx_venues_stripe_customer ON venues(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
