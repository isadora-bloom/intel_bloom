-- ============================================================
-- CLIENT STAGE TRANSITION DATES
-- Records when a client moved through each funnel stage.
-- Used for stage-level seasonality and lead time analytics.
-- ============================================================

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS inquired_at   DATE,  -- when they first reached out
  ADD COLUMN IF NOT EXISTS toured_at     DATE,  -- when they toured (first tour)
  ADD COLUMN IF NOT EXISTS held_at       DATE,  -- when a hold was placed
  ADD COLUMN IF NOT EXISTS contracted_at DATE;  -- when contract was signed

-- Back-fill inquired_at from linked inquiry record where possible
-- (best-effort; nulls are fine for now)
UPDATE clients c
SET inquired_at = i.received_at::DATE
FROM inquiries i
WHERE i.venue_id = c.venue_id
  AND (
    i.name_extracted ILIKE '%' || split_part(c.name_primary, ' ', 1) || '%'
    OR i.email_extracted = c.email_primary
  )
  AND c.inquired_at IS NULL
  AND i.received_at IS NOT NULL;
