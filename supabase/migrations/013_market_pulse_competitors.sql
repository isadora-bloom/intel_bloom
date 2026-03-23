-- Market Pulse: weekly calculated market conditions per venue
create table if not exists market_pulse (
  id              uuid primary key default gen_random_uuid(),
  venue_id        uuid not null references venues(id) on delete cascade,
  calculated_at   timestamptz not null default now(),
  valid_until     timestamptz,
  demand_outlook  text,          -- 'positive' | 'neutral' | 'cautionary' | 'negative'
  demand_score    integer,       -- 0-100
  consumer_confidence_latest  numeric,
  consumer_confidence_trend   text,
  search_volume_vs_seasonal   integer,
  marriage_rate_trend         text,
  regional_economy_summary    text,
  weather_caution_months      text[],
  competitor_change_alert     text,
  engagement_seasonality_signal text,
  full_summary    jsonb,
  unique (venue_id)
);

alter table market_pulse enable row level security;
create policy "venue_member_select_market_pulse" on market_pulse
  for select using (
    venue_id in (select venue_id from venue_users where user_id = auth.uid())
  );

-- Allow service role (cron) to write
create policy "service_upsert_market_pulse" on market_pulse
  for all using (true) with check (true);


-- Competitor landscape: populated by Google Places scan during onboarding / manual refresh
create table if not exists macro_competitor_landscape (
  id                uuid primary key default gen_random_uuid(),
  venue_id          uuid not null references venues(id) on delete cascade,
  competitor_name   text not null,
  google_place_id   text,
  google_rating     numeric,
  review_count      integer,
  distance_miles    numeric,
  price_level       integer,
  scanned_at        timestamptz not null default now()
);

alter table macro_competitor_landscape enable row level security;
create policy "venue_member_select_competitors" on macro_competitor_landscape
  for select using (
    venue_id in (select venue_id from venue_users where user_id = auth.uid())
  );

create policy "service_upsert_competitors" on macro_competitor_landscape
  for all using (true) with check (true);
