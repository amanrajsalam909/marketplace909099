-- ===========================================================================
--  setup-product-variants.sql
--  Per-variant (size × colour …) stock for "selected categories".
--
--  Opt-in per spec template (track_variant_stock). When on, each product using
--  that template tracks stock per COMBINATION of its pickable fields in the
--  product_variants table. Selling "Red / M" reduces only that combo, not the
--  whole product. products.stock is kept as the cached SUM of the variants so
--  the storefront / search / low-stock logic keeps working unchanged.
--
--  Matching is by jsonb equality (products_variants.specs = order/cart specs);
--  Postgres normalises jsonb so key order does not matter.
--
--  This SUPERSEDES place_marketplace_order from setup-product-specs.sql Part 2
--  and extends the three restock functions. Safe to re-run.
--
--  Requires: setup-product-specs.sql (Parts 1, 1b, 2) applied first.
-- ===========================================================================

-- 1. Opt-in flag + variant table -------------------------------------------
ALTER TABLE spec_templates ADD COLUMN IF NOT EXISTS track_variant_stock BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN spec_templates.track_variant_stock IS 'true = products on this template keep stock per size/colour combination (product_variants).';

CREATE TABLE IF NOT EXISTS product_variants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  specs       JSONB NOT NULL,                       -- {"Size":"M","Colour":"Red"} — all pickable fields
  stock       INT NOT NULL DEFAULT 0 CHECK (stock >= 0),
  created_at  TIMESTAMP DEFAULT now(),
  updated_at  TIMESTAMP DEFAULT now(),
  UNIQUE (product_id, specs)
);
CREATE INDEX IF NOT EXISTS idx_product_variants_product ON product_variants(product_id);

COMMENT ON TABLE product_variants IS 'Per-combination stock for variant-tracked products. products.stock stays the cached SUM of these.';


-- 2. CHECKOUT — variant-aware decrement ------------------------------------
--    Keeps the per-product path for non-variant products; adds a per-(product,
--    specs) lock/validate/decrement for variant-tracked products.
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
  v_vrow        RECORD;
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

  -- Per-product totals (stock lock for non-variant products, decrement, log).
  DROP TABLE IF EXISTS tmp_lines;
  CREATE TEMP TABLE tmp_lines ON COMMIT DROP AS
    SELECT (line->>'id')::uuid           AS product_id,
           sum((line->>'qty')::int)::int AS qty
      FROM jsonb_array_elements(p_items) AS line
     GROUP BY 1;

  IF EXISTS (SELECT 1 FROM tmp_lines WHERE qty < 1 OR qty > 100) THEN
    RAISE EXCEPTION 'Item quantity must be between 1 and 100.';
  END IF;

  -- Per-(product, specs) breakdown: order lines + variant stock.
  DROP TABLE IF EXISTS tmp_items;
  CREATE TEMP TABLE tmp_items ON COMMIT DROP AS
    SELECT (line->>'id')::uuid AS product_id,
           CASE WHEN line ? 'specs' AND line->'specs' <> 'null'::jsonb
                THEN line->'specs' ELSE NULL END AS specs,
           sum((line->>'qty')::int)::int AS qty
      FROM jsonb_array_elements(p_items) AS line
     GROUP BY 1, 2;

  -- Which ordered products are variant-tracked (have any variant rows).
  DROP TABLE IF EXISTS tmp_varprod;
  CREATE TEMP TABLE tmp_varprod ON COMMIT DROP AS
    SELECT DISTINCT product_id FROM product_variants
     WHERE product_id IN (SELECT product_id FROM tmp_lines);

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
    -- Variant products are checked per combination below; others here.
    IF NOT EXISTS (SELECT 1 FROM tmp_varprod vp WHERE vp.product_id = v_prod.id) THEN
      IF v_prod.stock < v_prod.qty THEN
        RAISE EXCEPTION 'Only % left in stock for "%". Please reduce the quantity.',
          v_prod.stock, v_prod.name;
      END IF;
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

  -- Variant stock: lock + validate each (product, specs) combo. Deterministic
  -- order avoids deadlocks. LEFT JOIN so a missing combo is caught explicitly.
  FOR v_vrow IN
    SELECT ti.product_id, ti.specs, ti.qty, p.name,
           pv.id AS variant_id, pv.stock AS vstock
      FROM tmp_items ti
      JOIN tmp_varprod vp ON vp.product_id = ti.product_id
      JOIN products p     ON p.id = ti.product_id
      LEFT JOIN product_variants pv
             ON pv.product_id = ti.product_id AND pv.specs = ti.specs
     ORDER BY ti.product_id, ti.specs
       FOR UPDATE OF pv
  LOOP
    IF v_vrow.variant_id IS NULL THEN
      RAISE EXCEPTION 'That option for "%" is no longer available. Please refresh and choose again.', v_vrow.name;
    END IF;
    IF v_vrow.vstock < v_vrow.qty THEN
      RAISE EXCEPTION 'Only % left for "%" (%).',
        v_vrow.vstock, v_vrow.name,
        coalesce((SELECT string_agg(key || ': ' || value, ', ') FROM jsonb_each_text(v_vrow.specs)), 'selected option');
    END IF;
  END LOOP;

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
      customer_name, customer_email, customer_phone, delivery_address, address_json,
      items_json, subtotal, delivery_fee,
      discount_amount, offer_id, offer_name, total,
      payment_method, payment_status, utr,
      commission_percent, commission_amount,
      status, idempotency_key
    )
    SELECT
      v_order_id, v_vendor.id, v_customer_id,
      p_customer->>'name', p_customer->>'email', v_phone, p_customer->>'address',
      nullif(p_customer->'address_parts', 'null'::jsonb),
      (SELECT jsonb_agg(jsonb_build_object(
                'id', ti.product_id, 'name', tv.name, 'price', tv.unit_price,
                'quantity', ti.qty, 'specs', ti.specs))
         FROM tmp_items ti
         JOIN tmp_valid tv ON tv.product_id = ti.product_id
        WHERE tv.vendor_id = v_vendor.id),
      v_subtotal, v_vendor.delivery_fee,
      v_discount, v_offer_id, v_offer_name, v_total,
      p_payment_method, v_pay_status, nullif(trim(p_utr), ''),
      coalesce(v_vendor.commission_percent, 0), v_commission,
      'pending', p_idempotency_key;

    -- One order_items row per (product, specs) selection.
    INSERT INTO order_items (order_id, product_id, product_name, qty, unit_price, line_total, specs)
    SELECT v_order_id, ti.product_id, tv.name, ti.qty, tv.unit_price,
           round(tv.unit_price * ti.qty, 2), ti.specs
      FROM tmp_items ti
      JOIN tmp_valid tv ON tv.product_id = ti.product_id
     WHERE tv.vendor_id = v_vendor.id;

    -- products.stock holds the total for every product (cached sum for variant
    -- products) — decrement by the per-product quantity.
    UPDATE products p
       SET stock = p.stock - t.qty
      FROM tmp_valid t
     WHERE p.id = t.product_id AND t.vendor_id = v_vendor.id;

    -- Variant products: also decrement the specific combination's stock.
    UPDATE product_variants pv
       SET stock = pv.stock - ti.qty, updated_at = now()
      FROM tmp_items ti
      JOIN tmp_valid tv ON tv.product_id = ti.product_id
     WHERE pv.product_id = ti.product_id AND pv.specs = ti.specs
       AND tv.vendor_id = v_vendor.id;

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


-- 3. RESTOCK functions — also restore the specific variant -------------------
--    Each keeps the existing products.stock += qty and adds a variant restore
--    keyed on order_items.specs. Non-variant lines match no variant row.

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

  -- Restore the specific variant combinations.
  UPDATE product_variants pv
     SET stock = pv.stock + oi.qty, updated_at = now()
    FROM order_items oi
   WHERE oi.order_id = p_order_id AND pv.product_id = oi.product_id AND pv.specs = oi.specs;

  UPDATE orders SET status = 'cancelled', updated_at = now() WHERE order_id = p_order_id;

  INSERT INTO order_events (order_id, actor, event, from_status, to_status, note)
  VALUES (p_order_id, p_actor, 'cancelled', v_ord.status, 'cancelled', nullif(p_reason, ''));

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION admin_cancel_order(
  p_order_id TEXT,
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
  IF v_ord.status IN ('delivered', 'cancelled') THEN
    RAISE EXCEPTION 'A % order cannot be cancelled.', v_ord.status;
  END IF;

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

  UPDATE product_variants pv
     SET stock = pv.stock + oi.qty, updated_at = now()
    FROM order_items oi
   WHERE oi.order_id = p_order_id AND pv.product_id = oi.product_id AND pv.specs = oi.specs;

  UPDATE orders SET status = 'cancelled', updated_at = now() WHERE order_id = p_order_id;

  INSERT INTO order_events (order_id, actor, event, from_status, to_status, note)
  VALUES (p_order_id, 'admin', 'cancelled', v_ord.status, 'cancelled', nullif(p_reason, ''));

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION process_return_refund(p_order_id TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE v_returned BOOLEAN;
BEGIN
  SELECT coalesce(returned, false) INTO v_returned
    FROM orders WHERE order_id = p_order_id FOR UPDATE;
  IF v_returned IS NULL OR v_returned THEN RETURN; END IF;

  -- 1. Restore product-level (cached total) stock.
  UPDATE products p
     SET stock = p.stock + oi.qty, updated_at = now()
    FROM order_items oi
   WHERE oi.order_id = p_order_id AND oi.product_id = p.id;

  -- 1b. Restore the specific variant combinations.
  UPDATE product_variants pv
     SET stock = pv.stock + oi.qty, updated_at = now()
    FROM order_items oi
   WHERE oi.order_id = p_order_id AND pv.product_id = oi.product_id AND pv.specs = oi.specs;

  -- 2. Record the restock movement.
  INSERT INTO inventory_log (product_id, product_name, change, stock_before, stock_after, reason, order_id)
  SELECT p.id, p.name, oi.qty, p.stock - oi.qty, p.stock, 'return', p_order_id
    FROM order_items oi JOIN products p ON p.id = oi.product_id
   WHERE oi.order_id = p_order_id;

  -- 3. Reverse commission and flag the order as returned.
  UPDATE orders
     SET commission_amount = 0, returned = true, returned_at = now(), updated_at = now()
   WHERE order_id = p_order_id;
END;
$$;


-- 4. VERIFICATION
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='spec_templates' AND column_name='track_variant_stock';
--   SELECT count(*) FROM product_variants;
--   -- place a variant order, then check product_variants.stock + products.stock.
