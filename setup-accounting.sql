-- ============================================================================
--  RajkotMarket — Accounting functions
--  All money math is done by PostgreSQL aggregates over NUMERIC columns:
--  exact paise arithmetic, no row limits, no floating-point drift.
--  Revenue is recognised on DELIVERED orders only.
--  Safe to re-run: yes
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Per-shop accounting summary
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vendor_accounting(
  p_vendor_id UUID,
  p_from      TIMESTAMPTZ,
  p_to        TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
SELECT jsonb_build_object(
  'delivered', (
    SELECT jsonb_build_object(
      'orders',        count(*),
      'gross',         coalesce(sum(subtotal), 0),
      'delivery_fees', coalesce(sum(delivery_fee), 0),
      'commission',    coalesce(sum(commission_amount), 0),
      'net',           coalesce(sum(subtotal + delivery_fee - commission_amount), 0),
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

-- ----------------------------------------------------------------------------
-- 2. Platform-wide accounting (admin): totals + per-shop rollup
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform_accounting(
  p_from TIMESTAMPTZ,
  p_to   TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
SELECT jsonb_build_object(
  'totals', (
    SELECT jsonb_build_object(
      'orders',        count(*),
      'gmv',           coalesce(sum(total), 0),
      'gross',         coalesce(sum(subtotal), 0),
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
        v.id, v.name,
        v.commission_percent,
        count(o.order_id)                                              AS orders,
        coalesce(sum(o.subtotal), 0)                                   AS gross,
        coalesce(sum(o.delivery_fee), 0)                               AS delivery_fees,
        coalesce(sum(o.commission_amount), 0)                          AS commission,
        coalesce(sum(o.subtotal + o.delivery_fee - o.commission_amount), 0) AS payout
      FROM vendors v
      LEFT JOIN orders o
        ON o.vendor_id = v.id AND o.status = 'delivered'
       AND o.created_at >= p_from AND o.created_at < p_to
      GROUP BY v.id, v.name, v.commission_percent
    ) t
  )
);
$$;

-- ----------------------------------------------------------------------------
-- 3. VERIFICATION
-- ----------------------------------------------------------------------------
SELECT count(*) AS accounting_functions
FROM pg_proc WHERE proname IN ('vendor_accounting', 'platform_accounting');
