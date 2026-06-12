-- ============================================================================
--  RajkotMarket — Offers & Discounts Engine
--  Best valid offer auto-applies per shop, inside the atomic checkout.
--  Commission is charged on the DISCOUNTED items value (shop and platform
--  share the discount burden proportionally).
--  Safe to re-run: yes
-- ============================================================================

-- 1. OFFERS
CREATE TABLE IF NOT EXISTS offers (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id      UUID          REFERENCES vendors(id) ON DELETE CASCADE,  -- NULL = all shops
  name           TEXT          NOT NULL,
  description    TEXT          NOT NULL DEFAULT '',
  discount_type  TEXT          NOT NULL CHECK (discount_type IN ('percent', 'flat')),
  discount_value NUMERIC(10,2) NOT NULL CHECK (discount_value > 0),
  max_discount   NUMERIC(10,2) CHECK (max_discount IS NULL OR max_discount > 0),  -- cap for percent offers
  min_order      NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (min_order >= 0),
  valid_from     TIMESTAMPTZ   NOT NULL,
  valid_to       TIMESTAMPTZ   NOT NULL,
  max_uses       INTEGER       CHECK (max_uses IS NULL OR max_uses > 0),
  uses_count     INTEGER       NOT NULL DEFAULT 0,
  active         BOOLEAN       NOT NULL DEFAULT true,
  created_by     TEXT          NOT NULL DEFAULT 'admin',   -- 'admin' | 'vendor'
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT offers_window CHECK (valid_to > valid_from),
  CONSTRAINT offers_pct_sane CHECK (discount_type <> 'percent' OR discount_value <= 90)
);
CREATE INDEX IF NOT EXISTS idx_offers_lookup ON offers (active, valid_from, valid_to, vendor_id);

-- 2. ORDERS — discount columns
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS offer_id        UUID,
  ADD COLUMN IF NOT EXISTS offer_name      TEXT;

-- 3. CHECKOUT v3 — adds best-offer selection per shop
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
  v_offer       RECORD;
  v_now         TIMESTAMP;
  v_dow         INT;
  v_now_mins    INT;
  v_open_mins   INT;
  v_close_mins  INT;
  v_customer_id UUID;
  v_order_id    TEXT;
  v_subtotal    NUMERIC(10,2);
  v_discount    NUMERIC(10,2);
  v_d           NUMERIC(10,2);
  v_offer_id    UUID;
  v_offer_name  TEXT;
  v_commission  NUMERIC(10,2);
  v_total       NUMERIC(10,2);
  v_pay_status  TEXT;
  v_results     JSONB;
  v_phone       TEXT;
BEGIN
  IF p_idempotency_key IS NOT NULL AND length(p_idempotency_key) >= 16 THEN
    SELECT jsonb_agg(jsonb_build_object(
             'order_id', o.order_id, 'vendor_id', o.vendor_id,
             'subtotal', o.subtotal, 'delivery_fee', o.delivery_fee,
             'discount', o.discount_amount, 'offer_name', o.offer_name,
             'total', o.total, 'payment_status', o.payment_status))
      INTO v_results
      FROM orders o
     WHERE o.idempotency_key = p_idempotency_key;
    IF v_results IS NOT NULL THEN
      RETURN jsonb_build_object('success', true, 'duplicate', true, 'orders', v_results);
    END IF;
  END IF;

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

  DROP TABLE IF EXISTS tmp_lines;
  CREATE TEMP TABLE tmp_lines ON COMMIT DROP AS
    SELECT (line->>'id')::uuid           AS product_id,
           sum((line->>'qty')::int)::int AS qty
      FROM jsonb_array_elements(p_items) AS line
     GROUP BY 1;

  IF EXISTS (SELECT 1 FROM tmp_lines WHERE qty < 1 OR qty > 100) THEN
    RAISE EXCEPTION 'Item quantity must be between 1 and 100.';
  END IF;

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

  INSERT INTO customers (phone, name, email, total_orders, total_spent, last_order_date)
  VALUES (v_phone, p_customer->>'name', p_customer->>'email', 0, 0, now())
  ON CONFLICT (phone) DO UPDATE
    SET name = EXCLUDED.name, email = EXCLUDED.email
  RETURNING id INTO v_customer_id;

  v_now      := now() AT TIME ZONE 'Asia/Kolkata';
  v_dow      := EXTRACT(DOW    FROM v_now)::int;
  v_now_mins := EXTRACT(HOUR   FROM v_now)::int * 60 + EXTRACT(MINUTE FROM v_now)::int;
  v_results  := '[]'::jsonb;

  FOR v_vendor IN
    SELECT v.* FROM vendors v
     WHERE v.id IN (SELECT DISTINCT vendor_id FROM tmp_valid)
     ORDER BY v.id
  LOOP
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

    SELECT round(sum(line_total), 2) INTO v_subtotal
      FROM tmp_valid WHERE vendor_id = v_vendor.id;

    IF v_subtotal < v_vendor.min_order THEN
      RAISE EXCEPTION 'Minimum order for % is ₹%. Your items total ₹%.',
        v_vendor.name, v_vendor.min_order, v_subtotal;
    END IF;

    -- ---- Best-offer selection (largest discount wins) --------------------
    v_discount := 0; v_offer_id := NULL; v_offer_name := NULL;
    FOR v_offer IN
      SELECT * FROM offers
       WHERE active
         AND (vendor_id = v_vendor.id OR vendor_id IS NULL)
         AND valid_from <= now() AND valid_to >= now()
         AND min_order <= v_subtotal
         AND (max_uses IS NULL OR uses_count < max_uses)
    LOOP
      v_d := CASE WHEN v_offer.discount_type = 'percent'
                  THEN round(v_subtotal * v_offer.discount_value / 100, 2)
                  ELSE v_offer.discount_value END;
      IF v_offer.max_discount IS NOT NULL AND v_d > v_offer.max_discount THEN
        v_d := v_offer.max_discount;
      END IF;
      IF v_d > v_subtotal THEN v_d := v_subtotal; END IF;
      IF v_d > v_discount THEN
        v_discount := v_d; v_offer_id := v_offer.id; v_offer_name := v_offer.name;
      END IF;
    END LOOP;

    -- Claim the usage slot atomically; if a concurrent checkout took the
    -- last slot, fall back to no discount rather than oversell the offer.
    IF v_offer_id IS NOT NULL THEN
      UPDATE offers SET uses_count = uses_count + 1
       WHERE id = v_offer_id AND (max_uses IS NULL OR uses_count < max_uses);
      IF NOT FOUND THEN
        v_discount := 0; v_offer_id := NULL; v_offer_name := NULL;
      END IF;
    END IF;

    v_total      := round(v_subtotal + v_vendor.delivery_fee - v_discount, 2);
    v_commission := round((v_subtotal - v_discount) * coalesce(v_vendor.commission_percent, 0) / 100, 2);
    v_pay_status := CASE p_payment_method WHEN 'UPI' THEN 'Pending Verification' ELSE 'Pending Collection' END;
    v_order_id   := 'ORD-' || to_char(v_now, 'YYMMDD') || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));

    INSERT INTO orders (
      order_id, vendor_id, customer_id,
      customer_name, customer_email, customer_phone, delivery_address,
      items_json, subtotal, delivery_fee,
      discount_amount, offer_id, offer_name, total,
      payment_method, payment_status, utr,
      commission_percent, commission_amount,
      status, idempotency_key
    )
    SELECT
      v_order_id, v_vendor.id, v_customer_id,
      p_customer->>'name', p_customer->>'email', v_phone, p_customer->>'address',
      (SELECT jsonb_agg(jsonb_build_object('id', product_id, 'name', name, 'price', unit_price, 'quantity', qty))
         FROM tmp_valid WHERE vendor_id = v_vendor.id),
      v_subtotal, v_vendor.delivery_fee,
      v_discount, v_offer_id, v_offer_name, v_total,
      p_payment_method, v_pay_status, nullif(trim(p_utr), ''),
      coalesce(v_vendor.commission_percent, 0), v_commission,
      'pending', p_idempotency_key;

    INSERT INTO order_items (order_id, product_id, product_name, qty, unit_price, line_total)
    SELECT v_order_id, product_id, name, qty, unit_price, line_total
      FROM tmp_valid WHERE vendor_id = v_vendor.id;

    UPDATE products p
       SET stock = p.stock - t.qty
      FROM tmp_valid t
     WHERE p.id = t.product_id AND t.vendor_id = v_vendor.id;

    INSERT INTO inventory_log (product_id, product_name, change, stock_before, stock_after, reason, order_id)
    SELECT product_id, name, -qty, stock_before, stock_before - qty, 'order', v_order_id
      FROM tmp_valid WHERE vendor_id = v_vendor.id;

    INSERT INTO order_events (order_id, actor, event, from_status, to_status, note)
    VALUES (v_order_id, 'customer', 'placed', NULL, 'pending',
            p_payment_method || ' / ' || v_pay_status
            || CASE WHEN v_offer_name IS NOT NULL THEN ' / offer: ' || v_offer_name || ' (−₹' || v_discount || ')' ELSE '' END);

    v_results := v_results || jsonb_build_object(
      'order_id', v_order_id, 'vendor_id', v_vendor.id, 'vendor_name', v_vendor.name,
      'subtotal', v_subtotal, 'delivery_fee', v_vendor.delivery_fee,
      'discount', v_discount, 'offer_name', v_offer_name,
      'total', v_total, 'payment_status', v_pay_status, 'upi_id', v_vendor.upi_id
    );
  END LOOP;

  UPDATE customers
     SET total_orders    = total_orders + jsonb_array_length(v_results),
         total_spent     = total_spent + (SELECT round(sum((o->>'total')::numeric), 2)
                                            FROM jsonb_array_elements(v_results) o),
         last_order_date = now()
   WHERE id = v_customer_id;

  RETURN jsonb_build_object('success', true, 'orders', v_results);
END;
$$;

-- 4. ACCOUNTING v2 — discount-aware
CREATE OR REPLACE FUNCTION vendor_accounting(
  p_vendor_id UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
SELECT jsonb_build_object(
  'delivered', (
    SELECT jsonb_build_object(
      'orders',        count(*),
      'gross',         coalesce(sum(subtotal), 0),
      'discounts',     coalesce(sum(discount_amount), 0),
      'delivery_fees', coalesce(sum(delivery_fee), 0),
      'commission',    coalesce(sum(commission_amount), 0),
      'net',           coalesce(sum(subtotal - discount_amount + delivery_fee - commission_amount), 0),
      'cod_cash',      coalesce(sum(total) FILTER (WHERE payment_method = 'COD'), 0),
      'upi_online',    coalesce(sum(total) FILTER (WHERE payment_method = 'UPI'), 0)
    )
    FROM orders
    WHERE vendor_id = p_vendor_id AND status = 'delivered'
      AND created_at >= p_from AND created_at < p_to
  ),
  'in_progress', (
    SELECT jsonb_build_object('orders', count(*), 'value', coalesce(sum(total), 0))
    FROM orders
    WHERE vendor_id = p_vendor_id
      AND status IN ('pending', 'confirmed', 'preparing', 'ready')
      AND created_at >= p_from AND created_at < p_to
  ),
  'cancelled', (
    SELECT jsonb_build_object('orders', count(*), 'value', coalesce(sum(total), 0))
    FROM orders
    WHERE vendor_id = p_vendor_id AND status = 'cancelled'
      AND created_at >= p_from AND created_at < p_to
  )
);
$$;

CREATE OR REPLACE FUNCTION platform_accounting(
  p_from TIMESTAMPTZ, p_to TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
SELECT jsonb_build_object(
  'totals', (
    SELECT jsonb_build_object(
      'orders',        count(*),
      'gmv',           coalesce(sum(total), 0),
      'gross',         coalesce(sum(subtotal), 0),
      'discounts',     coalesce(sum(discount_amount), 0),
      'delivery_fees', coalesce(sum(delivery_fee), 0),
      'commission',    coalesce(sum(commission_amount), 0),
      'cod',           coalesce(sum(total) FILTER (WHERE payment_method = 'COD'), 0),
      'upi',           coalesce(sum(total) FILTER (WHERE payment_method = 'UPI'), 0)
    )
    FROM orders
    WHERE status = 'delivered' AND created_at >= p_from AND created_at < p_to
  ),
  'in_progress', (
    SELECT jsonb_build_object('orders', count(*), 'value', coalesce(sum(total), 0))
    FROM orders
    WHERE status IN ('pending', 'confirmed', 'preparing', 'ready')
      AND created_at >= p_from AND created_at < p_to
  ),
  'cancelled', (
    SELECT jsonb_build_object('orders', count(*))
    FROM orders
    WHERE status = 'cancelled' AND created_at >= p_from AND created_at < p_to
  ),
  'by_vendor', (
    SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.commission DESC), '[]'::jsonb)
    FROM (
      SELECT
        v.id, v.name, v.commission_percent,
        count(o.order_id)                          AS orders,
        coalesce(sum(o.subtotal), 0)               AS gross,
        coalesce(sum(o.discount_amount), 0)        AS discounts,
        coalesce(sum(o.delivery_fee), 0)           AS delivery_fees,
        coalesce(sum(o.commission_amount), 0)      AS commission,
        coalesce(sum(o.subtotal - o.discount_amount + o.delivery_fee - o.commission_amount), 0) AS payout
      FROM vendors v
      LEFT JOIN orders o
        ON o.vendor_id = v.id AND o.status = 'delivered'
       AND o.created_at >= p_from AND o.created_at < p_to
      GROUP BY v.id, v.name, v.commission_percent
    ) t
  )
);
$$;

-- 5. VERIFICATION
SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_name = 'offers') AS offers_table,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'discount_amount') AS discount_column;
