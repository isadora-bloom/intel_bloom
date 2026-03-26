-- ============================================================
-- BLOOM SPINE — MIGRATION 003: FUNCTIONS & SCHEDULED JOBS
-- ============================================================

-- ============================================================
-- SENSITIVE DATA CLEANUP (monthly — hard delete after 12 months)
-- spec rule 6: stress_flags + family_dynamics_flags
-- ============================================================
CREATE OR REPLACE FUNCTION clear_aged_sensitive_flags()
RETURNS INTEGER AS $$
DECLARE
  rows_updated INTEGER;
BEGIN
  UPDATE clients
  SET
    stress_flags = NULL,
    family_dynamics_flags = NULL
  WHERE
    (stress_flags IS NOT NULL OR family_dynamics_flags IS NOT NULL)
    AND created_at < NOW() - INTERVAL '12 months';

  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RETURN rows_updated;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- SEED DATA CLEANUP (one-click delete from settings)
-- spec rule 28: is_seed_data=true, one-click delete
-- ============================================================
CREATE OR REPLACE FUNCTION delete_seed_data(p_venue_id UUID)
RETURNS INTEGER AS $$
DECLARE
  rows_deleted INTEGER := 0;
  temp_count INTEGER;
BEGIN
  -- Delete in FK-safe order
  DELETE FROM planning_events WHERE venue_id = p_venue_id
    AND client_id IN (SELECT id FROM clients WHERE venue_id = p_venue_id AND is_seed_data = TRUE);

  DELETE FROM client_source_touchpoints WHERE venue_id = p_venue_id
    AND client_id IN (SELECT id FROM clients WHERE venue_id = p_venue_id AND is_seed_data = TRUE);

  DELETE FROM tours WHERE venue_id = p_venue_id
    AND client_id IN (SELECT id FROM clients WHERE venue_id = p_venue_id AND is_seed_data = TRUE);

  DELETE FROM referrals WHERE venue_id = p_venue_id
    AND referring_client_id IN (SELECT id FROM clients WHERE venue_id = p_venue_id AND is_seed_data = TRUE);

  DELETE FROM lost_deals WHERE venue_id = p_venue_id
    AND client_id IN (SELECT id FROM clients WHERE venue_id = p_venue_id AND is_seed_data = TRUE);

  DELETE FROM inquiries WHERE venue_id = p_venue_id
    AND matched_client_id IN (SELECT id FROM clients WHERE venue_id = p_venue_id AND is_seed_data = TRUE);

  DELETE FROM clients WHERE venue_id = p_venue_id AND is_seed_data = TRUE;
  GET DIAGNOSTICS rows_deleted = ROW_COUNT;

  -- Also clear seed pre-inquiry signals and inquiries
  DELETE FROM pre_inquiry_signals WHERE venue_id = p_venue_id
    AND import_source = 'seed';
  GET DIAGNOSTICS temp_count = ROW_COUNT;
  rows_deleted := rows_deleted + temp_count;

  RETURN rows_deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- VENUE HEALTH SCORE CALCULATOR
-- Called weekly by cron job
-- ============================================================
CREATE OR REPLACE FUNCTION calculate_venue_health(p_venue_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_health_score INTEGER;
  v_booking_pace_score INTEGER := 50;
  v_conversion_score INTEGER := 50;
  v_response_time_score INTEGER := 50;
  v_review_trend_score INTEGER := 50;
  v_inquiry_trend_score INTEGER := 50;
  v_lost_deal_score INTEGER := 50;
  v_status TEXT;
  v_alerts JSONB := '[]'::JSONB;
  v_recommendations JSONB := '[]'::JSONB;

  -- Inquiry trend (30d vs prior 30d)
  v_inquiries_current INTEGER;
  v_inquiries_prior INTEGER;

  -- Conversion rate
  v_tours INTEGER;
  v_bookings INTEGER;
  v_conversion_rate DECIMAL;

  -- Response time (avg minutes from inquiry to first response)
  v_avg_response_minutes DECIMAL;

  -- Reviews
  v_avg_rating DECIMAL;
  v_review_count_90d INTEGER;
BEGIN
  -- Inquiry trend score
  SELECT COUNT(*) INTO v_inquiries_current
  FROM clients
  WHERE venue_id = p_venue_id
    AND inquired_at >= NOW() - INTERVAL '30 days';

  SELECT COUNT(*) INTO v_inquiries_prior
  FROM clients
  WHERE venue_id = p_venue_id
    AND inquired_at >= NOW() - INTERVAL '60 days'
    AND inquired_at < NOW() - INTERVAL '30 days';

  IF v_inquiries_prior > 0 THEN
    DECLARE
      pct_change DECIMAL;
    BEGIN
      pct_change := ((v_inquiries_current - v_inquiries_prior)::DECIMAL / v_inquiries_prior) * 100;
      IF pct_change > 20 THEN v_inquiry_trend_score := 90;
      ELSIF pct_change > 0 THEN v_inquiry_trend_score := 70;
      ELSIF pct_change > -20 THEN v_inquiry_trend_score := 50;
      ELSE v_inquiry_trend_score := 20;
      END IF;
    END;
  END IF;

  -- Tour-to-booking conversion
  SELECT COUNT(*) INTO v_tours
  FROM tours
  WHERE venue_id = p_venue_id
    AND scheduled_at >= NOW() - INTERVAL '180 days'
    AND completed = TRUE;

  SELECT COUNT(*) INTO v_bookings
  FROM clients
  WHERE venue_id = p_venue_id
    AND contracted_at >= NOW() - INTERVAL '180 days';

  IF v_tours > 0 THEN
    v_conversion_rate := v_bookings::DECIMAL / v_tours;
    IF v_conversion_rate > 0.5 THEN v_conversion_score := 95;
    ELSIF v_conversion_rate > 0.35 THEN v_conversion_score := 75;
    ELSIF v_conversion_rate > 0.2 THEN v_conversion_score := 55;
    ELSE v_conversion_score := 25;
    END IF;
  END IF;

  -- Response time score
  SELECT AVG(response_time_minutes) INTO v_avg_response_minutes
  FROM clients
  WHERE venue_id = p_venue_id
    AND response_time_minutes IS NOT NULL
    AND inquired_at >= NOW() - INTERVAL '30 days';

  IF v_avg_response_minutes IS NOT NULL THEN
    IF v_avg_response_minutes <= 5 THEN v_response_time_score := 100;
    ELSIF v_avg_response_minutes <= 60 THEN v_response_time_score := 85;
    ELSIF v_avg_response_minutes <= 360 THEN v_response_time_score := 60;
    ELSIF v_avg_response_minutes <= 1440 THEN v_response_time_score := 35;
    ELSE
      v_response_time_score := 10;
      v_alerts := v_alerts || '{"type": "slow_response", "message": "Average response time over 24 hours"}'::JSONB;
    END IF;
  END IF;

  -- Review trend
  SELECT AVG(rating), COUNT(*) INTO v_avg_rating, v_review_count_90d
  FROM reviews
  WHERE venue_id = p_venue_id
    AND review_date >= NOW() - INTERVAL '90 days';

  IF v_review_count_90d > 0 THEN
    IF v_avg_rating >= 4.8 THEN v_review_trend_score := 100;
    ELSIF v_avg_rating >= 4.5 THEN v_review_trend_score := 80;
    ELSIF v_avg_rating >= 4.0 THEN v_review_trend_score := 60;
    ELSE v_review_trend_score := 30;
    END IF;
  END IF;

  -- Composite score (weighted)
  v_health_score := (
    v_inquiry_trend_score * 0.2 +
    v_conversion_score * 0.25 +
    v_response_time_score * 0.2 +
    v_review_trend_score * 0.2 +
    v_lost_deal_score * 0.15
  )::INTEGER;

  -- Status label
  IF v_health_score >= 80 THEN v_status := 'healthy';
  ELSIF v_health_score >= 60 THEN v_status := 'good';
  ELSIF v_health_score >= 40 THEN v_status := 'attention';
  ELSE v_status := 'critical';
  END IF;

  -- Upsert venue_health
  INSERT INTO venue_health (
    venue_id, calculated_at, health_score, status,
    booking_pace_score, conversion_score, response_time_score,
    review_trend_score, inquiry_trend_score, lost_deal_score,
    alerts, recommendations
  ) VALUES (
    p_venue_id, NOW(), v_health_score, v_status,
    v_booking_pace_score, v_conversion_score, v_response_time_score,
    v_review_trend_score, v_inquiry_trend_score, v_lost_deal_score,
    v_alerts, v_recommendations
  );

  RETURN v_health_score;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- AUTO PLANNING EVENT on client status change
-- ============================================================
CREATE OR REPLACE FUNCTION log_client_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO planning_events (venue_id, client_id, event_type, event_date, metadata, source)
    VALUES (
      NEW.venue_id,
      NEW.id,
      'status_change',
      NOW(),
      jsonb_build_object('from', OLD.status, 'to', NEW.status),
      'system'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clients_status_change_log
  AFTER UPDATE OF status ON clients
  FOR EACH ROW EXECUTE FUNCTION log_client_status_change();

-- ============================================================
-- AUTO-SET timestamp fields on status transitions
-- ============================================================
CREATE OR REPLACE FUNCTION set_client_stage_timestamps()
RETURNS TRIGGER AS $$
BEGIN
  -- Set stage timestamps on first transition (never overwrite)
  IF NEW.status = 'inquiry' AND OLD.status IS DISTINCT FROM 'inquiry' AND NEW.inquired_at IS NULL THEN
    NEW.inquired_at := NOW();
  END IF;
  IF NEW.status = 'tour_booked' AND OLD.status IS DISTINCT FROM 'tour_booked' AND NEW.tour_booked_at IS NULL THEN
    NEW.tour_booked_at := NOW();
  END IF;
  IF NEW.status = 'toured' AND OLD.status IS DISTINCT FROM 'toured' AND NEW.toured_at IS NULL THEN
    NEW.toured_at := NOW();
  END IF;
  IF NEW.status = 'held' AND OLD.status IS DISTINCT FROM 'held' AND NEW.held_at IS NULL THEN
    NEW.held_at := NOW();
  END IF;
  IF NEW.status IN ('contracted', 'booked') AND NEW.contracted_at IS NULL THEN
    NEW.contracted_at := NOW();
  END IF;
  IF NEW.status = 'event_complete' AND NEW.event_completed_at IS NULL THEN
    NEW.event_completed_at := NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clients_stage_timestamps
  BEFORE UPDATE OF status ON clients
  FOR EACH ROW EXECUTE FUNCTION set_client_stage_timestamps();

-- ============================================================
-- SEED: Rixey venue + org record
-- These are the canonical production IDs — do not change
-- ============================================================
INSERT INTO organisations (id, name, slug, billing_email, plan)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'Rixey Manor',
  'rixey-manor',
  'isadora@rixeymanor.com',
  'venue'
) ON CONFLICT (slug) DO NOTHING;

INSERT INTO venues (
  id, organisation_id, name, slug,
  city, state, zip,
  lat, lng,
  noaa_station_id, noaa_station_name,
  county_fips, fed_district, google_trends_metro,
  primary_color, secondary_color,
  sage_tone, sage_auto_reply,
  timezone, onboarding_complete
) VALUES (
  'b0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'Rixey Manor',
  'rixey-manor',
  'Rapidan', 'VA', '22733',
  38.4, -78.0,
  'USC00448147', 'RAPIDAN, VA US',
  '51079', 5, 'Washington DC',
  '#1A6B6B', '#B07080',
  'warm_professional', TRUE,
  'America/New_York', FALSE
) ON CONFLICT (slug) DO NOTHING;
