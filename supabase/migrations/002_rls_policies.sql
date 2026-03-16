-- ============================================================
-- ROW LEVEL SECURITY — White Label Isolation Layer
-- Migration: 002_rls_policies.sql
-- CRITICAL: Every query on venue-scoped tables is filtered by venue_id
-- ============================================================

-- Enable RLS on all venue-scoped tables
ALTER TABLE venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_source_touchpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE tours ENABLE ROW LEVEL SECURITY;
ALTER TABLE uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE annotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE weather_forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE macro_competitor_landscape ENABLE ROW LEVEL SECURITY;
ALTER TABLE matching_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE pattern_benchmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_pulse ENABLE ROW LEVEL SECURITY;

-- Note: weather_monthly, weather_daily, macro_economic, macro_demographic,
-- macro_search_trends are shared public/national data — no RLS needed.

-- ============================================================
-- HELPER FUNCTION: get venue_id for authenticated user
-- ============================================================
CREATE OR REPLACE FUNCTION public.venue_id_for_user()
RETURNS UUID AS $$
  SELECT venue_id FROM venue_users
  WHERE user_id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================
-- VENUES: user can only see their own venue
-- ============================================================
CREATE POLICY "venue_isolation" ON venues
  FOR ALL
  USING (id = public.venue_id_for_user());

-- ============================================================
-- VENUE USERS: user can only see their own membership
-- ============================================================
CREATE POLICY "venue_isolation" ON venue_users
  FOR ALL
  USING (venue_id = public.venue_id_for_user());

-- ============================================================
-- CLIENTS
-- ============================================================
CREATE POLICY "venue_isolation" ON clients
  FOR ALL
  USING (venue_id = public.venue_id_for_user());

-- ============================================================
-- CLIENT SOURCE TOUCHPOINTS
-- ============================================================
CREATE POLICY "venue_isolation" ON client_source_touchpoints
  FOR ALL
  USING (venue_id = public.venue_id_for_user());

-- ============================================================
-- INQUIRIES
-- ============================================================
CREATE POLICY "venue_isolation" ON inquiries
  FOR ALL
  USING (venue_id = public.venue_id_for_user());

-- ============================================================
-- TOURS
-- ============================================================
CREATE POLICY "venue_isolation" ON tours
  FOR ALL
  USING (venue_id = public.venue_id_for_user());

-- ============================================================
-- UPLOADS
-- ============================================================
CREATE POLICY "venue_isolation" ON uploads
  FOR ALL
  USING (venue_id = public.venue_id_for_user());

-- ============================================================
-- PLANNING EVENTS
-- ============================================================
CREATE POLICY "venue_isolation" ON planning_events
  FOR ALL
  USING (venue_id = public.venue_id_for_user());

-- ============================================================
-- VENDORS
-- ============================================================
CREATE POLICY "venue_isolation" ON vendors
  FOR ALL
  USING (venue_id = public.venue_id_for_user());

-- ============================================================
-- CLIENT VENDORS
-- ============================================================
CREATE POLICY "venue_isolation" ON client_vendors
  FOR ALL
  USING (venue_id = public.venue_id_for_user());

-- ============================================================
-- ANNOTATIONS
-- ============================================================
CREATE POLICY "venue_isolation" ON annotations
  FOR ALL
  USING (venue_id = public.venue_id_for_user());

-- ============================================================
-- WEATHER FORECASTS
-- ============================================================
CREATE POLICY "venue_isolation" ON weather_forecasts
  FOR ALL
  USING (venue_id = public.venue_id_for_user());

-- ============================================================
-- COMPETITOR LANDSCAPE
-- ============================================================
CREATE POLICY "venue_isolation" ON macro_competitor_landscape
  FOR ALL
  USING (venue_id = public.venue_id_for_user());

-- ============================================================
-- MATCHING QUEUE
-- ============================================================
CREATE POLICY "venue_isolation" ON matching_queue
  FOR ALL
  USING (venue_id = public.venue_id_for_user());

-- ============================================================
-- PATTERN BENCHMARKS
-- Allow reading NULL venue_id (network aggregate benchmarks)
-- ============================================================
CREATE POLICY "venue_isolation_benchmarks" ON pattern_benchmarks
  FOR ALL
  USING (venue_id = public.venue_id_for_user() OR venue_id IS NULL);

-- ============================================================
-- MARKET PULSE
-- ============================================================
CREATE POLICY "venue_isolation" ON market_pulse
  FOR ALL
  USING (venue_id = public.venue_id_for_user());

-- ============================================================
-- SERVICE ROLE BYPASS (for ingestion workers and cron jobs)
-- The service role key bypasses RLS — use only in server-side workers.
-- Never expose the service role key to the browser.
-- ============================================================
