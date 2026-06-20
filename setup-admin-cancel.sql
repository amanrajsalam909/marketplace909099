-- ============================================================================
-- Admin order cancellation. Unlike the customer's cancel_order (pending/confirmed
-- only, within 10 min), the admin can cancel ANY order that isn't already
-- delivered or cancelled — restoring stock the same way. Safe to run once.
-- ============================================================================
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
  VALUES (p_order_id, 'admin', 'cancelled', v_ord.status, 'cancelled', nullif(p_reason, ''));

  RETURN jsonb_build_object('success', true);
END;
$$;
