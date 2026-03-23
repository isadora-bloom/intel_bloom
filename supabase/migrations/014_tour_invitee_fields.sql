-- Add invitee contact fields to tours (from Calendly sync)
ALTER TABLE tours
  ADD COLUMN IF NOT EXISTS invitee_name  TEXT,
  ADD COLUMN IF NOT EXISTS invitee_email TEXT,
  ADD COLUMN IF NOT EXISTS invitee_phone TEXT,
  ADD COLUMN IF NOT EXISTS invitee_qa    JSONB,          -- raw Q&A array from Calendly
  ADD COLUMN IF NOT EXISTS external_id   TEXT,           -- calendly event URI or HB project ID
  ADD COLUMN IF NOT EXISTS source        TEXT;           -- "calendly" | "honeybook" | "manual"

-- Add stable external ID + extra fields to clients (for HoneyBook dedup)
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS honeybook_project_id TEXT,
  ADD COLUMN IF NOT EXISTS inquiry_date         TIMESTAMPTZ;   -- when the project was created in HB

CREATE INDEX IF NOT EXISTS idx_tours_invitee_email ON tours(invitee_email);
CREATE INDEX IF NOT EXISTS idx_tours_external_id   ON tours(external_id);
CREATE INDEX IF NOT EXISTS idx_clients_hb_id       ON clients(honeybook_project_id);
