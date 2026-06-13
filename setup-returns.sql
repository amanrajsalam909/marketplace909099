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

-- ----------------------------------------------------------------------------
-- Refund processing: when a return is marked Refunded, restore the item stock
-- and back the order out of accounting (reverse commission + flag returned).
-- ----------------------------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS returned    BOOLEAN DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION process_return_refund(p_order_id TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE v_returned BOOLEAN;
BEGIN
  -- Lock the order row; idempotent — only the first refund does the work.
  SELECT coalesce(returned, false) INTO v_returned
    FROM orders WHERE order_id = p_order_id FOR UPDATE;
  IF v_returned IS NULL OR v_returned THEN RETURN; END IF;

  -- 1. Restore stock for each line item from order_items.
  UPDATE products p
     SET stock = p.stock + oi.qty, updated_at = now()
    FROM order_items oi
   WHERE oi.order_id = p_order_id AND oi.product_id = p.id;

  -- 2. Record the restock movement (stock now already incremented).
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

-- ----------------------------------------------------------------------------
-- Accounting: exclude returned orders so commission + the sale back out.
-- (Re-declares the two accounting RPCs with an extra returned = false filter.)
-- ----------------------------------------------------------------------------
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
    WHERE status = 'delivered' AND coalesce(returned, false) = false
      AND created_at >= p_from AND created_at < p_to
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
       AND coalesce(o.returned, false) = false
       AND o.created_at >= p_from AND o.created_at < p_to
      GROUP BY v.id, v.name, v.commission_percent
    ) t
  )
);
$$;

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
      AND coalesce(returned, false) = false
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
