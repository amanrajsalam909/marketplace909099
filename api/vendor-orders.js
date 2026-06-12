const guard = require('../lib/guard');
const supabase = require('../lib/supabase');
const { sendStatusUpdate, sendDeliveryOtp } = require('../lib/email');
const crypto = require('crypto');

const STALE_PENDING_MS = 60 * 60 * 1000;   // unconfirmed for 1h → auto-cancel
const DELIVERY_OTP_TTL_MS = 60 * 60 * 1000;

async function issueDeliveryOtp(orderId, customerEmail) {
  const otp = String(crypto.randomInt(100000, 1000000));
  await supabase.from('delivery_otps').upsert({
    order_id: orderId, otp, attempts: 0,
    expires_at: new Date(Date.now() + DELIVERY_OTP_TTL_MS).toISOString(),
    created_at: new Date().toISOString()
  });
  await sendDeliveryOtp(customerEmail, orderId, otp);
}

// Lazy stale sweep — safe to run concurrently because cancel_order re-checks
// the order status under a row lock; a second sweep simply errors and skips.
async function sweepStalePending(vendorId) {
  const cutoff = new Date(Date.now() - STALE_PENDING_MS).toISOString();
  const { data: stale } = await supabase
    .from('orders')
    .select('order_id, customer_email')
    .eq('vendor_id', vendorId)
    .eq('status', 'pending')
    .lt('created_at', cutoff)
    .limit(20);

  for (const ord of stale || []) {
    const { error } = await supabase.rpc('cancel_order', {
      p_order_id: ord.order_id, p_actor: 'system',
      p_reason: 'Auto-cancelled: shop did not confirm within 1 hour'
    });
    if (!error) sendStatusUpdate(ord.customer_email, ord.order_id, 'cancelled').catch(() => {});
  }
}

// Status changes are delegated to database state-machine functions
// (advance_order_status / cancel_order): transitions are validated and
// audit-logged atomically; cancellation restores stock in the same transaction.
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!guard(req, res)) return;

  try {
    const token = req.query.token || (req.body || {}).token;
    const session = await validateVendorSession(token);
    if (!session) return res.status(401).json({ error: 'Unauthorized' });

    if (req.method === 'GET') {
      const { status } = req.query;

      await sweepStalePending(session.vendor_id).catch(() => {});

      let query = supabase
        .from('orders')
        .select('order_id, status, customer_name, customer_phone, delivery_address, items_json, subtotal, delivery_fee, total, payment_method, payment_status, commission_amount, created_at, updated_at')
        .eq('vendor_id', session.vendor_id);

      if (status) query = query.eq('status', status);

      const { data, error } = await query.order('created_at', { ascending: false }).limit(200);
      if (error) throw error;

      // Attach delivery proof IDs so vendors see the full handover record
      const deliveredIds = data.filter(o => o.status === 'delivered').map(o => o.order_id);
      const proofs = {};
      if (deliveredIds.length) {
        const { data: evs } = await supabase
          .from('order_events')
          .select('order_id, note, created_at')
          .eq('event', 'delivery_verified')
          .in('order_id', deliveredIds);
        (evs || []).forEach(ev => { proofs[ev.order_id] = { note: ev.note, at: ev.created_at }; });
      }

      return res.json(data.map(o => ({
        ...o,
        items: typeof o.items_json === 'string' ? JSON.parse(o.items_json) : (o.items_json || []),
        delivery_proof: proofs[o.order_id]?.note || null,
        delivered_at: proofs[o.order_id]?.at || null
      })));
    }

    if (req.method === 'POST') {
      const { action, orderId, newStatus, reason } = req.body;
      if (!orderId) return res.status(400).json({ error: 'Order ID required' });

      // Ownership check: a vendor may only touch their own orders
      const { data: order } = await supabase
        .from('orders')
        .select('vendor_id, customer_email')
        .eq('order_id', orderId)
        .single();
      if (!order || order.vendor_id !== session.vendor_id) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const actor = 'vendor:' + session.vendor_id;

      if (action === 'update-status') {
        if (!newStatus) return res.status(400).json({ error: 'New status required' });

        // Delivery requires the customer's OTP — use verify-delivery instead
        if (newStatus === 'delivered') {
          return res.status(400).json({ error: 'OTP_REQUIRED' });
        }

        const { data, error } = await supabase.rpc('advance_order_status', {
          p_order_id: orderId,
          p_new_status: newStatus,
          p_actor: actor
        });
        if (error) return res.status(400).json({ error: error.message });

        // Going out for delivery issues the customer's handover OTP
        if (newStatus === 'ready') {
          issueDeliveryOtp(orderId, order.customer_email).catch(() => {});
        }
        if (['confirmed', 'ready'].includes(newStatus)) {
          sendStatusUpdate(order.customer_email, orderId, newStatus).catch(() => {});
        }
        return res.json(data);
      }

      // Delivery completion lives in the delivery partner panel (/delivery.html);
      // vendors hand over at "ready" and the delivery API takes it from there.

      if (action === 'cancel') {
        const { data, error } = await supabase.rpc('cancel_order', {
          p_order_id: orderId,
          p_actor: actor,
          p_reason: String(reason || '').slice(0, 300)
        });
        if (error) return res.status(400).json({ error: error.message });

        sendStatusUpdate(order.customer_email, orderId, 'cancelled').catch(() => {});
        return res.json(data);
      }

      return res.status(400).json({ error: 'Invalid action' });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

async function validateVendorSession(token) {
  if (!token) return null;
  const { data } = await supabase
    .from('vendor_sessions')
    .select('vendor_id, expires_at')
    .eq('token', token)
    .single();
  if (!data) return null;
  if (new Date(data.expires_at) < new Date()) return null;
  return data;
}
