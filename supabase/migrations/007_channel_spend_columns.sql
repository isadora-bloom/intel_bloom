-- ============================================================
-- BLOOM SPINE — MIGRATION 007: FIX CHANNEL SPEND COLUMNS
-- Rename spend_cents → amount_cents (matches UI/API code)
-- Add billing_type column referenced in settings page
-- ============================================================

ALTER TABLE channel_spend
  RENAME COLUMN spend_cents TO amount_cents;

ALTER TABLE channel_spend
  ADD COLUMN IF NOT EXISTS billing_type TEXT DEFAULT 'monthly_subscription';
