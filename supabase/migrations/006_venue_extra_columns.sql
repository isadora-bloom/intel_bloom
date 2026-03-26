-- ============================================================
-- BLOOM SPINE — MIGRATION 006: VENUE EXTRA COLUMNS
-- Adds missing columns referenced in code but not in 001_schema:
--   calendly_api_key, trends_custom_terms, competitor_radius_miles
-- ============================================================

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS calendly_api_key TEXT,
  ADD COLUMN IF NOT EXISTS trends_custom_terms TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS competitor_radius_miles INTEGER DEFAULT 30;
