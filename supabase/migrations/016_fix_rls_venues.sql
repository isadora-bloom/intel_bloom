-- Fix venues + venue_users RLS policies.
--
-- Problem: the catch-all FOR ALL policy on venues uses USING (id = venue_id_for_user()).
-- venue_id_for_user() returns NULL when the user has no venue_users row yet,
-- which means new venues can't be created (INSERT blocked) and the SQL editor
-- (no auth context) can't update venue settings.
--
-- Fix: split into per-operation policies.
--   SELECT/UPDATE/DELETE: must own the venue (existing behaviour)
--   INSERT: any authenticated user can create a venue (needed for signup)
--
-- Same split applied to venue_users so new members can self-enrol.

-- ── VENUES ────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "venue_isolation" ON venues;

CREATE POLICY "venues_select" ON venues
  FOR SELECT
  USING (id = public.venue_id_for_user());

CREATE POLICY "venues_update" ON venues
  FOR UPDATE
  USING (id = public.venue_id_for_user())
  WITH CHECK (id = public.venue_id_for_user());

CREATE POLICY "venues_delete" ON venues
  FOR DELETE
  USING (id = public.venue_id_for_user());

-- Any authenticated user can create a venue (signup flow)
CREATE POLICY "venues_insert" ON venues
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- ── VENUE USERS ───────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "venue_isolation" ON venue_users;

CREATE POLICY "venue_users_select" ON venue_users
  FOR SELECT
  USING (user_id = auth.uid());

-- Users can add themselves to a venue (signup) or owners can add members
CREATE POLICY "venue_users_insert" ON venue_users
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    OR venue_id = public.venue_id_for_user()
  );

CREATE POLICY "venue_users_update" ON venue_users
  FOR UPDATE
  USING (venue_id = public.venue_id_for_user());

CREATE POLICY "venue_users_delete" ON venue_users
  FOR DELETE
  USING (venue_id = public.venue_id_for_user());
