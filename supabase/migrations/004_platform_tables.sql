-- ============================================================
-- BLOOM SPINE — MIGRATION 004: PLATFORM METRICS & SOURCE SPEND
-- platform_metrics: monthly stats from The Knot, WeddingWire, etc.
-- source_spend: annual/multi-month platform contracts
-- ============================================================

-- ============================================================
-- PLATFORM METRICS
-- Impressions, saves, visitors, leads from listing platforms
-- ============================================================
CREATE TABLE platform_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  captured_at TIMESTAMPTZ DEFAULT NOW(),
  platform TEXT NOT NULL,        -- the_knot, wedding_wire, google_ads, meta, instagram
  metric_name TEXT NOT NULL,     -- impressions, saves, visitors, leads, link_clicks, calls, ctr, cpc
  metric_value DECIMAL,
  period_start DATE,
  period_end DATE,
  period_label TEXT,             -- raw period string e.g. "last 12 months", "Apr 2025–Mar 2026"
  breakdown JSONB,               -- [{label, value}, ...] monthly breakdown
  comparison TEXT,               -- "−2% vs last 30 days"
  source TEXT DEFAULT 'capture_upload',
  UNIQUE(venue_id, platform, metric_name, period_start, period_end)
);

-- ============================================================
-- SOURCE SPEND
-- Annual or multi-month platform contracts (The Knot featured, etc.)
-- Distinct from channel_spend which is monthly operational spend
-- ============================================================
CREATE TABLE source_spend (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  platform TEXT NOT NULL,
  annual_spend_cents INTEGER,
  contract_start DATE,
  contract_end DATE,
  contract_label TEXT,           -- "The Knot Featured All Venue DC/MD/VA Region"
  source TEXT DEFAULT 'capture_upload'
);

-- RLS
ALTER TABLE platform_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_spend ENABLE ROW LEVEL SECURITY;

CREATE POLICY platform_metrics_venue_read ON platform_metrics
  FOR SELECT USING (venue_id = public.get_venue_id_for_user());

CREATE POLICY platform_metrics_venue_write ON platform_metrics
  FOR INSERT WITH CHECK (venue_id = public.get_venue_id_for_user());

CREATE POLICY platform_metrics_venue_update ON platform_metrics
  FOR UPDATE USING (venue_id = public.get_venue_id_for_user());

CREATE POLICY platform_metrics_service_write ON platform_metrics
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY source_spend_venue_read ON source_spend
  FOR SELECT USING (venue_id = public.get_venue_id_for_user());

CREATE POLICY source_spend_venue_write ON source_spend
  FOR INSERT WITH CHECK (venue_id = public.get_venue_id_for_user());

CREATE POLICY source_spend_venue_update ON source_spend
  FOR UPDATE USING (venue_id = public.get_venue_id_for_user());

CREATE POLICY source_spend_service_write ON source_spend
  FOR ALL USING (auth.role() = 'service_role');

-- Indexes
CREATE INDEX idx_platform_metrics_venue ON platform_metrics(venue_id, platform, metric_name);
CREATE INDEX idx_source_spend_venue ON source_spend(venue_id, platform);
