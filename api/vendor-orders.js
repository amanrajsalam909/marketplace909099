const guard = require('../lib/guard');
const supabase = require('../lib/supabase');
const { sendStatusUpdate, sendDeliveryOtp } = require('../lib/email');
const crypto = require('crypto');

const STALE_PENDING_MS = 60 * 60 * 1000;   // unconfirmed for 1h → auto-cancel
const DELIVERY_OTP_TTL_MS = 60 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

// Unambiguous alphabet (no I/O/0/1) for delivery proof IDs
function deliveryProofId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = 'DLV-';
  for (let i = 0; i < 8; i++) id += chars[crypto.randomInt(chars.length)];
  return id;
}

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

      return res.json(data.map(o => ({
        ...o,
        items: typeof o.items_json === 'string' ? JSON.parse(o.items_json) : (o.items_json || [])
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

      if (action === 'verify-delivery') {
        const given = String(req.body.otp || '').trim();
        if (!given) return res.status(400).json({ error: 'Enter the customer\'s delivery code.' });

        const { data: row } = await supabase
          .from('delivery_otps').select('otp, attempts, expires_at').eq('order_id', orderId).single();
        if (!row) return res.status(400).json({ error: 'No delivery code found — use "Resend code" first.' });
        if (new Date(row.expires_at) < new Date()) {
          return res.status(400).json({ error: 'The delivery code expired — resend a fresh one.' });
        }
        if (row.attempts >= MAX_OTP_ATTEMPTS) {
          return res.status(400).json({ error: 'Too many wrong attempts — resend a fresh code.' });
        }
        if (given !== String(row.otp)) {
          await supabase.from('delivery_otps').update({ attempts: row.attempts + 1 }).eq('order_id', orderId);
          return res.status(400).json({ error: `Wrong code. ${MAX_OTP_ATTEMPTS - row.attempts - 1} attempt(s) left.` });
        }

        const { data, error } = await supabase.rpc('advance_order_status', {
          p_order_id: orderId, p_new_status: 'delivered', p_actor: actor
        });
        if (error) return res.status(400).json({ error: error.message });

        const proofId = deliveryProofId();
        await supabase.from('delivery_otps').delete().eq('order_id', orderId);
        await supabase.from('order_events').insert({
          order_id: orderId, actor, event: 'delivery_verified',
          note: 'OTP verified | Proof: ' + proofId
        });

        sendStatusUpdate(order.customer_email, orderId, 'delivered').catch(() => {});
        return res.json({ ...data, proofId });
      }

      if (action === 'resend-delivery-otp') {
        const { data: ord } = await supabase
          .from('orders').select('status').eq('order_id', orderId).single();
        if (!ord || ord.status !== 'ready') {
          return res.status(400).json({ error: 'Order is not out for delivery.' });
        }
        await issueDeliveryOtp(orderId, order.customer_email);
        return res.json({ success: true });
      }

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
