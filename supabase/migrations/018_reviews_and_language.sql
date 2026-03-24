-- ============================================================
-- 018: REVIEWS, LANGUAGE MINING & REFERRAL TRACKING
--
-- Three things:
--   1. reviews              — collected from all platforms, matched to clients
--   2. review_language      — extracted phrases/themes from reviews, feeds Sage
--   3. referrals            — tracks when a past couple refers a new inquiry
--
-- Core principle: reviews are a discovery touchpoint AND a sales tool.
-- The language couples use in reviews is more persuasive than marketing copy.
-- Mine it, match it to clients, feed it back into Sage.
-- ============================================================


-- ============================================================
-- REVIEWS
-- Collected from Google, The Knot, WeddingWire, Zola, and any
-- other platform. Matched back to client records where possible.
-- ============================================================

CREATE TABLE reviews (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id            UUID        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),

  -- Source platform
  platform            TEXT        NOT NULL,
    -- 'google', 'the_knot', 'wedding_wire', 'zola', 'yelp',
    -- 'facebook', 'here_comes_the_guide', 'direct' (told you personally), 'other'
  platform_review_id  TEXT,       -- External ID from the platform, for deduplication
  platform_url        TEXT,       -- Direct link to the review

  -- Review content
  reviewer_name       TEXT,       -- As shown on the platform (may be first name only)
  rating              NUMERIC(2,1), -- 1.0–5.0
  review_text         TEXT,
  review_date         DATE,       -- When the review was posted (platform-reported)
  wedding_date_mentioned DATE,    -- If they mention their wedding date in the text

  -- Matching to client record
  matched_client_id   UUID        REFERENCES clients(id) ON DELETE SET NULL,
  match_confidence    INTEGER,    -- 0–100
  match_status        TEXT        DEFAULT 'unmatched',
    -- 'unmatched', 'matched', 'auto_matched', 'dismissed'
  match_reviewed_by   UUID        REFERENCES auth.users(id),
  match_reviewed_at   TIMESTAMPTZ,

  -- AI analysis (filled by extraction job)
  sentiment_score     NUMERIC(3,2), -- -1.0 to 1.0
  themes              TEXT[],       -- e.g. ['coordinator', 'views', 'flexibility', 'value']
  standout_phrases    TEXT[],       -- Verbatim phrases worth reusing
  concerns_mentioned  TEXT[],       -- Any negatives or caveats mentioned
  analysis_run_at     TIMESTAMPTZ,

  -- Import tracking
  import_source       TEXT        DEFAULT 'manual',
    -- 'manual', 'google_api', 'scrape', 'csv_import'

  UNIQUE (venue_id, platform, platform_review_id)
);

CREATE INDEX idx_reviews_venue_id       ON reviews(venue_id);
CREATE INDEX idx_reviews_platform       ON reviews(platform);
CREATE INDEX idx_reviews_rating         ON reviews(rating);
CREATE INDEX idx_reviews_review_date    ON reviews(review_date);
CREATE INDEX idx_reviews_match_status   ON reviews(match_status);
CREATE INDEX idx_reviews_matched_client ON reviews(matched_client_id);
-- Fast text search on review content
CREATE INDEX idx_reviews_text_search    ON reviews USING gin(to_tsvector('english', coalesce(review_text, '')));

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue members can manage reviews"
  ON reviews FOR ALL
  USING (venue_id IN (SELECT venue_id FROM venue_users WHERE user_id = auth.uid()));

CREATE TRIGGER update_reviews_updated_at
  BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- REVIEW LANGUAGE
-- Distilled phrases and themes extracted from all reviews.
-- These feed directly into Sage's response templates and
-- the venue's sales copy — real words from real couples.
--
-- Refreshed periodically by an extraction job that reads all
-- reviews and identifies language worth reusing.
-- ============================================================

CREATE TABLE review_language (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        UUID        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),

  -- The phrase itself — verbatim from reviews
  phrase          TEXT        NOT NULL,

  -- What aspect of the venue this phrase describes
  theme           TEXT        NOT NULL,
    -- 'coordinator'    — praise for the coordinator/team
    -- 'space'          — the physical venue, views, rooms
    -- 'flexibility'    — BYOB, own vendors, customisation
    -- 'value'          — price, what's included, no hidden fees
    -- 'experience'     — how the day felt, atmosphere
    -- 'process'        — planning process, communication, portal
    -- 'pets'           — pet-friendly mentions
    -- 'exclusivity'    — private use, not sharing with other events
    -- 'food_catering'  — catering freedom, kitchen
    -- 'accommodation'  — overnight stays, manor rooms
    -- 'ceremony'       — ceremony space, outdoor, indoor
    -- 'other'

  -- How many reviews contain this phrase or close variants
  frequency       INTEGER     DEFAULT 1,

  -- Average rating of reviews this phrase appears in
  avg_rating      NUMERIC(2,1),

  -- Should Sage actively use this language?
  approved_for_sage     BOOLEAN     DEFAULT false,
  -- Should this appear in marketing copy?
  approved_for_marketing BOOLEAN    DEFAULT false,

  -- Which reviews this was extracted from
  source_review_ids UUID[],

  UNIQUE (venue_id, phrase)
);

CREATE INDEX idx_review_language_venue_id ON review_language(venue_id);
CREATE INDEX idx_review_language_theme    ON review_language(theme);
CREATE INDEX idx_review_language_frequency ON review_language(frequency DESC);
CREATE INDEX idx_review_language_sage     ON review_language(venue_id, approved_for_sage)
  WHERE approved_for_sage = true;

ALTER TABLE review_language ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue members can manage review_language"
  ON review_language FOR ALL
  USING (venue_id IN (SELECT venue_id FROM venue_users WHERE user_id = auth.uid()));

CREATE TRIGGER update_review_language_updated_at
  BEFORE UPDATE ON review_language
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- AUGMENT CLIENTS TABLE
-- Add review and referral fields to existing client records.
-- ============================================================

ALTER TABLE clients
  -- Review tracking
  ADD COLUMN IF NOT EXISTS review_requested_at    TIMESTAMPTZ,  -- When Sage sent the review request
  ADD COLUMN IF NOT EXISTS review_request_count   INTEGER DEFAULT 0, -- How many times asked
  ADD COLUMN IF NOT EXISTS review_submitted       BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS review_submitted_at    TIMESTAMPTZ,
  -- NOTE: review_platform already exists from 001_initial_schema.sql — not re-added here

  -- Referral tracking
  -- NOTE: referrer_client_id already exists from 001_initial_schema.sql — using that field
  ADD COLUMN IF NOT EXISTS referral_count         INTEGER DEFAULT 0,
    -- How many future couples this couple has referred
  ADD COLUMN IF NOT EXISTS referral_noted_at      TIMESTAMPTZ;
    -- When the referral connection was recorded


-- ============================================================
-- REFERRALS
-- Explicit tracking of when a past couple refers a new inquiry.
-- Closes the attribution loop: Sarah's October 2024 wedding
-- generated a referral that became a June 2026 booking.
-- ============================================================

CREATE TABLE referrals (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id              UUID        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  created_at            TIMESTAMPTZ DEFAULT NOW(),

  -- The couple who referred
  referring_client_id   UUID        REFERENCES clients(id) ON DELETE SET NULL,
  referring_name        TEXT,       -- Free text if not matched to a client record

  -- The couple who was referred
  referred_client_id    UUID        REFERENCES clients(id) ON DELETE SET NULL,
  referred_inquiry_id   UUID        REFERENCES inquiries(id) ON DELETE SET NULL,

  -- How we know about this referral
  source                TEXT        DEFAULT 'self_reported',
    -- 'self_reported'  — new couple said so in their inquiry or calculator
    -- 'sage_extracted' — Sage identified it from message content
    -- 'manual'         — venue team noted it

  -- Did the referred couple book?
  converted             BOOLEAN,
  converted_at          TIMESTAMPTZ,

  notes                 TEXT
);

CREATE INDEX idx_referrals_venue_id           ON referrals(venue_id);
CREATE INDEX idx_referrals_referring_client   ON referrals(referring_client_id);
CREATE INDEX idx_referrals_referred_client    ON referrals(referred_client_id);

ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue members can manage referrals"
  ON referrals FOR ALL
  USING (venue_id IN (SELECT venue_id FROM venue_users WHERE user_id = auth.uid()));


-- ============================================================
-- POST-WEDDING SEQUENCE TRACKING
-- Tracks Sage's post-wedding outreach — review requests,
-- anniversary messages, photo requests.
-- ============================================================

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS post_wedding_day2_sent     TIMESTAMPTZ,  -- "We're still smiling" warmth email
  ADD COLUMN IF NOT EXISTS post_wedding_day14_sent    TIMESTAMPTZ,  -- First review request
  ADD COLUMN IF NOT EXISTS post_wedding_day30_sent    TIMESTAMPTZ,  -- Second review nudge (if no review)
  ADD COLUMN IF NOT EXISTS post_wedding_day90_sent    TIMESTAMPTZ,  -- Photo request
  ADD COLUMN IF NOT EXISTS post_wedding_anniversary_sent TIMESTAMPTZ; -- Year 1 anniversary message
