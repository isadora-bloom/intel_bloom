-- ============================================================
-- EMAIL CONNECTIONS + EXTRACTIONS
-- Stores Gmail OAuth tokens per venue and the intelligence
-- extracted from scanned emails (source attribution, journey links)
-- ============================================================

CREATE TABLE email_connections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id          UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL DEFAULT 'google',
  email_address     TEXT NOT NULL,
  access_token      TEXT,
  refresh_token     TEXT,
  token_expires_at  TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  last_synced_at    TIMESTAMPTZ,
  UNIQUE(venue_id, email_address)
);

ALTER TABLE email_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "venue_members_email_connections" ON email_connections
  FOR ALL USING (
    venue_id IN (SELECT venue_id FROM venue_users WHERE user_id = auth.uid())
  );

-- Extracted intelligence from individual emails
CREATE TABLE email_extractions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id              UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  gmail_message_id      TEXT NOT NULL,
  thread_id             TEXT,
  received_at           TIMESTAMPTZ,
  from_email            TEXT,
  from_name             TEXT,
  subject               TEXT,

  -- What Claude extracted
  extracted_name        TEXT,
  extracted_event_date  DATE,
  extracted_source      TEXT,      -- the_knot, instagram, google, friend_referral, direct, etc.
  extracted_source_quote TEXT,     -- the actual sentence: "We found you on The Knot"
  extracted_guest_count INTEGER,
  extraction_summary    TEXT,

  -- Match results
  match_status          TEXT DEFAULT 'unmatched',  -- unmatched, auto_linked, pending_review, rejected
  matched_lead_id       UUID REFERENCES leads(id) ON DELETE SET NULL,
  matched_inquiry_id    UUID REFERENCES inquiries(id) ON DELETE SET NULL,
  matched_client_id     UUID REFERENCES clients(id) ON DELETE SET NULL,
  match_score           INTEGER,
  match_signals         TEXT[],

  created_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(venue_id, gmail_message_id)
);

ALTER TABLE email_extractions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "venue_members_email_extractions" ON email_extractions
  FOR ALL USING (
    venue_id IN (SELECT venue_id FROM venue_users WHERE user_id = auth.uid())
  );

CREATE INDEX idx_email_extractions_venue ON email_extractions(venue_id, match_status);
CREATE INDEX idx_email_extractions_name ON email_extractions(venue_id, extracted_name);
CREATE INDEX idx_email_extractions_source ON email_extractions(venue_id, extracted_source);
