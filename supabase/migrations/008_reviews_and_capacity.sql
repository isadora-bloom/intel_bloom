-- ============================================================
-- BLOOM SPINE — MIGRATION 008: REVIEWS + CAPACITY FIXES
-- ============================================================

-- Add missing columns to reviews table
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS platform_url TEXT,
  ADD COLUMN IF NOT EXISTS import_source TEXT,
  ADD COLUMN IF NOT EXISTS analysis_run_at TIMESTAMPTZ;

-- Add unique constraint for upsert deduplication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reviews_venue_platform_review_id_key'
  ) THEN
    ALTER TABLE reviews
      ADD CONSTRAINT reviews_venue_platform_review_id_key
      UNIQUE (venue_id, platform, platform_review_id);
  END IF;
END$$;

-- Add unique constraint to review_language for upsert
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'review_language_venue_phrase_key'
  ) THEN
    ALTER TABLE review_language
      ADD CONSTRAINT review_language_venue_phrase_key
      UNIQUE (venue_id, phrase);
  END IF;
END$$;

-- Add max_events_per_month to venues so capacity is configurable
ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS max_events_per_month INTEGER DEFAULT 4;
