-- ============================================================================
--  RajkotMarket — Customer address book
--  Up to three saved addresses per customer (Home / Office / Other) stored
--  as a JSONB object keyed by label. Used by the cart so signed-in customers
--  can pick a saved address on any device instead of retyping it.
--  Guests keep a device-local address book; nothing breaks if this column
--  is missing (the cart falls back to localStorage).
--  Safe to re-run: yes
-- ============================================================================

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS addresses JSONB NOT NULL DEFAULT '{}'::jsonb;

-- VERIFICATION
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'customers' AND column_name = 'addresses') AS addresses_column;
