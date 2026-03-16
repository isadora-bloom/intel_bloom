-- ============================================================
-- SENSITIVE DATA CLEANUP
-- Migration: 003_sensitive_data_cleanup.sql
-- Hard-deletes family_dynamics_flags and stress_flags for events
-- older than 12 months. Runs via Supabase Edge Function monthly.
-- ============================================================

-- Function to clear sensitive flags on aged client records
CREATE OR REPLACE FUNCTION clear_aged_sensitive_flags()
RETURNS INTEGER AS $$
DECLARE
  rows_affected INTEGER;
BEGIN
  UPDATE clients
  SET
    family_dynamics_flags = NULL,
    stress_flags = NULL
  WHERE
    event_date IS NOT NULL
    AND event_date < NOW() - INTERVAL '12 months'
    AND (family_dynamics_flags IS NOT NULL OR stress_flags IS NOT NULL);

  GET DIAGNOSTICS rows_affected = ROW_COUNT;
  RETURN rows_affected;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to service role only
REVOKE ALL ON FUNCTION clear_aged_sensitive_flags() FROM PUBLIC;
