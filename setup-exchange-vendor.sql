-- ============================================================================
-- Exchange fulfilment via the vendor: when an exchange is approved, a unique
-- Exchange ID is generated and the request appears on the vendor's dashboard.
-- The vendor re-prepares a fresh unit of the SAME product (referencing the
-- original order's items), marks it Ready, and from there it goes out for
-- delivery tracked by the Exchange ID (not the order ID). Safe to run once.
-- ============================================================================

ALTER TABLE return_requests
  ADD COLUMN IF NOT EXISTS exchange_id TEXT UNIQUE;
  -- e.g. EXC-260619-K7P2 — generated on approval of an exchange; the reference
  -- shown to the vendor (to prepare), the pickup partner, and the customer.

-- New free-text status used by the exchange flow (no enum change needed):
--   'Ready'  — vendor has re-prepared the replacement; ready to dispatch.
