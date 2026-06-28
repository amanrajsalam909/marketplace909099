-- ============================================================================
-- Item-level complaints: a complaint can now point at ONE item in the order
-- (the product the customer didn't receive / has an issue with), instead of
-- only the whole order. NULL product_id = the complaint is about the whole
-- order (old behaviour, still allowed).
-- Safe to run once in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE complaints ADD COLUMN IF NOT EXISTS product_id   UUID REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS product_name TEXT;
