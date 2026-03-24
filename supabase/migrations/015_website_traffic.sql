-- Website traffic table — stores GA/analytics exports uploaded by venue owners
CREATE TABLE IF NOT EXISTS website_traffic (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  venue_id         UUID NOT NULL,
  date             DATE NOT NULL,
  sessions         INTEGER,
  users            INTEGER,
  new_users        INTEGER,
  pageviews        INTEGER,
  bounce_rate      DECIMAL(5,2),
  avg_session_duration_seconds INTEGER,
  source           TEXT,    -- 'organic', 'direct', 'referral', 'social', 'paid', etc.
  medium           TEXT,
  uploaded_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (venue_id, date, source, medium)
);

CREATE INDEX IF NOT EXISTS idx_website_traffic_venue_date ON website_traffic (venue_id, date);

ALTER TABLE website_traffic ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_isolation" ON website_traffic
  USING (
    venue_id IN (
      SELECT venue_id FROM venue_users WHERE user_id = auth.uid()
    )
  );
