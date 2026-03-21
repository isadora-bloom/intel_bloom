-- ============================================================
-- VENUE ONBOARDING WIZARD
-- Adds funnel configuration, venue intelligence profile, and
-- step-level progress tracking.
-- ============================================================

-- Step progress (allows resuming mid-wizard)
ALTER TABLE venues ADD COLUMN IF NOT EXISTS onboarding_step INTEGER DEFAULT 0;

-- How the venue's funnel actually works (captured in wizard)
-- { awareness_channels[], first_touch_methods[], tour_method,
--   contract_method, website_platform, analytics_platform,
--   advertising_platforms[] }
ALTER TABLE venues ADD COLUMN IF NOT EXISTS funnel_config JSONB DEFAULT '{}'::jsonb;

-- Intelligence metadata store — every field is:
-- { value, source, confidence, updatedAt, note }
-- source: user_estimate | user_input | api_sync | csv_import | email_scan | calculated
-- confidence: estimated | approximate | confirmed
-- Fields: avg_package_value_bucket, monthly_ad_spend_bucket,
--   typical_tours_per_booking_bucket, advertising_platforms,
--   website_url, instagram_handle, brand_keywords,
--   google_analytics_id, market_city, market_state
ALTER TABLE venues ADD COLUMN IF NOT EXISTS venue_profile JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_venues_funnel_config ON venues USING GIN (funnel_config);
CREATE INDEX IF NOT EXISTS idx_venues_venue_profile  ON venues USING GIN (venue_profile);
