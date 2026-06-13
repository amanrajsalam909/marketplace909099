-- ============================================================================
-- Complaint resolution: lets the admin record the "solution" for a complaint.
-- The note is stored here and emailed to the customer (delivery happens
-- outside the app; the admin section drives it via the feedback API).
-- Safe to run once in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE complaints ADD COLUMN IF NOT EXISTS resolution  TEXT;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
