-- ============================================================================
-- Splits the request pipeline into RETURN (refund-seeking) vs EXCHANGE
-- (same-product swap). The customer now chooses up front. Exchanges skip the
-- refund/Gate-3 entirely: the pickup partner inspects (QC) and hands over the
-- replacement at the door, so the case closes as 'Exchanged' with the
-- pickup/exchange time. Safe to run once in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE return_requests
  ADD COLUMN IF NOT EXISTS request_type TEXT NOT NULL DEFAULT 'return';
  -- 'return'   -> refund pipeline (approve -> assign -> pickup -> QC -> admin finalize)
  -- 'exchange' -> swap pipeline   (approve -> assign -> pickup -> QC pass = handed over -> Exchanged)

CREATE INDEX IF NOT EXISTS idx_return_requests_type ON return_requests (request_type);

-- New status used by the exchange pipeline (free-text column, no enum change):
--   'Exchanged'  — partner handed over the replacement at pickup.
