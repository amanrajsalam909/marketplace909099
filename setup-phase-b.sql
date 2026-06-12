-- ============================================================================
--  RajkotMarket — Phase B: Customer accounts, delivery OTP, reviews, complaints
--  Safe to re-run: yes
-- ============================================================================

-- 1. CUSTOMER LOGIN — email OTP (with brute-force protection)
CREATE TABLE IF NOT EXISTS otp_sessions (
  phone      TEXT        PRIMARY KEY,            -- normalised 10-digit
  email      TEXT        NOT NULL,
  otp        TEXT        NOT NULL,
  attempts   INTEGER     NOT NULL DEFAULT 0,     -- verify tries; 5 max
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_sessions (
  token      TEXT        PRIMARY KEY,
  phone      TEXT        NOT NULL,
  email      TEXT        NOT NULL,
  name       TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_phone ON customer_sessions (phone);

-- 2. DELIVERY OTP — proof of handover (with attempt limit)
CREATE TABLE IF NOT EXISTS delivery_otps (
  order_id   TEXT        PRIMARY KEY REFERENCES orders(order_id) ON DELETE CASCADE,
  otp        TEXT        NOT NULL,
  attempts   INTEGER     NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. REVIEWS — one per order, only after delivery, admin-moderated
CREATE TABLE IF NOT EXISTS reviews (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      TEXT        NOT NULL UNIQUE REFERENCES orders(order_id) ON DELETE CASCADE,
  vendor_id     UUID        NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  customer_name TEXT        NOT NULL,
  rating        INTEGER     NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       TEXT        NOT NULL DEFAULT '',
  approved      BOOLEAN     NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reviews_vendor ON reviews (vendor_id, approved);

-- 4. COMPLAINTS
CREATE TABLE IF NOT EXISTS complaints (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      TEXT        NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
  vendor_id     UUID        REFERENCES vendors(id),
  customer_name TEXT        NOT NULL,
  email         TEXT        NOT NULL,
  phone         TEXT,
  subject       TEXT        NOT NULL,
  description   TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'Open',  -- Open | In Progress | Resolved
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints (status);

-- 5. STATE MACHINE UPGRADE — payment gate:
--    a UPI order cannot go out for delivery until its payment is Verified.
CREATE OR REPLACE FUNCTION advance_order_status(
  p_order_id   TEXT,
  p_new_status TEXT,
  p_actor      TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ord     RECORD;
  v_allowed TEXT[];
BEGIN
  SELECT * INTO v_ord FROM orders WHERE order_id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found.';
  END IF;

  v_allowed := CASE v_ord.status
    WHEN 'pending'   THEN ARRAY['confirmed']
    WHEN 'confirmed' THEN ARRAY['preparing']
    WHEN 'preparing' THEN ARRAY['ready']
    WHEN 'ready'     THEN ARRAY['delivered']
    ELSE ARRAY[]::TEXT[]
  END;

  IF NOT (p_new_status = ANY (v_allowed)) THEN
    RAISE EXCEPTION 'Illegal status change: % → % is not allowed.', v_ord.status, p_new_status;
  END IF;

  -- Payment gate: UPI money must be verified before goods leave the shop
  IF p_new_status = 'ready' AND v_ord.payment_method = 'UPI' AND v_ord.payment_status <> 'Verified' THEN
    RAISE EXCEPTION 'PAYMENT_NOT_VERIFIED: this UPI payment has not been verified yet. Ask the marketplace admin to verify it first.';
  END IF;

  UPDATE orders
     SET status     = p_new_status,
         updated_at = now(),
         payment_status = CASE
           WHEN p_new_status = 'delivered' AND payment_method = 'COD' THEN 'Collected'
           ELSE payment_status
         END
   WHERE order_id = p_order_id;

  INSERT INTO order_events (order_id, actor, event, from_status, to_status)
  VALUES (p_order_id, p_actor, 'status_change', v_ord.status, p_new_status);

  RETURN jsonb_build_object('success', true, 'from', v_ord.status, 'to', p_new_status);
END;
$$;

-- 6. VERIFICATION
SELECT
  (SELECT count(*) FROM information_schema.tables
    WHERE table_name IN ('otp_sessions','customer_sessions','delivery_otps','reviews','complaints')) AS phase_b_tables;
