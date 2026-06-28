-- ============================================================================
-- Item-level complaints: a complaint can now point at ONE item in the order
-- (the product the customer didn't receive / has an issue with), instead of
-- only the whole order. NULL product_id = the complaint is about the whole
-- order (old behaviour, still allowed).
--
-- product_id is a SOFT reference (no FK) — it mirrors order_items.product_id,
-- which is a plain UUID snapshot: a product can be DELETED later while the
-- order (and its items) live on. A hard FK to products(id) would reject
-- complaints about since-removed products. product_name is the human-readable
-- field that always survives.
-- Safe to run / re-run in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE complaints ADD COLUMN IF NOT EXISTS product_id   UUID;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS product_name TEXT;

-- If an earlier version of this file added a hard FK, drop it (idempotent).
ALTER TABLE complaints DROP CONSTRAINT IF EXISTS complaints_product_id_fkey;
