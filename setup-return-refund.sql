-- ============================================================================
-- Returns are split into two phases:
--   1. RETURN (logistics, vendor-driven, mirrors exchange): customer requests →
--      vendor dispatches a pickup partner → partner collects (OTP + item + QC
--      photos) → vendor confirms receipt → status 'Returned' (returned success).
--   2. REFUND (admin): once 'Returned', the admin processes the refund using the
--      customer's saved bank/UPI details → status 'Refunded'.
-- Safe to run once in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE return_requests
  ADD COLUMN IF NOT EXISTS returned_received_at TIMESTAMPTZ;
  -- set when the vendor confirms the returned item is back in hand.

-- New free-text status (no enum change): 'Returned' — item received by vendor,
-- awaiting the admin's refund.
