-- ============================================================================
-- Order returns. A customer can request a return on a DELIVERED order within
-- 3 days; the admin approves/rejects, marks pickup, and records the (manual)
-- refund. One return per order. Customer is emailed at each step.
-- Safe to run once in the Supabase SQL editor.
-- ============================================================================

CREATE TABLE IF NOT EXISTS return_requests (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      TEXT        NOT NULL UNIQUE REFERENCES orders(order_id) ON DELETE CASCADE,
  vendor_id     UUID        REFERENCES vendors(id),
  customer_name TEXT,
  email         TEXT,
  phone         TEXT,
  reason        TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'Requested',  -- Requested | Approved | Rejected | Picked up | Refunded
  admin_note    TEXT,
  refund_amount NUMERIC(10,2),
  refund_method TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_return_requests_status ON return_requests (status);
CREATE INDEX IF NOT EXISTS idx_return_requests_phone  ON return_requests (phone);
