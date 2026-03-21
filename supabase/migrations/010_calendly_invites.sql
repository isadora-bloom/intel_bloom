ALTER TABLE venues ADD COLUMN IF NOT EXISTS calendly_api_key TEXT;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS briefing_email TEXT;

CREATE TABLE IF NOT EXISTS venue_invites (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id     UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'member',
  token        TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  invited_by   UUID REFERENCES auth.users(id),
  accepted_at  TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(venue_id, email)
);
ALTER TABLE venue_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "venue_members_invites" ON venue_invites FOR ALL USING (
  venue_id IN (SELECT venue_id FROM venue_users WHERE user_id = auth.uid())
);
