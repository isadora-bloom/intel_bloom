-- ============================================================
-- BLOOM SPINE — MIGRATION 002: RLS POLICIES
-- Enterprise-first. Two policies per table: venue isolation + org access.
-- Helper functions in public schema (auth schema restricted in hosted Supabase)
-- ============================================================

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_venue_id_for_user()
RETURNS UUID AS $$
  SELECT venue_id FROM venue_users
  WHERE user_id = auth.uid() AND is_active = TRUE
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_org_id_for_user()
RETURNS UUID AS $$
  SELECT organisation_id FROM venue_users
  WHERE user_id = auth.uid()
    AND organisation_id IS NOT NULL
    AND is_active = TRUE
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_role_for_venue(p_venue_id UUID)
RETURNS TEXT AS $$
  SELECT role FROM venue_users
  WHERE user_id = auth.uid()
    AND venue_id = p_venue_id
    AND is_active = TRUE
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM venue_users
    WHERE user_id = auth.uid()
      AND role = 'super_admin'
      AND is_active = TRUE
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Shorthand: is user in any active venue for org?
CREATE OR REPLACE FUNCTION public.get_venue_ids_for_org(p_org_id UUID)
RETURNS SETOF UUID AS $$
  SELECT id FROM venues WHERE organisation_id = p_org_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================
-- MACRO TABLES — NO RLS (public reference data, service writes)
-- ============================================================
ALTER TABLE macro_economic ENABLE ROW LEVEL SECURITY;
ALTER TABLE macro_demographic ENABLE ROW LEVEL SECURITY;
ALTER TABLE macro_search_trends ENABLE ROW LEVEL SECURITY;
ALTER TABLE weather_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE weather_monthly ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read" ON macro_economic FOR SELECT USING (true);
CREATE POLICY "service_write" ON macro_economic FOR INSERT WITH CHECK (true);
CREATE POLICY "service_update" ON macro_economic FOR UPDATE USING (true);

CREATE POLICY "public_read" ON macro_demographic FOR SELECT USING (true);
CREATE POLICY "service_write" ON macro_demographic FOR INSERT WITH CHECK (true);
CREATE POLICY "service_update" ON macro_demographic FOR UPDATE USING (true);

CREATE POLICY "public_read" ON macro_search_trends FOR SELECT USING (true);
CREATE POLICY "service_write" ON macro_search_trends FOR INSERT WITH CHECK (true);
CREATE POLICY "service_update" ON macro_search_trends FOR UPDATE USING (true);

CREATE POLICY "public_read" ON weather_daily FOR SELECT USING (true);
CREATE POLICY "service_write" ON weather_daily FOR INSERT WITH CHECK (true);
CREATE POLICY "service_update" ON weather_daily FOR UPDATE USING (true);

CREATE POLICY "public_read" ON weather_monthly FOR SELECT USING (true);
CREATE POLICY "service_write" ON weather_monthly FOR INSERT WITH CHECK (true);
CREATE POLICY "service_update" ON weather_monthly FOR UPDATE USING (true);

-- ============================================================
-- REUSABLE POLICY EXPRESSIONS (as comments for reference)
-- venue check:  venue_id = public.get_venue_id_for_user()
-- org check:    venue_id IN (SELECT public.get_venue_ids_for_org(public.get_org_id_for_user()))
-- super_admin:  public.is_super_admin()
-- ============================================================

-- ============================================================
-- ORGANISATIONS
-- ============================================================
ALTER TABLE organisations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_read" ON organisations FOR SELECT USING (
  id = (SELECT organisation_id FROM venue_users WHERE user_id = auth.uid() AND is_active = TRUE LIMIT 1)
  OR public.is_super_admin()
);
CREATE POLICY "super_admin_write" ON organisations FOR ALL USING (public.is_super_admin());

-- ============================================================
-- VENUES
-- ============================================================
ALTER TABLE venues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_read" ON venues FOR SELECT USING (
  id = public.get_venue_id_for_user()
  OR id IN (SELECT public.get_venue_ids_for_org(public.get_org_id_for_user()))
  OR public.is_super_admin()
);
CREATE POLICY "venue_admin_update" ON venues FOR UPDATE USING (
  (id = public.get_venue_id_for_user()
    AND public.get_role_for_venue(id) IN ('venue_owner', 'venue_admin'))
  OR public.is_super_admin()
);

-- ============================================================
-- VENUE USERS
-- ============================================================
ALTER TABLE venue_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_read" ON venue_users FOR SELECT USING (
  venue_id = public.get_venue_id_for_user()
  OR venue_id IN (SELECT public.get_venue_ids_for_org(public.get_org_id_for_user()))
  OR user_id = auth.uid()
  OR public.is_super_admin()
);
CREATE POLICY "venue_admin_write" ON venue_users FOR INSERT WITH CHECK (
  venue_id = public.get_venue_id_for_user()
  AND public.get_role_for_venue(venue_id) IN ('venue_owner', 'venue_admin')
  OR public.is_super_admin()
);
CREATE POLICY "venue_admin_update" ON venue_users FOR UPDATE USING (
  (venue_id = public.get_venue_id_for_user()
    AND public.get_role_for_venue(venue_id) IN ('venue_owner', 'venue_admin'))
  OR public.is_super_admin()
);

-- ============================================================
-- USER INVITATIONS
-- ============================================================
ALTER TABLE user_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_read" ON user_invitations FOR SELECT USING (
  venue_id = public.get_venue_id_for_user()
  OR venue_id IN (SELECT public.get_venue_ids_for_org(public.get_org_id_for_user()))
  OR public.is_super_admin()
  OR true  -- token-based accept flow reads by token
);
CREATE POLICY "service_write" ON user_invitations FOR INSERT WITH CHECK (true);
CREATE POLICY "service_update" ON user_invitations FOR UPDATE USING (true);

-- ============================================================
-- USER SESSIONS
-- ============================================================
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_or_admin" ON user_sessions FOR SELECT USING (
  user_id = auth.uid()
  OR (venue_id = public.get_venue_id_for_user()
      AND public.get_role_for_venue(venue_id) IN ('venue_owner', 'venue_admin'))
  OR public.is_super_admin()
);
CREATE POLICY "service_write" ON user_sessions FOR INSERT WITH CHECK (true);

-- ============================================================
-- CLIENTS
-- ============================================================
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_read" ON clients FOR SELECT USING (
  venue_id = public.get_venue_id_for_user()
  OR venue_id IN (SELECT public.get_venue_ids_for_org(public.get_org_id_for_user()))
  OR public.is_super_admin()
);
CREATE POLICY "venue_write" ON clients FOR INSERT WITH CHECK (
  venue_id = public.get_venue_id_for_user() OR public.is_super_admin()
);
CREATE POLICY "venue_update" ON clients FOR UPDATE USING (
  venue_id = public.get_venue_id_for_user() OR public.is_super_admin()
);
CREATE POLICY "venue_admin_delete" ON clients FOR DELETE USING (
  (venue_id = public.get_venue_id_for_user()
    AND public.get_role_for_venue(venue_id) IN ('venue_owner', 'venue_admin'))
  OR public.is_super_admin()
);

-- ============================================================
-- PRE-INQUIRY SIGNALS
-- ============================================================
ALTER TABLE pre_inquiry_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_read" ON pre_inquiry_signals FOR SELECT USING (
  venue_id = public.get_venue_id_for_user()
  OR venue_id IN (SELECT public.get_venue_ids_for_org(public.get_org_id_for_user()))
  OR public.is_super_admin()
);
CREATE POLICY "venue_write" ON pre_inquiry_signals FOR INSERT WITH CHECK (
  venue_id = public.get_venue_id_for_user() OR public.is_super_admin()
);
CREATE POLICY "venue_update" ON pre_inquiry_signals FOR UPDATE USING (
  venue_id = public.get_venue_id_for_user() OR public.is_super_admin()
);

-- ============================================================
-- LEADS
-- ============================================================
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_read" ON leads FOR SELECT USING (
  venue_id = public.get_venue_id_for_user()
  OR venue_id IN (SELECT public.get_venue_ids_for_org(public.get_org_id_for_user()))
  OR public.is_super_admin()
);
CREATE POLICY "venue_write" ON leads FOR INSERT WITH CHECK (
  venue_id = public.get_venue_id_for_user() OR public.is_super_admin()
);

-- ============================================================
-- INQUIRIES
-- ============================================================
ALTER TABLE inquiries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_read" ON inquiries FOR SELECT USING (
  venue_id = public.get_venue_id_for_user()
  OR venue_id IN (SELECT public.get_venue_ids_for_org(public.get_org_id_for_user()))
  OR public.is_super_admin()
);
CREATE POLICY "venue_write" ON inquiries FOR INSERT WITH CHECK (
  venue_id = public.get_venue_id_for_user() OR public.is_super_admin()
);
CREATE POLICY "venue_update" ON inquiries FOR UPDATE USING (
  venue_id = public.get_venue_id_for_user() OR public.is_super_admin()
);

-- ============================================================
-- TOURS
-- ============================================================
ALTER TABLE tours ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_read" ON tours FOR SELECT USING (
  venue_id = public.get_venue_id_for_user()
  OR venue_id IN (SELECT public.get_venue_ids_for_org(public.get_org_id_for_user()))
  OR public.is_super_admin()
);
CREATE POLICY "venue_write" ON tours FOR INSERT WITH CHECK (
  venue_id = public.get_venue_id_for_user() OR public.is_super_admin()
);
CREATE POLICY "venue_update" ON tours FOR UPDATE USING (
  venue_id = public.get_venue_id_for_user() OR public.is_super_admin()
);

-- ============================================================
-- UPLOADS
-- ============================================================
ALTER TABLE uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_read" ON uploads FOR SELECT USING (
  venue_id = public.get_venue_id_for_user()
  OR venue_id IN (SELECT public.get_venue_ids_for_org(public.get_org_id_for_user()))
  OR public.is_super_admin()
);
CREATE POLICY "venue_write" ON uploads FOR INSERT WITH CHECK (
  venue_id = public.get_venue_id_for_user() OR public.is_super_admin()
);
CREATE POLICY "venue_update" ON uploads FOR UPDATE USING (
  venue_id = public.get_venue_id_for_user() OR public.is_super_admin()
);

-- ============================================================
-- PLANNING EVENTS
-- ============================================================
ALTER TABLE planning_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_read" ON planning_events FOR SELECT USING (
  venue_id = public.get_venue_id_for_user()
  OR venue_id IN (SELECT public.get_venue_ids_for_org(public.get_org_id_for_user()))
  OR public.is_super_admin()
);
CREATE POLICY "venue_write" ON planning_events FOR INSERT WITH CHECK (
  venue_id = public.get_venue_id_for_user() OR public.is_super_admin()
);

-- ============================================================
-- CLIENT SOURCE TOUCHPOINTS
-- ============================================================
ALTER TABLE client_source_touchpoints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_read" ON client_source_touchpoints FOR SELECT USING (
  venue_id = public.get_venue_id_for_user()
  OR venue_id IN (SELECT public.get_venue_ids_for_org(public.get_org_id_for_user()))
  OR public.is_super_admin()
);
CREATE POLICY "venue_write" ON client_source_touchpoints FOR INSERT WITH CHECK (
  venue_id = public.get_venue_id_for_user() OR public.is_super_admin()
);

-- ============================================================
-- CHANNEL SPEND
-- ============================================================
ALTER TABLE channel_spend ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_read" ON channel_spend FOR SELECT USING (
  venue_id = public.get_venue_id_for_user()
  OR venue_id IN (SELECT public.get_venue_ids_for_org(public.get_org_id_for_user()))
  OR public.is_super_admin()
);
CREATE POLICY "venue_write" ON channel_spend FOR INSERT WITH CHECK (
  venue_id = public.get_venue_id_for_user() OR public.is_super_admin()
);
CREATE POLICY "venue_update" ON channel_spend FOR UPDATE USING (
  venue_id = public.get_venue_id_for_user() OR public.is_super_admin()
);
CREATE POLICY "venue_delete" ON channel_spend FOR DELETE USING (
  venue_id = public.get_venue_id_for_user() OR public.is_super_admin()
);

-- ============================================================
-- SOCIAL POSTS
-- ============================================================
ALTER TABLE social_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_read" ON social_posts FOR SELECT USING (
  venue_id = public.get_venue_id_for_user()
  OR venue_id IN (SELECT public.get_venue_ids_for_org(public.get_org_id_for_user()))
  OR public.is_super_admin()
);
CREATE POLICY "venue_write" ON social_posts FOR INSERT WITH CHECK (
  venue_id = public.get_venue_id_for_user() OR public.is_super_admin()
);

-- ============================================================
-- REVIEWS
-- ============================================================
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_read" ON reviews FOR SELECT USING (
  venue_id = public.get_venue_id_for_user()
  OR venue_id IN (SELECT public.get_venue_ids_for_org(public.get_org_id_for_user()))
  OR public.is_super_admin()
);
CREATE POLICY "venue_write" ON reviews FOR INSERT WITH CHECK (
  venue_id = public.get_venue_id_for_user() OR public.is_super_admin()
);
CREATE POLICY "venue_update" ON reviews FOR UPDATE USING (
  venue_id = public.get_venue_id_for_user() OR public.is_super_admin()
);

-- ============================================================
-- REVIEW LANGUAGE
-- ============================================================
ALTER TABLE review_language ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_read" ON review_language FOR SELECT USING (
  venue_id = public.get_venue_id_for_user()
  OR venue_id IN (SELECT public.get_venue_ids_for_org(public.get_org_id_for_user()))
  OR public.is_super_admin()
);
CREATE POLICY "venue_write" ON review_language FOR INSERT WITH CHECK (
  venue_id = public.get_venue_id_for_user() OR public.is_super_admin()
);
CREATE POLICY "venue_update" ON review_language FOR UPDATE USING (
  venue_id = public.get_venue_id_for_user() OR public.is_super_admin()
);

-- ============================================================
-- REFERRALS
-- ============================================================
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_read" ON referrals FOR SELECT USING (
  venue_id = public.get_venue_id_for_user()
  OR venue_id IN (SELECT public.get_venue_ids_for_org(public.get_org_id_for_user()))
  OR public.is_super_admin()
);
CREATE POLICY "venue_write" ON referrals FOR INSERT WITH CHECK (
  venue_id = public.get_venue_id_for_user() OR public.is_super_admin()
);

-- ============================================================
-- VENDORS + CLIENT_VENDORS + VENDOR_AVAILABILITY
-- ============================================================
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_read" ON vendors FOR SELECT USING (
  venue_id = public.get_venue_id_for_user()
  OR venue_id IN (SELECT public.get_venue_ids_for_org(public.get_org_id_for_user()))
  OR public.is_super_admin()
);
CREATE POLICY "venue_write" ON vendors FOR INSERT WITH CHECK (
  venue_id = public.get_venue_id_for_user() OR public.is_super_admin()
);
CREATE POLICY "venue_update" ON vendors FOR UPDATE USING (
  venue_id = public.get_venue_id_for_user() OR public.is_super_admin()
);

CREATE POLICY "venue_read" ON client_vendors FOR SELECT USING (
  venue_id = public.get_venue_id_for_user()
  OR venue_id IN (SELECT public.get_venue_ids_for_org(public.get_org_id_for_user()))
  OR public.is_super_admin()
);
CREATE POLICY "venue_write" ON client_vendors FOR INSERT WITH CHECK (
  venue_id = public.get_venue_id_for_user() OR public.is_super_admin()
);

CREATE POLICY "venue_read" ON vendor_availability FOR SELECT USING (
  venue_id = public.get_venue_id_for_user()
  OR venue_id IN (SELECT public.get_venue_ids_for_org(public.get_org_id_for_user()))
  OR public.is_super_admin()
);
CREATE POLICY "venue_write" ON vendor_availability FOR INSERT WITH CHECK (
  venue_id = public.get_venue_id_for_user() OR public.is_super_admin()
);

-- ============================================================
-- WEATHER FORECASTS (venue-scoped)
-- ============================================================
ALTER TABLE weather_forecasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_read" ON weather_forecasts FOR SELECT USING (
  venue_id = public.get_venue_id_for_user()
  OR venue_id IN (SELECT public.get_venue_ids_for_org(public.get_org_id_for_user()))
  OR public.is_super_admin()
);
CREATE POLICY "service_write" ON weather_forecasts FOR INSERT WITH CHECK (true);

-- ============================================================
-- MARKET PULSE (cached weekly)
-- ============================================================
ALTER TABLE market_pulse ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_read" ON market_pulse FOR SELECT USING (
  venue_id = public.get_venue_id_for_user()
  OR venue_id IN (SELECT public.get_venue_ids_for_org(public.get_org_id_for_user()))
  OR public.is_super_admin()
);
CREATE POLICY "service_write" ON market_pulse FOR INSERT WITH CHECK (true);
CREATE POLICY "service_update" ON market_pulse FOR UPDATE USING (true);

-- ============================================================
-- PATTERN BENCHMARKS (NULL venue_id = network aggregate)
-- ============================================================
ALTER TABLE pattern_benchmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "benchmark_read" ON pattern_benchmarks FOR SELECT USING (
  venue_id = public.get_venue_id_for_user()
  OR venue_id IS NULL
  OR venue_id IN (SELECT public.get_venue_ids_for_org(public.get_org_id_for_user()))
  OR (organisation_id IS NOT NULL AND organisation_id = public.get_org_id_for_user())
  OR public.is_super_admin()
);
CREATE POLICY "service_write" ON pattern_benchmarks FOR INSERT WITH CHECK (true);

-- ============================================================
-- MATCHING QUEUE
-- ============================================================
ALTER TABLE matching_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_read" ON matching_queue FOR SELECT USING (
  venue_id = public.get_venue_id_for_user()
  OR venue_id IN (SELECT public.get_venue_ids_for_org(public.get_org_id_for_user()))
  OR public.is_super_admin()
);
CREATE POLICY "venue_write" ON matching_queue FOR INSERT WITH CHECK (
  venue_id = public.get_venue_id_for_user() OR public.is_super_admin()
);
CREATE POLICY "venue_update" ON matching_queue FOR UPDATE USING (
  venue_id = public.get_venue_id_for_user() OR public.is_super_admin()
);

-- ============================================================
-- ANOMALY DETECTIONS
-- ============================================================
ALTER TABLE anomaly_detections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_read" ON anomaly_detections FOR SELECT USING (
  venue_id = public.get_venue_id_for_user()
  OR venue_id IN (SELECT public.get_venue_ids_for_org(public.get_org_id_for_user()))
  OR public.is_super_admin()
);
CREATE POLICY "service_write" ON anomaly_detections FOR INSERT WITH CHECK (true);
CREATE POLICY "venue_update" ON anomaly_detections FOR UPDATE USING (
  venue_id = public.get_venue_id_for_user() OR public.is_super_admin()
);

-- ============================================================
-- ANNOTATIONS
-- ============================================================
ALTER TABLE annotations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_read" ON annotations FOR SELECT USING (
  venue_id = public.get_venue_id_for_user()
  OR venue_id IN (SELECT public.get_venue_ids_for_org(public.get_org_id_for_user()))
  OR public.is_super_admin()
);
CREATE POLICY "venue_write" ON annotations FOR INSERT WITH CHECK (
  venue_id = public.get_venue_id_for_user() OR public.is_super_admin()
);
CREATE POLICY "venue_update" ON annotations FOR UPDATE USING (
  venue_id = public.get_venue_id_for_user() OR public.is_super_admin()
);

-- ============================================================
-- EMAIL THREADS + MESSAGES
-- ============================================================
ALTER TABLE email_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_read" ON email_threads FOR SELECT USING (
  venue_id = public.get_venue_id_for_user()
  OR venue_id IN (SELECT public.get_venue_ids_for_org(public.get_org_id_for_user()))
  OR public.is_super_admin()
);
CREATE POLICY "service_write" ON email_threads FOR INSERT WITH CHECK (true);
CREATE POLICY "service_update" ON email_threads FOR UPDATE USING (true);

CREATE POLICY "venue_read" ON email_messages FOR SELECT USING (
  venue_id = public.get_venue_id_for_user()
  OR venue_id IN (SELECT public.get_venue_ids_for_org(public.get_org_id_for_user()))
  OR public.is_super_admin()
);
CREATE POLICY "service_write" ON email_messages FOR INSERT WITH CHECK (true);

-- ============================================================
-- WEBSITE SESSIONS
-- ============================================================
ALTER TABLE website_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_read" ON website_sessions FOR SELECT USING (
  venue_id = public.get_venue_id_for_user()
  OR venue_id IN (SELECT public.get_venue_ids_for_org(public.get_org_id_for_user()))
  OR public.is_super_admin()
);
CREATE POLICY "service_write" ON website_sessions FOR INSERT WITH CHECK (true);

-- ============================================================
-- LOST DEALS
-- ============================================================
ALTER TABLE lost_deals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_read" ON lost_deals FOR SELECT USING (
  venue_id = public.get_venue_id_for_user()
  OR venue_id IN (SELECT public.get_venue_ids_for_org(public.get_org_id_for_user()))
  OR public.is_super_admin()
);
CREATE POLICY "venue_write" ON lost_deals FOR INSERT WITH CHECK (
  venue_id = public.get_venue_id_for_user() OR public.is_super_admin()
);
CREATE POLICY "venue_update" ON lost_deals FOR UPDATE USING (
  venue_id = public.get_venue_id_for_user() OR public.is_super_admin()
);

-- ============================================================
-- CONTENT TOUCHPOINTS
-- ============================================================
ALTER TABLE content_touchpoints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_read" ON content_touchpoints FOR SELECT USING (
  venue_id = public.get_venue_id_for_user()
  OR venue_id IN (SELECT public.get_venue_ids_for_org(public.get_org_id_for_user()))
  OR public.is_super_admin()
);
CREATE POLICY "service_write" ON content_touchpoints FOR INSERT WITH CHECK (true);

-- ============================================================
-- CAMPAIGNS
-- ============================================================
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_read" ON campaigns FOR SELECT USING (
  venue_id = public.get_venue_id_for_user()
  OR venue_id IN (SELECT public.get_venue_ids_for_org(public.get_org_id_for_user()))
  OR (organisation_id IS NOT NULL AND organisation_id = public.get_org_id_for_user())
  OR public.is_super_admin()
);
CREATE POLICY "venue_write" ON campaigns FOR INSERT WITH CHECK (
  venue_id = public.get_venue_id_for_user() OR public.is_super_admin()
);
CREATE POLICY "venue_update" ON campaigns FOR UPDATE USING (
  venue_id = public.get_venue_id_for_user() OR public.is_super_admin()
);

-- ============================================================
-- RESPONSE ALERTS
-- ============================================================
ALTER TABLE response_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_read" ON response_alerts FOR SELECT USING (
  venue_id = public.get_venue_id_for_user()
  OR venue_id IN (SELECT public.get_venue_ids_for_org(public.get_org_id_for_user()))
  OR public.is_super_admin()
);
CREATE POLICY "service_write" ON response_alerts FOR INSERT WITH CHECK (true);
CREATE POLICY "venue_update" ON response_alerts FOR UPDATE USING (
  venue_id = public.get_venue_id_for_user() OR public.is_super_admin()
);

-- ============================================================
-- REVENUE FORECASTS
-- ============================================================
ALTER TABLE revenue_forecasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_read" ON revenue_forecasts FOR SELECT USING (
  venue_id = public.get_venue_id_for_user()
  OR venue_id IN (SELECT public.get_venue_ids_for_org(public.get_org_id_for_user()))
  OR (organisation_id IS NOT NULL AND organisation_id = public.get_org_id_for_user())
  OR public.is_super_admin()
);
CREATE POLICY "service_write" ON revenue_forecasts FOR INSERT WITH CHECK (true);

-- ============================================================
-- VENUE HEALTH
-- ============================================================
ALTER TABLE venue_health ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_read" ON venue_health FOR SELECT USING (
  venue_id = public.get_venue_id_for_user()
  OR venue_id IN (SELECT public.get_venue_ids_for_org(public.get_org_id_for_user()))
  OR public.is_super_admin()
);
CREATE POLICY "service_write" ON venue_health FOR INSERT WITH CHECK (true);
CREATE POLICY "service_update" ON venue_health FOR UPDATE USING (true);

-- ============================================================
-- VENUE CAPACITY
-- ============================================================
ALTER TABLE venue_capacity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_read" ON venue_capacity FOR SELECT USING (
  venue_id = public.get_venue_id_for_user()
  OR venue_id IN (SELECT public.get_venue_ids_for_org(public.get_org_id_for_user()))
  OR public.is_super_admin()
);
CREATE POLICY "service_write" ON venue_capacity FOR INSERT WITH CHECK (true);
CREATE POLICY "service_update" ON venue_capacity FOR UPDATE USING (true);

-- ============================================================
-- AI USAGE LOG
-- ============================================================
ALTER TABLE ai_usage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_read" ON ai_usage_log FOR SELECT USING (
  venue_id = public.get_venue_id_for_user()
  OR venue_id IN (SELECT public.get_venue_ids_for_org(public.get_org_id_for_user()))
  OR public.is_super_admin()
);
CREATE POLICY "service_write" ON ai_usage_log FOR INSERT WITH CHECK (true);

-- ============================================================
-- DATA ACCESS LOG
-- ============================================================
ALTER TABLE data_access_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_read" ON data_access_log FOR SELECT USING (
  (venue_id = public.get_venue_id_for_user()
    AND public.get_role_for_venue(venue_id) IN ('venue_owner', 'venue_admin'))
  OR public.is_super_admin()
);
CREATE POLICY "service_write" ON data_access_log FOR INSERT WITH CHECK (true);

-- ============================================================
-- WEEKLY INSIGHTS
-- ============================================================
ALTER TABLE weekly_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_read" ON weekly_insights FOR SELECT USING (
  venue_id = public.get_venue_id_for_user()
  OR venue_id IN (SELECT public.get_venue_ids_for_org(public.get_org_id_for_user()))
  OR public.is_super_admin()
);
CREATE POLICY "service_write" ON weekly_insights FOR INSERT WITH CHECK (true);
CREATE POLICY "service_update" ON weekly_insights FOR UPDATE USING (true);

-- ============================================================
-- CUSTOMER HEALTH (Bloom internal only)
-- ============================================================
ALTER TABLE customer_health ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_read" ON customer_health FOR SELECT USING (public.is_super_admin());
CREATE POLICY "service_write" ON customer_health FOR INSERT WITH CHECK (true);
CREATE POLICY "service_update" ON customer_health FOR UPDATE USING (true);
