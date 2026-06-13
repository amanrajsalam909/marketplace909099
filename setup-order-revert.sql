-- ============================================================================
--  RajkotMarket — Vendor "Undo" / revert order status
--  Lets a vendor move an order BACK one step to correct a mistake. The forward
--  state machine (advance_order_status) blocks backward moves, so this is a
--  separate, deliberately-narrow RPC:
--      confirmed → pending
--      preparing → confirmed
--      ready     → preparing
--  Terminal states (delivered, cancelled) and 'pending' cannot be reverted.
--  Stock and payment are NOT touched — only the workflow status moves back —
--  so a revert is always safe to run.
--  Every revert is written to order_events as 'status_revert' for the audit log.
--  Safe to re-run: yes
-- ============================================================================

CREATE OR REPLACE FUNCTION revert_order_status(
  p_order_id TEXT,
  p_actor    TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ord  RECORD;
  v_prev TEXT;
BEGIN
  SELECT * INTO v_ord FROM orders WHERE order_id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found.';
  END IF;

  v_prev := CASE v_ord.status
    WHEN 'confirmed' THEN 'pending'
    WHEN 'preparing' THEN 'confirmed'
    WHEN 'ready'     THEN 'preparing'
    ELSE NULL
  END;

  IF v_prev IS NULL THEN
    RAISE EXCEPTION 'This order is % and cannot be moved back.', v_ord.status;
  END IF;

  UPDATE orders
     SET status     = v_prev,
         updated_at = now()
   WHERE order_id = p_order_id;

  INSERT INTO order_events (order_id, actor, event, from_status, to_status, note)
  VALUES (p_order_id, p_actor, 'status_revert', v_ord.status, v_prev, 'Moved back one step');

  RETURN jsonb_build_object('success', true, 'from', v_ord.status, 'to', v_prev);
END;
$$;

-- VERIFICATION — expect revert_function = 1
SELECT count(*) AS revert_function
FROM pg_proc WHERE proname = 'revert_order_status';
