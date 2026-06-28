-- ============================================================================
-- Two-way complaint thread: a complaint is now a synced conversation between
-- the customer and the admin, not a one-shot subject + single resolution.
-- messages is an ordered JSONB array of { from: 'customer'|'admin', text, at }.
-- The opening complaint (subject/description) and the final resolution stay in
-- their own columns; messages holds everything exchanged in between, shown on
-- both the customer account page and the admin panel until the complaint is
-- Resolved.
-- Safe to run / re-run in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE complaints ADD COLUMN IF NOT EXISTS messages JSONB NOT NULL DEFAULT '[]'::jsonb;
