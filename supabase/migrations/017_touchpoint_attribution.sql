-- ============================================================
-- 017: TOUCHPOINT ATTRIBUTION
--
-- Adds three things:
--   1. pre_inquiry_signals  — partial-name signals from directories
--                             (The Knot profile views/saves before inquiry)
--   2. channel_spend        — monthly ad spend per platform
--   3. Inquiry augmentation — intent, first-contact channel,
--                             touchpoint classification, prior signal link
--
-- Core principle: the inquiry channel ≠ the first touchpoint.
-- A couple may have viewed a Knot profile 6 weeks before inquiring
-- via the venue website. We need to capture both, link them, and
-- calculate real cost-per-outcome at every funnel stage.
-- ============================================================


-- ============================================================
-- PRE-INQUIRY SIGNALS
-- Signals from directory platforms before a couple has formally
-- inquired. The Knot only provides first_name + last_initial at
-- this stage — no email, no full name.
--
-- When an inquiry arrives, the matching engine searches this table
-- for candidates and scores them. High-confidence matches are
-- auto-linked; lower confidence surfaces for human review.
-- ============================================================

CREATE TABLE pre_inquiry_signals (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id          UUID        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),

  -- Platform this signal came from
  platform          TEXT        NOT NULL,  -- 'the_knot', 'wedding_wire', 'zola', etc.

  -- Partial identity (all the platform gives us pre-inquiry)
  first_name        TEXT        NOT NULL,
  last_initial      CHAR(1)     NOT NULL,

  -- Signal type
  signal_type       TEXT        NOT NULL,  -- 'profile_view', 'profile_save', 'impression'

  -- When it happened (platform-reported, not import time)
  occurred_at       TIMESTAMPTZ NOT NULL,

  -- Raw data from platform export (preserve everything for future parsing)
  raw_data          JSONB,

  -- How this record entered the system
  import_source     TEXT        DEFAULT 'manual_import',  -- 'manual_import', 'api', 'csv_upload'

  -- Matching results (filled when inquiry is processed)
  matched_inquiry_id    UUID    REFERENCES inquiries(id) ON DELETE SET NULL,
  match_confidence      INTEGER,           -- 0–100
  match_status          TEXT    DEFAULT 'unmatched',
                                           -- 'unmatched', 'matched', 'dismissed', 'pending_review'
  match_reviewed_by     UUID    REFERENCES auth.users(id),
  match_reviewed_at     TIMESTAMPTZ,

  -- Prevent duplicate imports
  UNIQUE (venue_id, platform, first_name, last_initial, signal_type, occurred_at)
);

CREATE INDEX idx_pre_inquiry_signals_venue_id   ON pre_inquiry_signals(venue_id);
CREATE INDEX idx_pre_inquiry_signals_platform   ON pre_inquiry_signals(platform);
CREATE INDEX idx_pre_inquiry_signals_match_status ON pre_inquiry_signals(match_status);
CREATE INDEX idx_pre_inquiry_signals_occurred_at ON pre_inquiry_signals(occurred_at);
-- Fast name lookup for matching engine
CREATE INDEX idx_pre_inquiry_signals_name ON pre_inquiry_signals(venue_id, first_name, last_initial);

ALTER TABLE pre_inquiry_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue members can manage pre_inquiry_signals"
  ON pre_inquiry_signals FOR ALL
  USING (
    venue_id IN (
      SELECT venue_id FROM venue_users WHERE user_id = auth.uid()
    )
  );


-- ============================================================
-- CHANNEL SPEND
-- Monthly advertising spend per channel per venue.
-- Used to calculate cost-per-inquiry, cost-per-tour,
-- cost-per-booking, and cost-per-revenue-dollar by source.
--
-- Most directory fees are flat annual/monthly subscriptions —
-- not pay-per-click. Spend is allocated across the month's
-- outcomes to derive real cost-per-result.
-- ============================================================

CREATE TABLE channel_spend (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id      UUID        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),

  -- Which channel this spend is for (matches TOUCHPOINTS values in lib/touchpoints.ts)
  channel       TEXT        NOT NULL,

  -- Month this spend applies to (always first day of month, e.g. 2026-03-01)
  month         DATE        NOT NULL,

  -- Amount in cents (e.g. $300/month = 30000)
  amount_cents  INTEGER     NOT NULL CHECK (amount_cents >= 0),

  -- Optional: what this covers (e.g. "Annual listing fee — $3,600 / 12")
  notes         TEXT,

  -- Optional: billing type for context
  billing_type  TEXT,  -- 'monthly_subscription', 'annual_subscription', 'pay_per_click', 'flat_fee', 'other'

  UNIQUE (venue_id, channel, month)
);

CREATE INDEX idx_channel_spend_venue_id ON channel_spend(venue_id);
CREATE INDEX idx_channel_spend_channel  ON channel_spend(channel);
CREATE INDEX idx_channel_spend_month    ON channel_spend(month);

ALTER TABLE channel_spend ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue members can manage channel_spend"
  ON channel_spend FOR ALL
  USING (
    venue_id IN (
      SELECT venue_id FROM venue_users WHERE user_id = auth.uid()
    )
  );

CREATE TRIGGER update_channel_spend_updated_at
  BEFORE UPDATE ON channel_spend
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- AUGMENT INQUIRIES TABLE
-- Add intent, first-contact channel, touchpoint classification,
-- and prior signal link to existing inquiries records.
-- ============================================================

ALTER TABLE inquiries
  -- How intentional was this inquiry?
  -- 'chosen'         = couple deliberately contacted this venue
  -- 'also_contacted' = The Knot / platform blast after competitor inquiry
  -- 'unknown'        = cannot determine
  ADD COLUMN inquiry_intent              TEXT    DEFAULT 'unknown',

  -- The specific channel through which they made first contact
  -- (matches FIRST_CONTACT_CHANNELS values in lib/touchpoints.ts)
  -- e.g. 'the_knot_inquiry', 'the_knot_also_contacted', 'website_quiz', 'direct_email'
  ADD COLUMN first_contact_channel       TEXT,

  -- Is this inquiry the first known touchpoint, or did something come before?
  -- 'inquiry_is_first_touch'        = no prior signal found anywhere
  -- 'inquiry_preceded_by_awareness' = prior signal found (view/save/visit)
  -- 'returning_inquiry'             = this couple has inquired before
  -- 'unknown'                       = insufficient data
  ADD COLUMN touchpoint_classification   TEXT    DEFAULT 'unknown',

  -- Link to the earliest pre-inquiry signal found for this couple, if any
  -- Filled by the matching engine; confirmed or dismissed by venue team
  ADD COLUMN prior_signal_id             UUID    REFERENCES pre_inquiry_signals(id) ON DELETE SET NULL,
  ADD COLUMN prior_signal_confidence     INTEGER,  -- 0–100
  ADD COLUMN prior_signal_status         TEXT    DEFAULT 'not_searched',
                                                  -- 'not_searched', 'searched_no_match',
                                                  -- 'pending_review', 'confirmed', 'dismissed'

  -- Days between the earliest known signal and this inquiry (null if first touch)
  ADD COLUMN days_from_signal_to_inquiry INTEGER;

CREATE INDEX idx_inquiries_inquiry_intent           ON inquiries(inquiry_intent);
CREATE INDEX idx_inquiries_touchpoint_classification ON inquiries(touchpoint_classification);
CREATE INDEX idx_inquiries_first_contact_channel    ON inquiries(first_contact_channel);
CREATE INDEX idx_inquiries_prior_signal_id          ON inquiries(prior_signal_id);


-- ============================================================
-- AUGMENT client_source_touchpoints
-- Add intent and prior-signal awareness to the existing
-- per-client touchpoint records.
-- ============================================================

ALTER TABLE client_source_touchpoints
  ADD COLUMN touchpoint_type    TEXT,   -- 'discovery', 'profile_view', 'profile_save',
                                        -- 'website_visit', 'content_engage', 'inquiry',
                                        -- 'tour_booked', 'follow_up', 'referral_given'
  ADD COLUMN confidence         TEXT    DEFAULT 'confirmed',  -- 'confirmed', 'inferred', 'possible'
  ADD COLUMN signal_source      TEXT    DEFAULT 'manual';     -- 'directory_data', 'gmail_thread',
                                                              -- 'website_analytics', 'crm_import', 'manual'
