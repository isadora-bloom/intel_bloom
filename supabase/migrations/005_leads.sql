-- ============================================================
-- LEADS
-- Pre-inquiry funnel touches — saves, visits, link clicks, social
-- engagements — for named people where the source gives us a name.
-- Can later be linked to an inquiry and then a client record,
-- giving a full journey timeline.
-- ============================================================
CREATE TABLE leads (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id          UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  source_date       DATE,                 -- when the touch happened
  platform          TEXT NOT NULL,        -- the_knot, wedding_wire, instagram, google, direct
  touch_type        TEXT NOT NULL,        -- save, storefront_visit, website_visit, link_click, social_follow, social_dm, call, form_visit
  name              TEXT,                 -- person's name if given by source
  raw_activity      TEXT,                 -- original line/text from source
  linked_inquiry_id UUID REFERENCES inquiries(id) ON DELETE SET NULL,
  linked_client_id  UUID REFERENCES clients(id) ON DELETE SET NULL,
  source            TEXT DEFAULT 'capture_upload'
);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_members_leads" ON leads
  FOR ALL USING (
    venue_id IN (SELECT venue_id FROM venue_users WHERE user_id = auth.uid())
  );

CREATE INDEX idx_leads_venue ON leads(venue_id, platform, touch_type);
CREATE INDEX idx_leads_name ON leads(venue_id, name);
CREATE INDEX idx_leads_date ON leads(venue_id, source_date);
CREATE INDEX idx_leads_linked_inquiry ON leads(linked_inquiry_id);
CREATE INDEX idx_leads_linked_client ON leads(linked_client_id);
