-- ============================================================
-- 019: SOCIAL POSTS & API CONNECTIONS
--
-- Two things:
--   1. social_posts         — Instagram, Facebook, Pinterest, TikTok, YouTube
--                             posts tracked against engagement metrics, with
--                             correlation hooks to inquiry spikes.
--   2. social_api_connections — Platform OAuth tokens (hint only — real token
--                             lives in env/vault).
--
-- Core principle: saves and website_clicks are the highest-intent
-- signals for a wedding venue. Reach matters, but a post that
-- drives someone to the website is worth 10x one that got liked.
-- ============================================================


-- ============================================================
-- SOCIAL POSTS
-- One row per post. Metrics are updated on each import/sync.
-- The correlation logic lives in the tRPC router, not here —
-- we keep the table simple and let the query layer do the math.
-- ============================================================

CREATE TABLE social_posts (
  id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id                  UUID          NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  created_at                TIMESTAMPTZ   DEFAULT NOW(),
  updated_at                TIMESTAMPTZ   DEFAULT NOW(),

  -- Which platform
  platform                  TEXT          NOT NULL,
    -- 'instagram', 'facebook', 'pinterest', 'tiktok', 'youtube'

  -- When the post actually went live — used for inquiry correlation
  posted_at                 TIMESTAMPTZ   NOT NULL,

  -- Format of the post
  post_type                 TEXT          NOT NULL DEFAULT 'other',
    -- 'reel', 'static', 'story', 'carousel', 'video', 'pin', 'board', 'other'

  -- Content
  caption                   TEXT,
  post_url                  TEXT,

  -- Reels often go viral differently — quick-filter flag
  is_reel                   BOOLEAN       NOT NULL DEFAULT false,

  -- ── Core engagement metrics ──────────────────────────────
  reach                     INTEGER,      -- Unique accounts who saw it
  impressions               INTEGER,      -- Total views including repeats
  saves                     INTEGER,      -- Saves / pins — high-intent signal for venues
  shares                    INTEGER,
  comments                  INTEGER,
  likes                     INTEGER,
  website_clicks            INTEGER,      -- Clicks to venue website FROM this post — most important
  profile_visits_from_post  INTEGER,

  -- Calculated: (likes + saves + comments + shares) / reach * 100
  -- Stored so we can sort/filter without recalculating every time
  engagement_rate           NUMERIC(5,2),

  -- Viral flag — manually set or auto-flagged when reach > 10x baseline
  -- The tRPC router uses 5 000 as the auto-threshold for small venues;
  -- the venue team can override manually
  is_viral                  BOOLEAN       NOT NULL DEFAULT false,

  -- ── Import provenance ────────────────────────────────────
  import_source             TEXT          NOT NULL DEFAULT 'manual',
    -- 'manual', 'instagram_api', 'facebook_api', 'pinterest_api', 'csv'

  -- Full payload from the API — preserves fields we don't have columns for yet
  raw_metrics               JSONB,

  -- Free-text notes from the venue team
  notes                     TEXT,

  -- Prevent exact duplicate posts coming in from repeated imports
  UNIQUE (venue_id, platform, posted_at, post_type)
);

-- Primary access patterns
CREATE INDEX idx_social_posts_venue_id    ON social_posts(venue_id);
CREATE INDEX idx_social_posts_platform   ON social_posts(platform);
CREATE INDEX idx_social_posts_posted_at  ON social_posts(posted_at DESC);

-- Correlation queries filter by date window around posted_at
CREATE INDEX idx_social_posts_venue_posted ON social_posts(venue_id, posted_at DESC);

-- Quickly surface high-performing content
CREATE INDEX idx_social_posts_viral       ON social_posts(venue_id, is_viral)
  WHERE is_viral = true;
CREATE INDEX idx_social_posts_website_clicks ON social_posts(venue_id, website_clicks DESC NULLS LAST);
CREATE INDEX idx_social_posts_saves       ON social_posts(venue_id, saves DESC NULLS LAST);

-- Supports "which platform drives the most inquiries" grouping queries
CREATE INDEX idx_social_posts_platform_type ON social_posts(venue_id, platform, post_type);

ALTER TABLE social_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue members can manage social_posts"
  ON social_posts FOR ALL
  USING (venue_id IN (SELECT venue_id FROM venue_users WHERE user_id = auth.uid()));

CREATE TRIGGER update_social_posts_updated_at
  BEFORE UPDATE ON social_posts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- SOCIAL API CONNECTIONS
-- One row per venue × platform. Stores just enough metadata
-- to know when we last synced and whether the token is healthy.
-- The actual OAuth access token NEVER lives in this table —
-- only a 4-character hint so the venue can identify which
-- account is connected. Real tokens go in environment variables
-- or a secrets vault (e.g. Supabase Vault / Railway secrets).
-- ============================================================

CREATE TABLE social_api_connections (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        UUID          NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ   DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   DEFAULT NOW(),

  platform        TEXT          NOT NULL,
    -- 'instagram', 'facebook', 'pinterest', 'tiktok', 'youtube'

  -- Hint only — last 4 chars of the access token so the venue can
  -- confirm which account is linked without exposing the token.
  -- Never store the real token here.
  token_hint      TEXT,         -- e.g. 'a7f2'
  access_token    TEXT,         -- DEPRECATED / intentionally unused — here as placeholder
                                -- in case a future migration moves to Supabase Vault references

  -- Permissions granted during OAuth
  scopes          TEXT[],       -- e.g. ['instagram_basic', 'pages_read_engagement']

  -- Lifecycle
  connected_at    TIMESTAMPTZ,
  last_synced_at  TIMESTAMPTZ,
  is_active       BOOLEAN       NOT NULL DEFAULT true,

  -- Last sync error message — cleared on successful sync
  error_message   TEXT,

  -- One active connection per venue × platform
  UNIQUE (venue_id, platform)
);

CREATE INDEX idx_social_api_connections_venue_id  ON social_api_connections(venue_id);
CREATE INDEX idx_social_api_connections_platform  ON social_api_connections(platform);
CREATE INDEX idx_social_api_connections_active    ON social_api_connections(venue_id, is_active)
  WHERE is_active = true;

ALTER TABLE social_api_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue members can manage social_api_connections"
  ON social_api_connections FOR ALL
  USING (venue_id IN (SELECT venue_id FROM venue_users WHERE user_id = auth.uid()));

CREATE TRIGGER update_social_api_connections_updated_at
  BEFORE UPDATE ON social_api_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
