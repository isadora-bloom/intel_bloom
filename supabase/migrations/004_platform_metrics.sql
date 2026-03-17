-- ============================================================
-- PLATFORM METRICS
-- Time-series metrics captured from The Knot/WeddingWire/Google/Meta
-- Each row = one metric, one platform, one time period
-- ============================================================
CREATE TABLE platform_metrics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  captured_at     TIMESTAMPTZ DEFAULT NOW(),
  platform        TEXT NOT NULL,       -- 'the_knot', 'wedding_wire', 'google_ads', 'instagram', 'google_analytics', 'overall'
  metric_name     TEXT NOT NULL,       -- 'impressions', 'saves', 'visitors', 'leads', 'reviews', 'clicks', 'link_clicks', 'calls'
  metric_value    DECIMAL(14,2),       -- e.g. 37300 or 587 or 4364
  period_start    DATE,
  period_end      DATE,
  period_label    TEXT,               -- raw label from screenshot: 'last 12 months', 'Mar 2025'
  breakdown       JSONB,              -- [{label:'Apr',value:3000},{label:'May',value:3000}...]
  comparison      TEXT,               -- e.g. '-2% vs last 30 days'
  source          TEXT DEFAULT 'capture_upload',
  UNIQUE (venue_id, platform, metric_name, period_start, period_end)
);

-- ============================================================
-- SOURCE SPEND
-- What the venue pays per platform/channel per contract period
-- Powers cost-per-inquiry and cost-per-booking calculations
-- ============================================================
CREATE TABLE source_spend (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id            UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  platform            TEXT NOT NULL,       -- 'the_knot', 'wedding_wire', 'google_ads', 'instagram_ads', 'other'
  annual_spend_cents  BIGINT,              -- e.g. 1513260 for $15,132.60/yr
  contract_start      DATE,
  contract_end        DATE,
  contract_label      TEXT,               -- e.g. 'The Knot Featured All Venue DC/MD/VA Region'
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  source              TEXT DEFAULT 'capture_upload',
  UNIQUE (venue_id, platform, contract_start)
);

-- RLS
ALTER TABLE platform_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_spend ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_members_platform_metrics" ON platform_metrics
  FOR ALL USING (
    venue_id IN (
      SELECT venue_id FROM venue_users WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "venue_members_source_spend" ON source_spend
  FOR ALL USING (
    venue_id IN (
      SELECT venue_id FROM venue_users WHERE user_id = auth.uid()
    )
  );

-- Indexes
CREATE INDEX idx_platform_metrics_venue ON platform_metrics(venue_id, platform, metric_name);
CREATE INDEX idx_source_spend_venue ON source_spend(venue_id, platform);
