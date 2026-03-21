-- ============================================================
-- HOLD EXPIRY + LOST DEAL REASONS
-- Adds operational urgency tracking and loss analysis to clients
-- ============================================================

-- When a couple is on hold (deciding), record when the hold expires.
-- NULL = not on hold or hold is informal/open-ended.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS hold_expires_at TIMESTAMPTZ;

-- Why an archived client didn't convert.
-- Values: too_expensive | date_taken | chose_competitor | no_response |
--         not_right_fit | budget_cut | postponed | unknown | other
ALTER TABLE clients ADD COLUMN IF NOT EXISTS lost_reason TEXT;

-- Free-text detail on the lost reason (optional)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS lost_reason_note TEXT;

-- Index for hold expiry queries (alert dashboard uses this heavily)
CREATE INDEX IF NOT EXISTS idx_clients_hold_expires_at
  ON clients (venue_id, hold_expires_at)
  WHERE hold_expires_at IS NOT NULL;
