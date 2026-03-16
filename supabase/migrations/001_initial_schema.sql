-- ============================================================
-- BLOOM INTELLIGENCE LAYER — Initial Schema
-- Migration: 001_initial_schema.sql
-- ============================================================

-- ============================================================
-- VENUES
-- ============================================================
CREATE TABLE venues (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  name                TEXT NOT NULL,
  slug                TEXT UNIQUE NOT NULL,
  address_line1       TEXT,
  address_line2       TEXT,
  city                TEXT NOT NULL,
  state               TEXT NOT NULL,
  zip                 TEXT NOT NULL,
  lat                 DECIMAL(9,6),
  lng                 DECIMAL(9,6),
  noaa_station_id     TEXT,
  noaa_station_name   TEXT,
  fed_district        INTEGER,
  google_trends_metro TEXT,
  competitor_radius_miles INTEGER DEFAULT 30,
  plan                TEXT DEFAULT 'founder',
  monthly_price_cents INTEGER DEFAULT 25000,
  honeybook_api_key   TEXT,
  knot_venue_id       TEXT,
  google_place_id     TEXT,
  timezone            TEXT DEFAULT 'America/New_York',
  onboarding_complete BOOLEAN DEFAULT FALSE,
  contributes_to_benchmark BOOLEAN DEFAULT TRUE
);

-- ============================================================
-- VENUE USERS
-- ============================================================
CREATE TABLE venue_users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT DEFAULT 'member',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(venue_id, user_id)
);

-- ============================================================
-- CLIENTS
-- ============================================================
CREATE TABLE clients (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id              UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  -- Identity
  name_primary          TEXT NOT NULL,
  name_partner          TEXT,
  email_primary         TEXT,
  email_partner         TEXT,
  phone_primary         TEXT,
  phone_partner         TEXT,
  -- Event
  event_date            DATE,
  event_date_confirmed  BOOLEAN DEFAULT FALSE,
  event_year            INTEGER GENERATED ALWAYS AS (EXTRACT(YEAR FROM event_date)::INTEGER) STORED,
  event_month           INTEGER GENERATED ALWAYS AS (EXTRACT(MONTH FROM event_date)::INTEGER) STORED,
  event_day_of_week     INTEGER GENERATED ALWAYS AS (EXTRACT(DOW FROM event_date)::INTEGER) STORED,
  package               TEXT,
  guest_count_initial   INTEGER,
  guest_count_final     INTEGER,
  revenue_cents         INTEGER,
  -- Status
  status                TEXT DEFAULT 'inquiry',
  -- Matching
  confidence_score      INTEGER DEFAULT 100,
  -- Source
  first_touch_platform          TEXT,
  first_touch_date              TIMESTAMPTZ,
  self_reported_source          TEXT,
  resolved_source               TEXT,
  resolved_source_confidence    INTEGER,
  acquisition_cost_cents        INTEGER,
  referrer_client_id            UUID REFERENCES clients(id),
  referrer_name                 TEXT,
  competing_venues              TEXT[],
  -- Pre-inquiry session
  session_pages_visited TEXT[],
  session_count         INTEGER,
  session_source_url    TEXT,
  session_data          JSONB,
  -- Planning scores
  complexity_score      INTEGER,
  stress_flags          JSONB,
  family_dynamics_flags JSONB,
  -- Event layer
  weather_event_date    JSONB,
  weather_difficulty_score INTEGER,
  staffing_hours_actual INTEGER,
  day_of_complexity     INTEGER,
  -- Reputation
  review_left           BOOLEAN,
  review_platform       TEXT,
  review_star_rating    DECIMAL(2,1),
  review_date           TIMESTAMPTZ,
  review_text           TEXT,
  review_sentiment      TEXT,
  review_adjusted_score DECIMAL(3,1),
  social_reach          JSONB,
  referrals_generated   INTEGER DEFAULT 0
);

-- ============================================================
-- CLIENT SOURCE TOUCHPOINTS
-- ============================================================
CREATE TABLE client_source_touchpoints (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  venue_id        UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  platform        TEXT NOT NULL,
  touchpoint_date TIMESTAMPTZ,
  campaign_id     TEXT,
  campaign_name   TEXT,
  cost_cents      INTEGER,
  raw_data        JSONB
);

-- ============================================================
-- INQUIRIES
-- ============================================================
CREATE TABLE inquiries (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id              UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  platform              TEXT NOT NULL,
  external_id           TEXT,
  raw_message           TEXT,
  name_extracted        TEXT,
  email_extracted       TEXT,
  phone_extracted       TEXT,
  event_date_extracted  DATE,
  budget_extracted      INTEGER,
  guest_count_extracted INTEGER,
  received_at           TIMESTAMPTZ,
  day_of_week           INTEGER,
  hour_of_day           INTEGER,
  campaign_id           TEXT,
  session_data          JSONB,
  self_reported_source  TEXT,
  session_source_url    TEXT,
  resolved_source       TEXT,
  resolved_source_confidence INTEGER,
  matched_client_id     UUID REFERENCES clients(id),
  match_confidence      INTEGER,
  match_status          TEXT DEFAULT 'unmatched',
  response_sent_at      TIMESTAMPTZ,
  response_time_minutes INTEGER
);

-- ============================================================
-- TOURS
-- ============================================================
CREATE TABLE tours (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id              UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  client_id             UUID REFERENCES clients(id),
  scheduled_at          TIMESTAMPTZ,
  tour_type             TEXT,
  completed             BOOLEAN DEFAULT FALSE,
  cancelled             BOOLEAN DEFAULT FALSE,
  cancel_reason         TEXT,
  self_reported_source  TEXT,
  competing_venues      TEXT[],
  upload_id             UUID,
  notes_raw             TEXT,
  booking_date          DATE,
  booking_conversion_days INTEGER
);

-- ============================================================
-- UPLOADS
-- ============================================================
CREATE TABLE uploads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  client_id       UUID REFERENCES clients(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  file_name       TEXT,
  file_type       TEXT,
  file_size_bytes INTEGER,
  storage_path    TEXT,
  status          TEXT DEFAULT 'pending',
  transcript      TEXT,
  extracted_signals JSONB,
  confirmed_signals JSONB,
  upload_type     TEXT,
  upload_date     TIMESTAMPTZ
);

-- ============================================================
-- PLANNING EVENTS
-- ============================================================
CREATE TABLE planning_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  event_type      TEXT NOT NULL,
  event_date      TIMESTAMPTZ,
  metadata        JSONB,
  source          TEXT
);

-- ============================================================
-- VENDORS
-- ============================================================
CREATE TABLE vendors (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id              UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  name                  TEXT NOT NULL,
  category              TEXT,
  email                 TEXT,
  website               TEXT,
  appearances_count     INTEGER DEFAULT 0,
  avg_review_score      DECIMAL(3,1),
  avg_complexity_score  INTEGER,
  referrals_sent_12m    INTEGER DEFAULT 0,
  referral_revenue_cents_12m INTEGER DEFAULT 0,
  referral_conversion_rate DECIMAL(4,2),
  last_scorecard_at     TIMESTAMPTZ
);

-- ============================================================
-- CLIENT VENDORS
-- ============================================================
CREATE TABLE client_vendors (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  vendor_id   UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  UNIQUE(client_id, vendor_id)
);

-- ============================================================
-- ANNOTATIONS
-- ============================================================
CREATE TABLE annotations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  created_by      UUID REFERENCES auth.users(id),
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  annotation_type TEXT NOT NULL,
  category_detail TEXT,
  notes           TEXT,
  source          TEXT DEFAULT 'human_proactive',
  detected_signal TEXT,
  detected_value  DECIMAL(10,2),
  detected_threshold DECIMAL(10,2),
  exclude_from_patterns BOOLEAN DEFAULT FALSE,
  exclude_reason  TEXT,
  propagate_to_aggregate BOOLEAN DEFAULT TRUE
);

-- ============================================================
-- WEATHER DATA
-- ============================================================
CREATE TABLE weather_monthly (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  noaa_station_id TEXT NOT NULL,
  year            INTEGER NOT NULL,
  month           INTEGER NOT NULL,
  precipitation_inches DECIMAL(6,2),
  temp_avg_f      DECIMAL(5,1),
  temp_max_f      DECIMAL(5,1),
  temp_min_f      DECIMAL(5,1),
  days_precipitation INTEGER,
  weather_score   INTEGER,
  UNIQUE(noaa_station_id, year, month)
);

CREATE TABLE weather_daily (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  noaa_station_id TEXT NOT NULL,
  date            DATE NOT NULL,
  precipitation_inches DECIMAL(6,2),
  temp_max_f      DECIMAL(5,1),
  temp_min_f      DECIMAL(5,1),
  conditions      TEXT,
  difficulty_score INTEGER,
  UNIQUE(noaa_station_id, date)
);

CREATE TABLE weather_forecasts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        UUID NOT NULL REFERENCES venues(id),
  client_id       UUID REFERENCES clients(id),
  forecast_date   DATE NOT NULL,
  pulled_at       TIMESTAMPTZ NOT NULL,
  precip_probability INTEGER,
  temp_high_f     INTEGER,
  temp_low_f      INTEGER,
  conditions      TEXT,
  alert_triggered BOOLEAN DEFAULT FALSE
);

-- ============================================================
-- MACRO SIGNALS
-- ============================================================
CREATE TABLE macro_economic (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_type     TEXT NOT NULL,
  period_date     DATE NOT NULL,
  value           DECIMAL(10,4),
  geo_scope       TEXT NOT NULL,
  raw_data        JSONB,
  UNIQUE(signal_type, period_date, geo_scope)
);

CREATE TABLE macro_demographic (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fips_code       TEXT NOT NULL,
  year            INTEGER NOT NULL,
  marriage_rate   DECIMAL(6,2),
  marriage_count  INTEGER,
  population      INTEGER,
  median_age      DECIMAL(4,1),
  median_income   INTEGER,
  population_growth_pct DECIMAL(5,2),
  UNIQUE(fips_code, year)
);

CREATE TABLE macro_search_trends (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  geo             TEXT NOT NULL,
  week_start      DATE NOT NULL,
  term            TEXT NOT NULL,
  relative_interest INTEGER,
  UNIQUE(geo, week_start, term)
);

CREATE TABLE macro_competitor_landscape (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        UUID NOT NULL REFERENCES venues(id),
  scanned_at      TIMESTAMPTZ NOT NULL,
  competitor_name TEXT NOT NULL,
  competitor_place_id TEXT,
  distance_miles  DECIMAL(5,1),
  google_rating   DECIMAL(2,1),
  review_count    INTEGER,
  raw_data        JSONB
);

-- ============================================================
-- MATCHING QUEUE
-- ============================================================
CREATE TABLE matching_queue (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id          UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  record_a_type     TEXT,
  record_a_id       UUID,
  record_b_type     TEXT,
  record_b_id       UUID,
  match_score       INTEGER NOT NULL,
  signals_matched   JSONB,
  signals_unmatched JSONB,
  status            TEXT DEFAULT 'pending',
  reviewed_by       UUID REFERENCES auth.users(id),
  reviewed_at       TIMESTAMPTZ,
  training_logged   BOOLEAN DEFAULT FALSE
);

-- ============================================================
-- PATTERN BENCHMARKS
-- ============================================================
CREATE TABLE pattern_benchmarks (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id            UUID REFERENCES venues(id),
  calculated_at       TIMESTAMPTZ DEFAULT NOW(),
  benchmark_type      TEXT NOT NULL,
  segment_venue_type  TEXT,
  segment_region      TEXT,
  segment_price_tier  TEXT,
  p25                 DECIMAL(10,2),
  p50                 DECIMAL(10,2),
  p75                 DECIMAL(10,2),
  mean                DECIMAL(10,2),
  sample_size         INTEGER,
  confidence_level    TEXT
);

-- ============================================================
-- MARKET PULSE CACHE
-- ============================================================
CREATE TABLE market_pulse (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        UUID NOT NULL REFERENCES venues(id),
  calculated_at   TIMESTAMPTZ DEFAULT NOW(),
  valid_until     TIMESTAMPTZ,
  demand_outlook  TEXT,
  demand_score    INTEGER,
  consumer_confidence_latest DECIMAL(10,4),
  consumer_confidence_trend  TEXT,
  search_volume_vs_seasonal  INTEGER,
  engagement_seasonality_signal TEXT,
  marriage_rate_trend        TEXT,
  regional_economy_summary   TEXT,
  weather_caution_months     TEXT[],
  competitor_change_alert    TEXT,
  full_summary    JSONB
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_clients_venue_id ON clients(venue_id);
CREATE INDEX idx_clients_event_date ON clients(event_date);
CREATE INDEX idx_clients_status ON clients(status);
CREATE INDEX idx_clients_resolved_source ON clients(resolved_source);
CREATE INDEX idx_inquiries_venue_id ON inquiries(venue_id);
CREATE INDEX idx_inquiries_match_status ON inquiries(match_status);
CREATE INDEX idx_inquiries_received_at ON inquiries(received_at);
CREATE INDEX idx_planning_events_client_id ON planning_events(client_id);
CREATE INDEX idx_planning_events_venue_id ON planning_events(venue_id);
CREATE INDEX idx_weather_monthly_station ON weather_monthly(noaa_station_id, year, month);
CREATE INDEX idx_weather_daily_station_date ON weather_daily(noaa_station_id, date);
CREATE INDEX idx_macro_economic_type_date ON macro_economic(signal_type, period_date);
CREATE INDEX idx_macro_search_trends_geo_week ON macro_search_trends(geo, week_start);
CREATE INDEX idx_matching_queue_venue_status ON matching_queue(venue_id, status);

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
