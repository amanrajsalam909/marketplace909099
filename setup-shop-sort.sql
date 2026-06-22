-- ===========================================================================
--  setup-shop-sort.sql
--  Shop-list Sort: Relevance · Rating · Delivery time.
--
--  "Relevance" and "Rating" need no schema (relevance = existing order; rating
--  is aggregated from the reviews table). "Delivery time" needs a per-shop
--  estimated delivery window, so this adds vendors.delivery_eta_mins — the
--  vendor's promised delivery time in minutes, editable in Shop Settings.
--  Safe to re-run.
-- ===========================================================================

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS delivery_eta_mins INT NOT NULL DEFAULT 45;

COMMENT ON COLUMN vendors.delivery_eta_mins IS 'Estimated delivery time in minutes shown on the shop card and used by the "Delivery time" sort.';

-- Verify:
--   SELECT name, delivery_eta_mins FROM vendors ORDER BY delivery_eta_mins;
