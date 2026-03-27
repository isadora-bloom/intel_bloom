-- 010_demo_support.sql
-- Adds columns and tables needed for the interactive demo sandbox

-- ============================================================
-- 1. Consultant assignment on clients & inquiries
--    Enables per-consultant analytics (Dana vs Marcus story)
-- ============================================================
ALTER TABLE clients ADD COLUMN IF NOT EXISTS assigned_to UUID;
ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS assigned_to UUID;
ALTER TABLE tours ADD COLUMN IF NOT EXISTS assigned_to UUID;

-- Index for filtering by consultant
CREATE INDEX IF NOT EXISTS idx_clients_assigned_to ON clients (assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inquiries_assigned_to ON inquiries (assigned_to) WHERE assigned_to IS NOT NULL;

-- ============================================================
-- 2. Fix weekly_insights: add generated_at (router queries it)
-- ============================================================
ALTER TABLE weekly_insights ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ DEFAULT now();

-- Backfill: copy created_at into generated_at for any existing rows
UPDATE weekly_insights SET generated_at = created_at WHERE generated_at IS NULL;

-- ============================================================
-- 3. Demo sessions — tracks who is using the demo
-- ============================================================
CREATE TABLE IF NOT EXISTS demo_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'coordinator')),
  venue_id    UUID,           -- which venue they're viewing (manager/coordinator)
  consultant_id UUID,         -- which consultant they're viewing as (coordinator)
  ip_address  TEXT,
  user_agent  TEXT,
  referrer    TEXT,            -- where they came from (utm_source, direct, etc.)
  utm_source  TEXT,
  utm_medium  TEXT,
  utm_campaign TEXT,
  -- Aggregate engagement (updated on session end / heartbeat)
  total_page_views    INT DEFAULT 0,
  total_duration_secs INT DEFAULT 0,
  last_active_at      TIMESTAMPTZ,
  converted           BOOLEAN DEFAULT false,  -- clicked "Book a Call"
  converted_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_demo_sessions_created ON demo_sessions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_demo_sessions_role ON demo_sessions (role);

-- ============================================================
-- 4. Demo events — granular tracking of every interaction
-- ============================================================
CREATE TABLE IF NOT EXISTS demo_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Event classification
  event_type  TEXT NOT NULL,  -- 'page_view', 'feature_click', 'chart_hover', 'scroll', 'cta_click', 'role_switch', 'venue_switch', 'ask_question', 'export_attempt'
  -- Context
  page_path   TEXT,           -- /dashboard, /inquiries, /analytics, etc.
  role        TEXT,           -- owner/manager/coordinator at time of event
  venue_slug  TEXT,           -- which venue they're viewing
  -- Page view specific
  duration_ms INT,            -- time spent on this page before navigating away
  scroll_depth_pct INT,       -- 0-100, how far they scrolled
  -- Feature interaction specific
  feature_name TEXT,          -- 'funnel_chart', 'source_table', 'ask_ai', 'anomaly_card', etc.
  feature_detail TEXT,        -- extra context (e.g., which chart they hovered, what question they asked)
  -- Click specific
  element_id   TEXT,          -- DOM element identifier
  element_text TEXT,          -- button/link text
  -- Metadata
  viewport_width  INT,
  viewport_height INT,
  is_mobile       BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_demo_events_session ON demo_events (session_id);
CREATE INDEX IF NOT EXISTS idx_demo_events_type ON demo_events (event_type);
CREATE INDEX IF NOT EXISTS idx_demo_events_page ON demo_events (page_path);
CREATE INDEX IF NOT EXISTS idx_demo_events_created ON demo_events (created_at DESC);

-- Composite index for common queries
CREATE INDEX IF NOT EXISTS idx_demo_events_session_page ON demo_events (session_id, page_path);

-- ============================================================
-- 5. RLS policies for demo tables (public insert, admin read)
-- ============================================================

-- Demo sessions: anyone can insert (creates session), only service role reads
ALTER TABLE demo_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_sessions_insert ON demo_sessions FOR INSERT WITH CHECK (true);
CREATE POLICY demo_sessions_select ON demo_sessions FOR SELECT USING (
  auth.role() = 'service_role'
);

-- Demo events: anyone can insert, only service role reads
ALTER TABLE demo_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_events_insert ON demo_events FOR INSERT WITH CHECK (true);
CREATE POLICY demo_events_select ON demo_events FOR SELECT USING (
  auth.role() = 'service_role'
);

-- ============================================================
-- 6. Convenience view for demo analytics
-- ============================================================
CREATE OR REPLACE VIEW demo_analytics_summary AS
SELECT
  ds.id AS session_id,
  ds.created_at,
  ds.role,
  ds.referrer,
  ds.utm_source,
  ds.utm_medium,
  ds.utm_campaign,
  ds.converted,
  ds.total_page_views,
  ds.total_duration_secs,
  -- Page engagement breakdown
  (SELECT json_agg(json_build_object(
    'page', de.page_path,
    'views', cnt,
    'avg_duration_ms', avg_dur,
    'avg_scroll_pct', avg_scroll
  ))
  FROM (
    SELECT page_path, COUNT(*) as cnt,
           AVG(duration_ms) as avg_dur,
           AVG(scroll_depth_pct) as avg_scroll
    FROM demo_events
    WHERE demo_events.session_id = ds.id
      AND event_type = 'page_view'
    GROUP BY page_path
  ) de) AS page_breakdown,
  -- Feature clicks
  (SELECT json_agg(json_build_object('feature', feature_name, 'count', cnt))
  FROM (
    SELECT feature_name, COUNT(*) as cnt
    FROM demo_events
    WHERE demo_events.session_id = ds.id
      AND event_type = 'feature_click'
    GROUP BY feature_name
  ) fc) AS feature_clicks
FROM demo_sessions ds;

-- ============================================================
-- 7. RPC function to atomically increment demo session counters
-- ============================================================
CREATE OR REPLACE FUNCTION increment_demo_session_stats(
  p_session_id UUID,
  p_page_views INT DEFAULT 0,
  p_duration_secs INT DEFAULT 0
) RETURNS void AS $$
BEGIN
  UPDATE demo_sessions
  SET total_page_views = total_page_views + p_page_views,
      total_duration_secs = total_duration_secs + p_duration_secs,
      last_active_at = now()
  WHERE id = p_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
