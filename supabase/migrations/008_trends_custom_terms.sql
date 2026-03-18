-- Allow venues to define up to 4 custom Google Trends search terms
-- in addition to the built-in wedding/engagement/divorce terms.
-- Stored as a text array, max 4 entries enforced in application layer.

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS trends_custom_terms TEXT[] DEFAULT '{}';

COMMENT ON COLUMN venues.trends_custom_terms IS
  'Up to 4 custom Google Trends search terms the venue owner wants to track (e.g. "outdoor wedding", "elopement").';
