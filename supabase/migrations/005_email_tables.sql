-- ============================================================
-- BLOOM SPINE — MIGRATION 005: EMAIL CONNECTIONS & EXTRACTIONS
-- email_connections: OAuth tokens for Gmail integration
-- email_extractions: AI-extracted attribution signals from emails
-- ============================================================

-- ============================================================
-- EMAIL CONNECTIONS (Gmail OAuth tokens per venue)
-- ============================================================
CREATE TABLE email_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'google',  -- google (Gmail)
  email_address TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(venue_id, provider)
);

-- ============================================================
-- EMAIL EXTRACTIONS
-- AI-extracted attribution signals from Gmail scan
-- Linked to leads, inquiries, and clients via matching engine
-- ============================================================
CREATE TABLE email_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Gmail metadata
  gmail_message_id TEXT NOT NULL,
  thread_id TEXT,
  received_at TIMESTAMPTZ,
  from_email TEXT,
  from_name TEXT,
  subject TEXT,

  -- Extracted signals
  extracted_name TEXT,
  extracted_event_date DATE,
  extracted_source TEXT,          -- the_knot | instagram | google | friend_referral | direct | other
  extracted_source_quote TEXT,    -- verbatim sentence mentioning how they found the venue
  extracted_guest_count INTEGER,
  extraction_summary TEXT,

  -- Matching
  match_status TEXT DEFAULT 'unmatched',  -- unmatched | pending_review | auto_linked | rejected
  matched_lead_id UUID REFERENCES leads(id),
  matched_inquiry_id UUID REFERENCES inquiries(id),
  matched_client_id UUID REFERENCES clients(id),
  match_score INTEGER,
  match_signals JSONB,

  UNIQUE(venue_id, gmail_message_id)
);

-- RLS
ALTER TABLE email_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_extractions ENABLE ROW LEVEL SECURITY;

CREATE POLICY email_connections_venue_read ON email_connections
  FOR SELECT USING (venue_id = public.get_venue_id_for_user());

CREATE POLICY email_connections_venue_write ON email_connections
  FOR ALL USING (venue_id = public.get_venue_id_for_user());

CREATE POLICY email_connections_service ON email_connections
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY email_extractions_venue_read ON email_extractions
  FOR SELECT USING (venue_id = public.get_venue_id_for_user());

CREATE POLICY email_extractions_venue_write ON email_extractions
  FOR INSERT WITH CHECK (venue_id = public.get_venue_id_for_user());

CREATE POLICY email_extractions_venue_update ON email_extractions
  FOR UPDATE USING (venue_id = public.get_venue_id_for_user());

CREATE POLICY email_extractions_service ON email_extractions
  FOR ALL USING (auth.role() = 'service_role');

-- Indexes
CREATE INDEX idx_email_connections_venue ON email_connections(venue_id);
CREATE INDEX idx_email_extractions_venue ON email_extractions(venue_id, match_status);
CREATE INDEX idx_email_extractions_message ON email_extractions(venue_id, gmail_message_id);
