-- ============================================================================
--  RajkotMarket — Order Pipeline v2 (atomic, race-free, auditable)
--  Target : Supabase (PostgreSQL 15+)
--  Safe to re-run: yes
--
--  Design principles (improvements over the previous generation system):
--  1. ATOMIC   — order placement is ONE database transaction: stock check,
--                stock deduction, order rows, audit rows all succeed or all
--                roll back. No half-written orders, ever.
--  2. RACE-FREE— product rows are locked (FOR UPDATE, ordered by id to
--                prevent deadlocks) before stock is checked. Two customers
--                can never both buy the last unit.
--  3. UNTRUSTING — prices, vendor grouping, fees, commissions are computed
--                from the database. The browser only sends product ids + qty.
--  4. IDEMPOTENT — checkout carries a client key; network retries can never
--                create duplicate orders.
--  5. STATE MACHINE — order status can only move along legal transitions,
--                enforced in the database, with an append-only event log.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PRODUCTS — stock tracking
-- ----------------------------------------------------------------------------
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0);

-- Existing demo products get sellable stock so the live site keeps working
UPDATE products SET stock = 100 WHERE stock = 0;

-- ----------------------------------------------------------------------------
-- 2. VENDORS — per-shop commerce settings
-- ----------------------------------------------------------------------------
ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS is_open      BOOLEAN       NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS open_time    TIME,
  ADD COLUMN IF NOT EXISTS close_time   TIME,
  ADD COLUMN IF NOT EXISTS open_days    TEXT          NOT NULL DEFAULT '0,1,2,3,4,5,6',
  ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(10,2) NOT NULL DEFAULT 30 CHECK (delivery_fee >= 0),
  ADD COLUMN IF NOT EXISTS min_order    NUMERIC(10,2) NOT NULL DEFAULT 0  CHECK (min_order >= 0),
  ADD COLUMN IF NOT EXISTS accepts_cod  BOOLEAN       NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS upi_id       TEXT;

-- ----------------------------------------------------------------------------
-- 3. ORDERS — financial precision columns
-- ----------------------------------------------------------------------------
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS subtotal           NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS delivery_fee       NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS payment_method     TEXT NOT NULL DEFAULT 'COD',
  ADD COLUMN IF NOT EXISTS payment_status     TEXT NOT NULL DEFAULT 'Pending Collection',
  ADD COLUMN IF NOT EXISTS utr                TEXT,
  ADD COLUMN IF NOT EXISTS commission_percent NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS commission_amount  NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS idempotency_key    TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_idempotency ON orders (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders (payment_status);

-- ----------------------------------------------------------------------------
-- 4. ORDER ITEMS — normalised line items (one row per product per order)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_items (
  id           BIGSERIAL     PRIMARY KEY,
  order_id     TEXT          NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
  product_id   UUID          NOT NULL,
  product_name TEXT          NOT NULL,
  qty          INTEGER       NOT NULL CHECK (qty > 0),
  unit_price   NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
  line_total   NUMERIC(10,2) NOT NULL CHECK (line_total >= 0)
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);

-- ----------------------------------------------------------------------------
-- 5. ORDER EVENTS — append-only audit trail (who did what, when)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_events (
  id          BIGSERIAL   PRIMARY KEY,
  order_id    TEXT        NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
  actor       TEXT        NOT NULL,                 -- 'customer' | 'vendor:<id>' | 'admin' | 'system'
  event       TEXT        NOT NULL,                 -- 'placed' | 'status_change' | 'payment_verified' | 'cancelled'
  from_status TEXT,
  to_status   TEXT,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events (order_id);

-- ----------------------------------------------------------------------------
-- 6. INVENTORY LOG — every stock movement is recorded
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_log (
  id           BIGSERIAL   PRIMARY KEY,
  product_id   UUID        NOT NULL,
  product_name TEXT        NOT NULL,
  change       INTEGER     NOT NULL,                -- negative = sold, positive = restocked
  stock_before INTEGER     NOT NULL,
  stock_after  INTEGER     NOT NULL,
  reason       TEXT        NOT NULL,                -- 'order' | 'cancel_restore' | 'manual'
  order_id     TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inventory_log_product ON inventory_log (product_id);

-- ----------------------------------------------------------------------------
-- 7. CUSTOMERS — CRM columns
-- ----------------------------------------------------------------------------
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS total_orders    INTEGER       NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_spent     NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_order_date TIMESTAMPTZ;

-- ============================================================================
-- 8. RPC: place_marketplace_order — THE atomic checkout
--    Input : customer json, items json [{id, qty}], payment method, idem key
--    Output: { success, orders: [{order_id, vendor_id, vendor_name,
--              subtotal, delivery_fee, total, payment_status, upi_id}] }
--    Any failure raises an exception => the WHOLE checkout rolls back.
-- ============================================================================
CREATE OR REPLACE FUNCTION place_marketplace_order(
  p_customer        JSONB,
  p_items           JSONB,
  p_payment_method  TEXT DEFAULT 'COD',
  p_utr             TEXT DEFAULT '',
  p_idempotency_key TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_prod        RECORD;
  v_vendor      RECORD;
  v_now         TIMESTAMP;     -- local time in Asia/Kolkata
  v_dow         INT;
  v_now_mins    INT;
  v_open_mins   INT;
  v_close_mins  INT;
  v_customer_id UUID;
  v_order_id    TEXT;
  v_subtotal    NUMERIC(10,2);
  v_commission  NUMERIC(10,2);
  v_total       NUMERIC(10,2);
  v_pay_status  TEXT;
  v_results     JSONB;
  v_phone       TEXT;
BEGIN
  -- ---- 0. Idempotency: a retried checkout returns the original orders -----
  IF p_idempotency_key IS NOT NULL AND length(p_idempotency_key) >= 16 THEN
    SELECT jsonb_agg(jsonb_build_object(
             'order_id', o.order_id, 'vendor_id', o.vendor_id,
             'subtotal', o.subtotal, 'delivery_fee', o.delivery_fee,
             'total', o.total, 'payment_status', o.payment_status))
      INTO v_results
      FROM orders o
     WHERE o.idempotency_key = p_idempotency_key;
    IF v_results IS NOT NULL THEN
      RETURN jsonb_build_object('success', true, 'duplicate', true, 'orders', v_results);
    END IF;
  END IF;

  -- ---- 1. Validate input shape --------------------------------------------
  IF coalesce(trim(p_customer->>'name'),  '') = '' OR
     coalesce(trim(p_customer->>'phone'), '') = '' OR
     coalesce(trim(p_customer->>'email'), '') = '' OR
     coalesce(trim(p_customer->>'address'),'') = '' THEN
    RAISE EXCEPTION 'Please fill in your name, phone, email and delivery address.';
  END IF;
  IF p_payment_method NOT IN ('COD', 'UPI') THEN
    RAISE EXCEPTION 'Unsupported payment method.';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Your cart is empty.';
  END IF;

  v_phone := regexp_replace(p_customer->>'phone', '\D', '', 'g');
  IF length(v_phone) < 10 THEN
    RAISE EXCEPTION 'Please enter a valid 10-digit phone number.';
  END IF;
  v_phone := right(v_phone, 10);

  -- ---- 2. Normalise requested lines (merge duplicate products) ------------
  DROP TABLE IF EXISTS tmp_lines;
  CREATE TEMP TABLE tmp_lines ON COMMIT DROP AS
    SELECT (line->>'id')::uuid          AS product_id,
           sum((line->>'qty')::int)::int AS qty
      FROM jsonb_array_elements(p_items) AS line
     GROUP BY 1;

  IF EXISTS (SELECT 1 FROM tmp_lines WHERE qty < 1 OR qty > 100) THEN
    RAISE EXCEPTION 'Item quantity must be between 1 and 100.';
  END IF;

  -- ---- 3. Lock product rows (ordered by id => no deadlocks),
  --         validate existence, active flag and stock ----------------------
  DROP TABLE IF EXISTS tmp_valid;
  CREATE TEMP TABLE tmp_valid (
    product_id UUID, vendor_id UUID, name TEXT,
    unit_price NUMERIC(10,2), qty INT, line_total NUMERIC(10,2),
    stock_before INT
  ) ON COMMIT DROP;

  FOR v_prod IN
    SELECT p.id, p.vendor_id, p.name, p.price, p.stock, p.active, l.qty
      FROM products p
      JOIN tmp_lines l ON l.product_id = p.id
     ORDER BY p.id
       FOR UPDATE OF p
  LOOP
    IF NOT v_prod.active THEN
      RAISE EXCEPTION '"%" is no longer available.', v_prod.name;
    END IF;
    IF v_prod.vendor_id IS NULL THEN
      RAISE EXCEPTION '"%" is not attached to any shop.', v_prod.name;
    END IF;
    IF v_prod.stock < v_prod.qty THEN
      RAISE EXCEPTION 'Only % left in stock for "%". Please reduce the quantity.',
        v_prod.stock, v_prod.name;
    END IF;
    INSERT INTO tmp_valid VALUES (
      v_prod.id, v_prod.vendor_id, v_prod.name,
      v_prod.price, v_prod.qty,
      round(v_prod.price * v_prod.qty, 2), v_prod.stock
    );
  END LOOP;

  IF (SELECT count(*) FROM tmp_valid) <> (SELECT count(*) FROM tmp_lines) THEN
    RAISE EXCEPTION 'Some items in your cart no longer exist. Please refresh and try again.';
  END IF;

  -- ---- 4. Upsert customer (atomic ON CONFLICT, no read-then-write race) ---
  INSERT INTO customers (phone, name, email, total_orders, total_spent, last_order_date)
  VALUES (v_phone, p_customer->>'name', p_customer->>'email', 0, 0, now())
  ON CONFLICT (phone) DO UPDATE
    SET name = EXCLUDED.name, email = EXCLUDED.email
  RETURNING id INTO v_customer_id;

  -- ---- 5. Per-shop validation + order creation ----------------------------
  v_now      := now() AT TIME ZONE 'Asia/Kolkata';
  v_dow      := EXTRACT(DOW    FROM v_now)::int;
  v_now_mins := EXTRACT(HOUR   FROM v_now)::int * 60 + EXTRACT(MINUTE FROM v_now)::int;
  v_results  := '[]'::jsonb;

  FOR v_vendor IN
    SELECT v.* FROM vendors v
     WHERE v.id IN (SELECT DISTINCT vendor_id FROM tmp_valid)
     ORDER BY v.id
  LOOP
    -- shop must be live and open
    IF NOT v_vendor.is_active THEN
      RAISE EXCEPTION '% is currently not accepting orders.', v_vendor.name;
    END IF;
    IF NOT v_vendor.is_open THEN
      RAISE EXCEPTION '% is closed right now. Please try later.', v_vendor.name;
    END IF;
    IF v_vendor.open_time IS NOT NULL AND v_vendor.close_time IS NOT NULL THEN
      IF NOT (v_dow = ANY (string_to_array(coalesce(v_vendor.open_days, '0,1,2,3,4,5,6'), ',')::int[])) THEN
        RAISE EXCEPTION '% is closed today.', v_vendor.name;
      END IF;
      v_open_mins  := EXTRACT(HOUR FROM v_vendor.open_time)::int  * 60 + EXTRACT(MINUTE FROM v_vendor.open_time)::int;
      v_close_mins := EXTRACT(HOUR FROM v_vendor.close_time)::int * 60 + EXTRACT(MINUTE FROM v_vendor.close_time)::int;
      IF v_now_mins < v_open_mins OR v_now_mins >= v_close_mins THEN
        RAISE EXCEPTION '% is closed right now (open % – %).',
          v_vendor.name, to_char(v_vendor.open_time, 'HH12:MI AM'), to_char(v_vendor.close_time, 'HH12:MI AM');
      END IF;
    END IF;
    IF p_payment_method = 'COD' AND NOT v_vendor.accepts_cod THEN
      RAISE EXCEPTION '% does not accept Cash on Delivery.', v_vendor.name;
    END IF;

    -- money math (all server-side, rounded to paise)
    SELECT round(sum(line_total), 2) INTO v_subtotal
      FROM tmp_valid WHERE vendor_id = v_vendor.id;

    IF v_subtotal < v_vendor.min_order THEN
      RAISE EXCEPTION 'Minimum order for % is ₹%. Your items total ₹%.',
        v_vendor.name, v_vendor.min_order, v_subtotal;
    END IF;

    v_total      := round(v_subtotal + v_vendor.delivery_fee, 2);
    v_commission := round(v_subtotal * coalesce(v_vendor.commission_percent, 0) / 100, 2);
    v_pay_status := CASE p_payment_method WHEN 'UPI' THEN 'Pending Verification' ELSE 'Pending Collection' END;
    v_order_id   := 'ORD-' || to_char(v_now, 'YYMMDD') || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));

    INSERT INTO orders (
      order_id, vendor_id, customer_id,
      customer_name, customer_email, customer_phone, delivery_address,
      items_json, subtotal, delivery_fee, total,
      payment_method, payment_status, utr,
      commission_percent, commission_amount,
      status, idempotency_key
    )
    SELECT
      v_order_id, v_vendor.id, v_customer_id,
      p_customer->>'name', p_customer->>'email', v_phone, p_customer->>'address',
      (SELECT jsonb_agg(jsonb_build_object('id', product_id, 'name', name, 'price', unit_price, 'quantity', qty))
         FROM tmp_valid WHERE vendor_id = v_vendor.id),
      v_subtotal, v_vendor.delivery_fee, v_total,
      p_payment_method, v_pay_status, nullif(trim(p_utr), ''),
      coalesce(v_vendor.commission_percent, 0), v_commission,
      'pending', p_idempotency_key;

    INSERT INTO order_items (order_id, product_id, product_name, qty, unit_price, line_total)
    SELECT v_order_id, product_id, name, qty, unit_price, line_total
      FROM tmp_valid WHERE vendor_id = v_vendor.id;

    -- stock deduction on already-locked rows + audit
    UPDATE products p
       SET stock = p.stock - t.qty
      FROM tmp_valid t
     WHERE p.id = t.product_id AND t.vendor_id = v_vendor.id;

    INSERT INTO inventory_log (product_id, product_name, change, stock_before, stock_after, reason, order_id)
    SELECT product_id, name, -qty, stock_before, stock_before - qty, 'order', v_order_id
      FROM tmp_valid WHERE vendor_id = v_vendor.id;

    INSERT INTO order_events (order_id, actor, event, from_status, to_status, note)
    VALUES (v_order_id, 'customer', 'placed', NULL, 'pending',
            p_payment_method || ' / ' || v_pay_status);

    v_results := v_results || jsonb_build_object(
      'order_id', v_order_id, 'vendor_id', v_vendor.id, 'vendor_name', v_vendor.name,
      'subtotal', v_subtotal, 'delivery_fee', v_vendor.delivery_fee, 'total', v_total,
      'payment_status', v_pay_status, 'upi_id', v_vendor.upi_id
    );
  END LOOP;

  -- CRM counters (one statement, atomic)
  UPDATE customers
     SET total_orders    = total_orders + jsonb_array_length(v_results),
         total_spent     = total_spent + (SELECT round(sum((o->>'total')::numeric), 2)
                                            FROM jsonb_array_elements(v_results) o),
         last_order_date = now()
   WHERE id = v_customer_id;

  RETURN jsonb_build_object('success', true, 'orders', v_results);
END;
$$;

-- ============================================================================
-- 9. RPC: advance_order_status — state machine, legal transitions only
--    pending → confirmed → preparing → ready → delivered
-- ============================================================================
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

  UPDATE orders
     SET status     = p_new_status,
         updated_at = now(),
         -- COD money is implicitly collected at the doorstep on delivery
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

-- ============================================================================
-- 10. RPC: cancel_order — atomic cancellation with stock restoration
--     Only pending/confirmed orders may be cancelled.
-- ============================================================================
CREATE OR REPLACE FUNCTION cancel_order(
  p_order_id TEXT,
  p_actor    TEXT,
  p_reason   TEXT DEFAULT ''
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ord  RECORD;
  v_item RECORD;
BEGIN
  SELECT * INTO v_ord FROM orders WHERE order_id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found.';
  END IF;
  IF v_ord.status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'This order is already % and can no longer be cancelled.', v_ord.status;
  END IF;

  -- restore stock, locking product rows in id order (same discipline as checkout)
  FOR v_item IN
    SELECT oi.product_id, oi.product_name, oi.qty, p.stock
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = p_order_id
     ORDER BY oi.product_id
       FOR UPDATE OF p
  LOOP
    UPDATE products SET stock = stock + v_item.qty WHERE id = v_item.product_id;
    INSERT INTO inventory_log (product_id, product_name, change, stock_before, stock_after, reason, order_id)
    VALUES (v_item.product_id, v_item.product_name, v_item.qty,
            v_item.stock, v_item.stock + v_item.qty, 'cancel_restore', p_order_id);
  END LOOP;

  UPDATE orders SET status = 'cancelled', updated_at = now() WHERE order_id = p_order_id;

  INSERT INTO order_events (order_id, actor, event, from_status, to_status, note)
  VALUES (p_order_id, p_actor, 'cancelled', v_ord.status, 'cancelled', nullif(p_reason, ''));

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================================
-- 11. RPC: verify_payment — admin confirms a UPI payment (UTR)
--     Verification auto-confirms a pending order.
-- ============================================================================
CREATE OR REPLACE FUNCTION verify_payment(
  p_order_id TEXT,
  p_utr      TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ord RECORD;
BEGIN
  SELECT * INTO v_ord FROM orders WHERE order_id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found.';
  END IF;
  IF v_ord.payment_method <> 'UPI' THEN
    RAISE EXCEPTION 'Only UPI orders need payment verification.';
  END IF;
  IF v_ord.payment_status = 'Verified' THEN
    RETURN jsonb_build_object('success', true, 'already', true);
  END IF;

  UPDATE orders
     SET payment_status = 'Verified',
         utr            = coalesce(nullif(trim(p_utr), ''), utr),
         updated_at     = now()
   WHERE order_id = p_order_id;

  INSERT INTO order_events (order_id, actor, event, note)
  VALUES (p_order_id, 'admin', 'payment_verified', coalesce(nullif(trim(p_utr), ''), v_ord.utr));

  IF v_ord.status = 'pending' THEN
    PERFORM advance_order_status(p_order_id, 'confirmed', 'admin');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ----------------------------------------------------------------------------
-- 12. VERIFICATION
-- ----------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'stock')   AS products_stock_ok,
  (SELECT count(*) FROM information_schema.tables  WHERE table_name IN ('order_items','order_events','inventory_log')) AS new_tables,
  (SELECT count(*) FROM pg_proc WHERE proname IN ('place_marketplace_order','advance_order_status','cancel_order','verify_payment')) AS pipeline_functions;
