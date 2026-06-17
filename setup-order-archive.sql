-- ============================================================================
--  RajkotMarket — Order archive / storage-cycle cleanup
--  ------------------------------------------------------------------------
--  Adds an `archived_at` marker plus a transactional "slim" function used by
--  the nightly /api/cleanup job AFTER it has backed each delivered order up to
--  Google Drive as a JSON file.
--
--  Strategy (option B — "keep it working"): we KEEP the small orders row so
--  accounting (vendor_accounting / platform_accounting read subtotal,
--  delivery_fee, commission_amount, total, payment_method, status) and the
--  product reviews (FK → orders.order_id) keep working forever. Only the heavy
--  parts are removed: the normalised line items, the event-log rows, and the
--  bulky JSON/address columns on the order itself.
--
--  Safe to re-run: yes
-- ============================================================================

-- 1. Marker so an order is archived at most once and stays out of future runs.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- 2. Indexes for the nightly detection queries.
--    a) find orders whose 'delivered' event is older than the cutoff
CREATE INDEX IF NOT EXISTS idx_order_events_delivered
  ON order_events (created_at) WHERE to_status = 'delivered';
--    b) narrow to un-archived delivered orders
CREATE INDEX IF NOT EXISTS idx_orders_archive
  ON orders (status, archived_at);

-- 3. Transactional slim: remove the heavy children + null the bulky columns,
--    keeping the financial/status fields. Idempotent (only touches rows that
--    are not yet archived) and atomic (all-or-nothing in one transaction).
CREATE OR REPLACE FUNCTION archive_slim_orders(p_order_ids TEXT[])
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  DELETE FROM order_items   WHERE order_id = ANY(p_order_ids);
  DELETE FROM order_events  WHERE order_id = ANY(p_order_ids);
  DELETE FROM delivery_otps WHERE order_id = ANY(p_order_ids);

  UPDATE orders
     SET items_json       = NULL,
         address_json     = NULL,
         delivery_address = '[purged]',
         archived_at      = now()
   WHERE order_id = ANY(p_order_ids)
     AND archived_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- 4. VERIFICATION
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'orders' AND column_name = 'archived_at')      AS has_archived_at_col,
  (SELECT count(*) FROM pg_proc WHERE proname = 'archive_slim_orders') AS has_slim_fn;
