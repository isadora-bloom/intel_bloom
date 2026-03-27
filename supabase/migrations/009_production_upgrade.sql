-- ================================================================
-- BLOOM PRODUCTION SCHEMA UPGRADE
-- Adds missing tables and columns to match the definitive brief
-- Run against: awawmtvynhwrahrekiso.supabase.co
-- ================================================================

-- Missing columns on CLIENTS
ALTER TABLE clients ADD COLUMN IF NOT EXISTS assigned_coordinator TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS is_seed_data BOOLEAN DEFAULT FALSE;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS inquiry_channel TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS tour_booked_at TIMESTAMPTZ;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS event_completed_at TIMESTAMPTZ;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS response_time_minutes INTEGER;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS days_from_signal_to_inquiry INTEGER;

-- Missing columns on VENUES
ALTER TABLE venues ADD COLUMN IF NOT EXISTS organisation_id UUID;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS region TEXT;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS county_fips TEXT;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS primary_color TEXT DEFAULT '#1A6B6B';
ALTER TABLE venues ADD COLUMN IF NOT EXISTS secondary_color TEXT DEFAULT '#B07080';
ALTER TABLE venues ADD COLUMN IF NOT EXISTS font_family TEXT DEFAULT 'system';
ALTER TABLE venues ADD COLUMN IF NOT EXISTS custom_domain TEXT;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS sage_tone TEXT DEFAULT 'warm_professional';
ALTER TABLE venues ADD COLUMN IF NOT EXISTS sage_greeting TEXT;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS sage_auto_reply BOOLEAN DEFAULT TRUE;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS sage_voice_description TEXT;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS vendor_fit_weights JSONB;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS packages JSONB;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS demand_premium_threshold INTEGER DEFAULT 5;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS gmail_oauth_token TEXT;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS ga4_property_id TEXT;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS google_ads_customer_id TEXT;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS instagram_business_id TEXT;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS max_events_per_month INTEGER;

-- Missing columns on INQUIRIES
ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS responded_by TEXT;

-- Missing columns on VENUE_USERS
ALTER TABLE venue_users ADD COLUMN IF NOT EXISTS organisation_id UUID;
ALTER TABLE venue_users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE venue_users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE venue_users ADD COLUMN IF NOT EXISTS invited_by UUID;

-- Missing columns on TOURS
ALTER TABLE tours ADD COLUMN IF NOT EXISTS conducted_by TEXT;
ALTER TABLE tours ADD COLUMN IF NOT EXISTS outcome TEXT;

-- Missing column on REVIEWS
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id);

-- ORGANISATIONS
CREATE TABLE IF NOT EXISTS organisations (
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

-- USER_INVITATIONS
CREATE TABLE IF NOT EXISTS user_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  organisation_id UUID,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  invited_by UUID NOT NULL,
  invited_at TIMESTAMPTZ DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days',
  token TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'pending'
);

-- USER_SESSIONS
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  venue_id UUID REFERENCES venues(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  ip_address TEXT,
  user_agent TEXT,
  device_type TEXT,
  session_duration_minutes INTEGER
);

-- ANOMALY_DETECTIONS
CREATE TABLE IF NOT EXISTS anomaly_detections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  organisation_id UUID,
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  metric TEXT NOT NULL,
  direction TEXT NOT NULL,
  magnitude_pct DECIMAL(6,2),
  period_current TEXT,
  period_baseline TEXT,
  baseline_type TEXT,
  current_value DECIMAL(12,2),
  baseline_value DECIMAL(12,2),
  ai_possible_causes JSONB,
  ai_confidence INTEGER,
  ai_recommendation TEXT,
  status TEXT DEFAULT 'new',
  severity TEXT DEFAULT 'info',
  acknowledged_by TEXT,
  acknowledged_at TIMESTAMPTZ,
  annotation_id UUID
);

-- LOST_DEALS
CREATE TABLE IF NOT EXISTS lost_deals (
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

-- CAMPAIGNS
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID REFERENCES venues(id),
  organisation_id UUID,
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

-- RESPONSE_ALERTS
CREATE TABLE IF NOT EXISTS response_alerts (
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

-- REVENUE_FORECASTS
CREATE TABLE IF NOT EXISTS revenue_forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID REFERENCES venues(id),
  organisation_id UUID,
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

-- VENUE_HEALTH
CREATE TABLE IF NOT EXISTS venue_health (
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

-- VENUE_CAPACITY
CREATE TABLE IF NOT EXISTS venue_capacity (
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

-- AI_USAGE_LOG
CREATE TABLE IF NOT EXISTS ai_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID REFERENCES venues(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  provider TEXT NOT NULL,
  task_type TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_cents INTEGER,
  latency_ms INTEGER,
  success BOOLEAN DEFAULT TRUE,
  fallback_used BOOLEAN DEFAULT FALSE
);

-- DATA_ACCESS_LOG
CREATE TABLE IF NOT EXISTS data_access_log (
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

-- WEEKLY_INSIGHTS
CREATE TABLE IF NOT EXISTS weekly_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  week_start DATE,
  insights JSONB,
  generated_by TEXT
);

-- CUSTOMER_HEALTH
CREATE TABLE IF NOT EXISTS customer_health (
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

-- CONTENT_TOUCHPOINTS
CREATE TABLE IF NOT EXISTS content_touchpoints (
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

-- EMAIL_THREADS
CREATE TABLE IF NOT EXISTS email_threads (
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

-- EMAIL_MESSAGES
CREATE TABLE IF NOT EXISTS email_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  thread_id UUID REFERENCES email_threads(id) ON DELETE CASCADE,
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

-- WEBSITE_SESSIONS
CREATE TABLE IF NOT EXISTS website_sessions (
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
  linked_inquiry_id UUID,
  linked_client_id UUID
);

-- VENDOR_AVAILABILITY
CREATE TABLE IF NOT EXISTS vendor_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  available BOOLEAN DEFAULT TRUE,
  UNIQUE(vendor_id, date)
);

-- Enable RLS on new tables
ALTER TABLE anomaly_detections ENABLE ROW LEVEL SECURITY;
ALTER TABLE lost_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE response_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_capacity ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_touchpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE website_sessions ENABLE ROW LEVEL SECURITY;
