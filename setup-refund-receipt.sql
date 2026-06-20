-- ============================================================================
-- Refund proof: the admin must upload a transaction receipt when processing a
-- refund. The receipt is saved to Google Drive; only on a successful upload is
-- the refund marked done. The Drive link is stored here. Safe to run once.
-- ============================================================================

ALTER TABLE return_requests
  ADD COLUMN IF NOT EXISTS refund_receipt_url TEXT;
