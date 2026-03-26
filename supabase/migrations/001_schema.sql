-- ============================================================
-- BLOOM SPINE — MIGRATION 001: COMPLETE SCHEMA
-- Spec-exact. Enterprise from day one. Four-app shared DB.
-- ============================================================

-- ============================================================
-- ORGANISATIONS
-- ============================================================
CREATE TABLE organisations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  logo_url TEXT,
  primary_color TEXT,
  billing_email TEXT,
  plan TEXT DEFAULT 'enterprise',
  monthly_platform_fee_cents INTEGER DEFAULT 0,
  per_venue_fee_cents INTEGER DEFAULT 15000
);

-- ============================================================
-- VENUES
-- ============================================================
CREATE TABLE venues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID REFERENCES organisations(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  address_line1 TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip TEXT NOT NULL,
  lat DECIMAL(9,6),
  lng DECIMAL(9,6),
  region TEXT,
  -- Location calibration (auto-populated on onboarding from lat/lng)
  noaa_station_id TEXT,
  noaa_station_name TEXT,
  county_fips TEXT,
  fed_district INTEGER,
  google_trends_metro TEXT,
  -- White-label branding
  logo_url TEXT,
  primary_color TEXT DEFAULT '#1A6B6B',
  secondary_color TEXT DEFAULT '#B07080',
  font_family TEXT DEFAULT 'system',
  custom_domain TEXT,
  -- Sage config
  sage_tone TEXT DEFAULT 'warm_professional',
  sage_greeting TEXT,
  sage_auto_reply BOOLEAN DEFAULT TRUE,
  sage_voice_description TEXT,
  -- Vendor config
  vendor_fit_weights JSONB,
  -- Pricing config
  packages JSONB,
  demand_premium_threshold INTEGER DEFAULT 5,
  -- Integration keys
  honeybook_api_key TEXT,
  knot_venue_id TEXT,
  google_place_id TEXT,
  gmail_oauth_token JSONB,
  ga4_property_id TEXT,
  google_ads_customer_id TEXT,
  instagram_business_id TEXT,
  -- Settings
  timezone TEXT DEFAULT 'America/New_York',
  onboarding_complete BOOLEAN DEFAULT FALSE,
  contributes_to_benchmark BOOLEAN DEFAULT TRUE
);

-- ============================================================
-- VENUE USERS & AUTH
-- ============================================================
CREATE TABLE venue_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  organisation_id UUID REFERENCES organisations(id),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  invited_by UUID REFERENCES auth.users(id),
  UNIQUE(venue_id, user_id)
);

CREATE TABLE user_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  organisation_id UUID REFERENCES organisations(id),
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  invited_by UUID NOT NULL REFERENCES auth.users(id),
  invited_at TIMESTAMPTZ DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days',
  token TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'pending'
);

CREATE TABLE user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  venue_id UUID REFERENCES venues(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  ip_address TEXT,
  user_agent TEXT,
  device_type TEXT,
  session_duration_minutes INTEGER
);

-- ============================================================
-- CLIENTS (the spine — one row per couple)
-- ============================================================
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  -- Identity
  name_primary TEXT NOT NULL,
  name_partner TEXT,
  email_primary TEXT,
  email_partner TEXT,
  phone_primary TEXT,
  phone_partner TEXT,
  -- Event
  event_date DATE,
  event_date_confirmed BOOLEAN DEFAULT FALSE,
  event_year INTEGER GENERATED ALWAYS AS (EXTRACT(YEAR FROM event_date)::INTEGER) STORED,
  event_month INTEGER GENERATED ALWAYS AS (EXTRACT(MONTH FROM event_date)::INTEGER) STORED,
  event_day_of_week INTEGER GENERATED ALWAYS AS (EXTRACT(DOW FROM event_date)::INTEGER) STORED,
  package TEXT,
  guest_count_initial INTEGER,
  guest_count_final INTEGER,
  revenue_cents INTEGER,
  -- Stage transitions
  status TEXT DEFAULT 'inquiry',
  inquired_at TIMESTAMPTZ,
  tour_booked_at TIMESTAMPTZ,
  toured_at TIMESTAMPTZ,
  held_at TIMESTAMPTZ,
  contracted_at TIMESTAMPTZ,
  event_completed_at TIMESTAMPTZ,
  -- Attribution
  first_touch_platform TEXT,
  first_touch_date TIMESTAMPTZ,
  inquiry_channel TEXT,
  inquiry_intent TEXT,
  self_reported_source TEXT,
  resolved_source TEXT,
  resolved_source_confidence INTEGER,
  acquisition_cost_cents INTEGER,
  referrer_client_id UUID,  -- self-ref added after table creation
  referrer_name TEXT,
  competing_venues TEXT[],
  days_from_signal_to_inquiry INTEGER,
  session_pages_visited TEXT[],
  session_count INTEGER,
  session_source_url TEXT,
  session_data JSONB,
  -- Planning
  complexity_score INTEGER,
  stress_flags JSONB,            -- SENSITIVE: hard-delete after 12 months
  family_dynamics_flags JSONB,   -- SENSITIVE: hard-delete after 12 months
  assigned_coordinator TEXT,
  -- Event day
  weather_event_date JSONB,
  weather_difficulty_score INTEGER,
  staffing_hours_actual INTEGER,
  day_of_complexity INTEGER,
  -- Post-wedding Sage sequence
  post_wedding_day2_sent TIMESTAMPTZ,
  post_wedding_day14_sent TIMESTAMPTZ,
  post_wedding_day30_sent TIMESTAMPTZ,
  post_wedding_day90_sent TIMESTAMPTZ,
  post_wedding_anniversary_sent TIMESTAMPTZ,
  -- Review
  review_submitted BOOLEAN DEFAULT FALSE,
  review_submitted_at TIMESTAMPTZ,
  review_platform TEXT,
  review_star_rating DECIMAL(2,1),
  review_text TEXT,
  review_sentiment TEXT,
  review_adjusted_score DECIMAL(3,1),
  -- Referrals
  referrals_generated INTEGER DEFAULT 0,
  -- Response tracking
  first_response_at TIMESTAMPTZ,
  response_time_minutes INTEGER,
  -- Seed data flag
  is_seed_data BOOLEAN DEFAULT FALSE
);

-- Self-ref FK after table creation
ALTER TABLE clients ADD CONSTRAINT clients_referrer_fk
  FOREIGN KEY (referrer_client_id) REFERENCES clients(id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- PRE-INQUIRY SIGNALS
-- Instagram weights: like=1, comment=3, save=4, follow=2, DM=5
-- The Knot: first_name + last_initial ONLY
-- ============================================================
CREATE TABLE pre_inquiry_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  platform TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  engagement_weight INTEGER DEFAULT 1,
  first_name TEXT,
  last_initial TEXT,
  full_name TEXT,
  instagram_handle TEXT,
  source_date TIMESTAMPTZ,
  raw_activity TEXT,
  post_url TEXT,
  linked_inquiry_id UUID,
  linked_client_id UUID REFERENCES clients(id),
  days_to_inquiry INTEGER
);

-- ============================================================
-- LEADS (named pre-inquiry touches)
-- ============================================================
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  platform TEXT NOT NULL,
  touch_type TEXT NOT NULL,
  name TEXT,
  raw_activity TEXT,
  source_date TIMESTAMPTZ,
  linked_inquiry_id UUID,
  linked_client_id UUID REFERENCES clients(id)
);

-- ============================================================
-- INQUIRIES
-- ============================================================
CREATE TABLE inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  platform TEXT NOT NULL,
  external_id TEXT,
  raw_message TEXT,
  name_extracted TEXT,
  email_extracted TEXT,
  phone_extracted TEXT,
  event_date_extracted DATE,
  budget_extracted INTEGER,
  guest_count_extracted INTEGER,
  inquiry_intent TEXT DEFAULT 'unknown',
  first_contact_channel TEXT,
  touchpoint_classification TEXT,
  received_at TIMESTAMPTZ,
  day_of_week INTEGER,
  hour_of_day INTEGER,
  campaign_id TEXT,
  session_data JSONB,
  prior_signal_id UUID REFERENCES pre_inquiry_signals(id),
  prior_signal_confidence INTEGER,
  days_from_signal_to_inquiry INTEGER,
  matched_client_id UUID REFERENCES clients(id),
  match_confidence INTEGER,
  match_status TEXT DEFAULT 'unmatched',
  response_sent_at TIMESTAMPTZ,
  response_time_minutes INTEGER,
  responded_by TEXT
);

-- Back-fill FKs now that inquiries exists
ALTER TABLE pre_inquiry_signals ADD CONSTRAINT pre_inquiry_signals_linked_inquiry_fk
  FOREIGN KEY (linked_inquiry_id) REFERENCES inquiries(id);
ALTER TABLE leads ADD CONSTRAINT leads_linked_inquiry_fk
  FOREIGN KEY (linked_inquiry_id) REFERENCES inquiries(id);

-- ============================================================
-- TOURS
-- ============================================================
CREATE TABLE tours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id),
  scheduled_at TIMESTAMPTZ,
  tour_type TEXT,
  completed BOOLEAN DEFAULT FALSE,
  cancelled BOOLEAN DEFAULT FALSE,
  cancel_reason TEXT,
  self_reported_source TEXT,
  competing_venues TEXT[],
  conducted_by TEXT,
  upload_id UUID,
  notes_raw TEXT,
  outcome TEXT,
  booking_date DATE,
  booking_conversion_days INTEGER,
  lost_reason TEXT
);

-- ============================================================
-- UPLOADS
-- ============================================================
CREATE TABLE uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  file_name TEXT,
  file_type TEXT,
  file_size_bytes INTEGER,
  storage_path TEXT,
  upload_type TEXT,
  status TEXT DEFAULT 'pending',
  transcript TEXT,
  extracted_signals JSONB,   -- AI DRAFT only
  confirmed_signals JSONB,   -- human confirmed → writes to client record
  upload_date TIMESTAMPTZ
);

ALTER TABLE tours ADD CONSTRAINT tours_upload_fk
  FOREIGN KEY (upload_id) REFERENCES uploads(id);

-- ============================================================
-- PLANNING EVENTS
-- ============================================================
CREATE TABLE planning_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  event_type TEXT NOT NULL,
  event_date TIMESTAMPTZ,
  metadata JSONB,
  source TEXT
);

-- ============================================================
-- CLIENT SOURCE TOUCHPOINTS
-- ============================================================
CREATE TABLE client_source_touchpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  touchpoint_date TIMESTAMPTZ,
  campaign_id TEXT,
  campaign_name TEXT,
  cost_cents INTEGER,
  raw_data JSONB
);

-- ============================================================
-- CHANNEL SPEND (monthly per channel)
-- ============================================================
CREATE TABLE channel_spend (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  month DATE NOT NULL,
  channel TEXT NOT NULL,
  spend_cents INTEGER NOT NULL,
  notes TEXT,
  UNIQUE(venue_id, month, channel)
);

-- ============================================================
-- SOCIAL POSTS
-- ============================================================
CREATE TABLE social_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  platform TEXT NOT NULL,
  post_date TIMESTAMPTZ,
  post_url TEXT,
  post_type TEXT,
  reach INTEGER,
  impressions INTEGER,
  saves INTEGER,
  website_clicks INTEGER,
  engagement_rate DECIMAL(5,2),
  is_viral BOOLEAN DEFAULT FALSE
);

-- ============================================================
-- REVIEWS
-- ============================================================
CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  platform TEXT NOT NULL,
  platform_review_id TEXT,
  reviewer_name TEXT,
  rating DECIMAL(2,1),
  review_text TEXT,
  review_date TIMESTAMPTZ,
  sentiment_score DECIMAL(3,2),
  themes TEXT[],
  standout_phrases TEXT[],
  concerns_mentioned TEXT[],
  wedding_date_mentioned DATE,
  matched_client_id UUID REFERENCES clients(id),
  match_confidence INTEGER,
  match_status TEXT DEFAULT 'unmatched'
);

-- ============================================================
-- REVIEW LANGUAGE
-- approved_for_sage: auto-set from high-confidence extraction
-- approved_for_marketing: requires human click
-- ============================================================
CREATE TABLE review_language (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  theme TEXT NOT NULL,
  phrase TEXT NOT NULL,
  frequency_count INTEGER DEFAULT 1,
  avg_rating DECIMAL(2,1),
  source_review_ids UUID[],
  approved_for_sage BOOLEAN DEFAULT FALSE,
  approved_for_marketing BOOLEAN DEFAULT FALSE,
  flagged_as_concern BOOLEAN DEFAULT FALSE,
  approved_at TIMESTAMPTZ,
  approved_by TEXT
);

-- ============================================================
-- REFERRALS
-- ============================================================
CREATE TABLE referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  referring_client_id UUID NOT NULL REFERENCES clients(id),
  referred_client_id UUID REFERENCES clients(id),
  referred_inquiry_id UUID REFERENCES inquiries(id),
  source TEXT,
  referral_noted_at TIMESTAMPTZ DEFAULT NOW(),
  converted BOOLEAN DEFAULT FALSE,
  converted_at TIMESTAMPTZ
);

-- ============================================================
-- VENDORS (schema only — UI built later per spec rule 16)
-- ============================================================
CREATE TABLE vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  name TEXT NOT NULL,
  category TEXT,
  email TEXT,
  website TEXT,
  style_tags TEXT[],
  pricing_tier TEXT,
  appearances_count INTEGER DEFAULT 0,
  avg_review_score DECIMAL(3,1),
  avg_complexity_score INTEGER,
  referrals_sent_12m INTEGER DEFAULT 0,
  referral_revenue_cents_12m INTEGER DEFAULT 0,
  referral_conversion_rate DECIMAL(4,2),
  review_mention_count INTEGER DEFAULT 0,
  last_scorecard_at TIMESTAMPTZ
);

CREATE TABLE client_vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  confirmed BOOLEAN DEFAULT FALSE,
  UNIQUE(client_id, vendor_id)
);

CREATE TABLE vendor_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  available BOOLEAN DEFAULT TRUE,
  UNIQUE(vendor_id, date)
);

-- ============================================================
-- WEATHER
-- outdoor_score 0-10: temp_4pm comfort (65-80F=high) +
--   rain_chance (low=high) + wind (low=high)
-- ============================================================
CREATE TABLE weather_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id TEXT NOT NULL,
  date DATE NOT NULL,
  temp_max_f DECIMAL(5,1),
  temp_min_f DECIMAL(5,1),
  temp_4pm_f DECIMAL(5,1),
  precipitation DECIMAL(6,2),
  rain_chance_pct INTEGER,
  snow DECIMAL(6,2),
  wind_avg DECIMAL(5,1),
  outdoor_score INTEGER,
  UNIQUE(station_id, date)
);

CREATE TABLE weather_monthly (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id TEXT NOT NULL,
  month DATE NOT NULL,
  avg_temp_4pm_f DECIMAL(5,1),
  avg_rain_chance_pct INTEGER,
  total_precip DECIMAL(6,2),
  precip_days INTEGER,
  outdoor_score INTEGER,
  UNIQUE(station_id, month)
);

CREATE TABLE weather_forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  forecast_date DATE NOT NULL,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  forecast_data JSONB,
  UNIQUE(venue_id, forecast_date, fetched_at)
);

-- ============================================================
-- MACRO SIGNALS (no RLS — public data)
-- ============================================================
CREATE TABLE macro_economic (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id TEXT NOT NULL,
  date DATE NOT NULL,
  value DECIMAL(12,4),
  region TEXT,
  UNIQUE(series_id, date)
);

CREATE TABLE macro_demographic (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  county_fips TEXT NOT NULL,
  year INTEGER NOT NULL,
  metric TEXT NOT NULL,
  value DECIMAL(12,4),
  UNIQUE(county_fips, year, metric)
);

-- metro = google_trends_metro value from venues table
-- week = Monday of the ISO week
-- interest = 0-100 Google Trends relative interest
CREATE TABLE macro_search_trends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metro TEXT NOT NULL,
  term TEXT NOT NULL,
  week DATE NOT NULL,
  interest INTEGER,
  UNIQUE(metro, term, week)
);

-- ============================================================
-- MARKET PULSE (cached weekly — never recalculate on page load)
-- ============================================================
CREATE TABLE market_pulse (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  valid_until TIMESTAMPTZ,
  weather_score DECIMAL(4,2),
  economic_score DECIMAL(4,2),
  search_trend_score DECIMAL(4,2),
  confidence_score DECIMAL(4,2),
  composite_score DECIMAL(4,2),
  outlook TEXT,
  contributing_factors JSONB,
  UNIQUE(venue_id, calculated_at)
);

-- ============================================================
-- PATTERN BENCHMARKS
-- venue_id NULL = network-level aggregate
-- ============================================================
CREATE TABLE pattern_benchmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID REFERENCES venues(id),
  organisation_id UUID REFERENCES organisations(id),
  metric TEXT NOT NULL,
  period TEXT NOT NULL,
  value JSONB NOT NULL,
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  sample_size INTEGER
);

-- ============================================================
-- MATCHING QUEUE
-- ============================================================
CREATE TABLE matching_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  record_a_type TEXT NOT NULL,
  record_a_id UUID NOT NULL,
  record_b_type TEXT NOT NULL,
  record_b_id UUID NOT NULL,
  confidence INTEGER NOT NULL,
  signals_matched JSONB,
  signals_unmatched JSONB,
  status TEXT DEFAULT 'pending',
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ
);

-- ============================================================
-- ANOMALY DETECTIONS + ANNOTATIONS (circular FK — careful order)
-- ============================================================
CREATE TABLE anomaly_detections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  organisation_id UUID REFERENCES organisations(id),
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  metric TEXT NOT NULL,
  direction TEXT NOT NULL,  -- 'up' | 'down'
  magnitude_pct DECIMAL(6,2),
  period_current TEXT,
  period_baseline TEXT,
  baseline_type TEXT,       -- 'rolling_avg' | 'prior_year' | 'both'
  current_value DECIMAL(12,2),
  baseline_value DECIMAL(12,2),
  ai_possible_causes JSONB,
  ai_confidence INTEGER,
  ai_recommendation TEXT,
  status TEXT DEFAULT 'new', -- 'new' | 'acknowledged' | 'dismissed'
  severity TEXT DEFAULT 'info', -- 'info' | 'warning' | 'critical'
  acknowledged_by TEXT,
  acknowledged_at TIMESTAMPTZ,
  annotation_id UUID  -- FK added after annotations table
);

CREATE TABLE annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  annotation_type TEXT NOT NULL,
  period_start DATE,
  period_end DATE,
  category TEXT,
  note TEXT NOT NULL,
  exclude_from_patterns BOOLEAN DEFAULT FALSE,
  affects_metrics TEXT[],
  anomaly_id UUID REFERENCES anomaly_detections(id),
  created_by TEXT NOT NULL,
  created_by_role TEXT
);

ALTER TABLE anomaly_detections ADD CONSTRAINT anomaly_annotation_fk
  FOREIGN KEY (annotation_id) REFERENCES annotations(id);

-- ============================================================
-- EMAIL THREADS + MESSAGES (Gmail / Sage integration)
-- ============================================================
CREATE TABLE email_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id),
  gmail_thread_id TEXT NOT NULL,
  subject TEXT,
  first_message_at TIMESTAMPTZ,
  last_message_at TIMESTAMPTZ,
  message_count INTEGER DEFAULT 0,
  direction TEXT,
  is_inquiry BOOLEAN DEFAULT FALSE,
  is_sage_handled BOOLEAN DEFAULT FALSE,
  UNIQUE(venue_id, gmail_thread_id)
);

CREATE TABLE email_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  thread_id UUID NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
  gmail_message_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  from_address TEXT,
  to_address TEXT,
  sent_at TIMESTAMPTZ,
  subject TEXT,
  body_preview TEXT,
  extracted_name TEXT,
  extracted_event_date DATE,
  extracted_signals JSONB,
  UNIQUE(venue_id, gmail_message_id)
);

-- ============================================================
-- WEBSITE SESSIONS (GA4)
-- ============================================================
CREATE TABLE website_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  session_id TEXT,
  session_date DATE,
  source TEXT,
  medium TEXT,
  campaign TEXT,
  landing_page TEXT,
  pages_viewed TEXT[],
  page_count INTEGER,
  session_duration_seconds INTEGER,
  is_return_visitor BOOLEAN DEFAULT FALSE,
  visit_number INTEGER,
  converted BOOLEAN DEFAULT FALSE,
  linked_inquiry_id UUID REFERENCES inquiries(id),
  linked_client_id UUID REFERENCES clients(id)
);

-- ============================================================
-- LOST DEALS
-- ============================================================
CREATE TABLE lost_deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id),
  inquiry_id UUID REFERENCES inquiries(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  lost_at_stage TEXT NOT NULL,
  reason_category TEXT,
  reason_detail TEXT,
  competitor_name TEXT,
  coordinator TEXT,
  days_in_stage INTEGER,
  recovery_attempted BOOLEAN DEFAULT FALSE,
  recovery_outcome TEXT
);

-- ============================================================
-- CONTENT TOUCHPOINTS
-- ============================================================
CREATE TABLE content_touchpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id),
  content_type TEXT NOT NULL,
  content_id TEXT,
  content_title TEXT,
  touchpoint_date TIMESTAMPTZ,
  interaction_type TEXT,
  in_booking_journey BOOLEAN DEFAULT FALSE,
  revenue_attributed_cents INTEGER
);

-- ============================================================
-- CAMPAIGNS
-- ============================================================
CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID REFERENCES venues(id),
  organisation_id UUID REFERENCES organisations(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  name TEXT NOT NULL,
  campaign_type TEXT,
  channel TEXT,
  start_date DATE,
  end_date DATE,
  spend_cents INTEGER,
  inquiries_attributed INTEGER DEFAULT 0,
  tours_attributed INTEGER DEFAULT 0,
  bookings_attributed INTEGER DEFAULT 0,
  revenue_attributed_cents INTEGER DEFAULT 0,
  cost_per_inquiry_cents INTEGER,
  cost_per_booking_cents INTEGER,
  roi_ratio DECIMAL(6,2)
);

-- ============================================================
-- RESPONSE ALERTS
-- ============================================================
CREATE TABLE response_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  inquiry_id UUID NOT NULL REFERENCES inquiries(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  alert_type TEXT NOT NULL,
  threshold_minutes INTEGER,
  actual_minutes INTEGER,
  resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMPTZ
);

-- ============================================================
-- REVENUE FORECASTS
-- ============================================================
CREATE TABLE revenue_forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID REFERENCES venues(id),
  organisation_id UUID REFERENCES organisations(id),
  forecast_date DATE NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  contracted_revenue_cents INTEGER,
  held_revenue_cents INTEGER,
  pipeline_revenue_cents INTEGER,
  total_forecast_cents INTEGER,
  same_period_prior_year_cents INTEGER,
  forecast_vs_prior_year_pct DECIMAL(5,2),
  confidence_level TEXT,
  contributing_factors JSONB
);

-- ============================================================
-- VENUE HEALTH (composite score, recalculated weekly)
-- ============================================================
CREATE TABLE venue_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id),
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  health_score INTEGER,
  status TEXT,
  booking_pace_score INTEGER,
  conversion_score INTEGER,
  response_time_score INTEGER,
  review_trend_score INTEGER,
  inquiry_trend_score INTEGER,
  lost_deal_score INTEGER,
  alerts JSONB,
  recommendations JSONB
);

-- ============================================================
-- VENUE CAPACITY / YIELD
-- ============================================================
CREATE TABLE venue_capacity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id),
  month DATE NOT NULL,
  year INTEGER NOT NULL,
  total_available_dates INTEGER,
  booked_dates INTEGER,
  held_dates INTEGER,
  occupancy_pct DECIMAL(5,2),
  avg_revenue_per_event_cents INTEGER,
  potential_revenue_cents INTEGER,
  is_peak BOOLEAN,
  suggested_price_adjustment_pct DECIMAL(5,2),
  UNIQUE(venue_id, month, year)
);

-- ============================================================
-- AI USAGE LOG (cost tracking — target <$25/venue/month)
-- ============================================================
CREATE TABLE ai_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID REFERENCES venues(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  provider TEXT NOT NULL,       -- 'claude' | 'gpt4o' | 'whisper'
  task_type TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_cents INTEGER,
  latency_ms INTEGER,
  success BOOLEAN DEFAULT TRUE,
  fallback_used BOOLEAN DEFAULT FALSE
);

-- ============================================================
-- DATA ACCESS LOG (audit trail — one-click export always available)
-- ============================================================
CREATE TABLE data_access_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id),
  accessed_at TIMESTAMPTZ DEFAULT NOW(),
  user_id UUID NOT NULL,
  user_role TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID NOT NULL,
  action TEXT NOT NULL,
  ip_address TEXT
);

-- ============================================================
-- WEEKLY INSIGHTS (AI-generated Monday 6am)
-- ============================================================
CREATE TABLE weekly_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  insights JSONB NOT NULL,
  week_start DATE NOT NULL,
  UNIQUE(venue_id, week_start)
);

-- ============================================================
-- CUSTOMER HEALTH (Bloom internal — churn detection)
-- ============================================================
CREATE TABLE customer_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id),
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  logins_last_30_days INTEGER,
  features_used_last_30 TEXT[],
  inquiries_last_30 INTEGER,
  insights_generated INTEGER,
  sage_emails_sent INTEGER,
  churn_risk TEXT,
  risk_factors JSONB,
  last_outreach_at TIMESTAMPTZ,
  outreach_notes TEXT
);

-- ============================================================
-- PERFORMANCE INDEXES
-- ============================================================
CREATE INDEX idx_clients_venue_id ON clients(venue_id);
CREATE INDEX idx_clients_status ON clients(venue_id, status);
CREATE INDEX idx_clients_event_date ON clients(venue_id, event_date);
CREATE INDEX idx_clients_email ON clients(email_primary, email_partner);
CREATE INDEX idx_inquiries_venue_id ON inquiries(venue_id);
CREATE INDEX idx_inquiries_received_at ON inquiries(venue_id, received_at);
CREATE INDEX idx_inquiries_match_status ON inquiries(venue_id, match_status);
CREATE INDEX idx_tours_venue_id ON tours(venue_id);
CREATE INDEX idx_tours_client_id ON tours(client_id);
CREATE INDEX idx_tours_scheduled_at ON tours(venue_id, scheduled_at);
CREATE INDEX idx_pre_inquiry_signals_venue ON pre_inquiry_signals(venue_id);
CREATE INDEX idx_pre_inquiry_signals_platform ON pre_inquiry_signals(venue_id, platform);
CREATE INDEX idx_reviews_venue_id ON reviews(venue_id);
CREATE INDEX idx_anomaly_detections_venue ON anomaly_detections(venue_id, status);
CREATE INDEX idx_anomaly_detections_severity ON anomaly_detections(venue_id, severity, status);
CREATE INDEX idx_matching_queue_venue ON matching_queue(venue_id, status);
CREATE INDEX idx_email_threads_venue ON email_threads(venue_id);
CREATE INDEX idx_email_threads_client ON email_threads(client_id);
CREATE INDEX idx_planning_events_client ON planning_events(client_id);
CREATE INDEX idx_weather_daily_station_date ON weather_daily(station_id, date);
CREATE INDEX idx_weather_monthly_station ON weather_monthly(station_id, month);
CREATE INDEX idx_macro_search_trends_metro ON macro_search_trends(metro, week);
CREATE INDEX idx_macro_economic_series ON macro_economic(series_id, date);
CREATE INDEX idx_venue_users_user_id ON venue_users(user_id);
CREATE INDEX idx_venue_users_venue_id ON venue_users(venue_id);
CREATE INDEX idx_lost_deals_venue ON lost_deals(venue_id);
CREATE INDEX idx_channel_spend_venue ON channel_spend(venue_id, month);
CREATE INDEX idx_weekly_insights_venue ON weekly_insights(venue_id, week_start);
