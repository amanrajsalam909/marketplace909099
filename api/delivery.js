const guard = require('../lib/guard');
const supabase = require('../lib/supabase');
const { sendStatusUpdate, sendDeliveryOtp } = require('../lib/email');
const crypto = require('crypto');

const MAX_OTP_ATTEMPTS = 5;
const DELIVERY_OTP_TTL_MS = 60 * 60 * 1000;

// Unambiguous alphabet (no I/O/0/1) for delivery proof IDs
function deliveryProofId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = 'DLV-';
  for (let i = 0; i < 8; i++) id += chars[crypto.randomInt(chars.length)];
  return id;
}

async function verifyPin(pin) {
  const { data } = await supabase
    .from('platform_settings').select('value').eq('key', 'delivery_pin').single();
  return String(pin || '') === String(data?.value || '5678');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!guard(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, pin, orderId, otp } = req.body || {};

  try {
    if (!(await verifyPin(pin))) return res.status(401).json({ error: 'Wrong PIN' });

    // Active deliveries: everything currently out for delivery
    if (action === 'get-orders') {
      const { data } = await supabase
        .from('orders')
        .select('order_id, customer_name, customer_phone, delivery_address, total, payment_method, payment_status, created_at, vendors(name)')
        .eq('status', 'ready')
        .order('created_at', { ascending: true });
      return res.json(data || []);
    }

    // COD: cash must be collected BEFORE the handover code is accepted
    if (action === 'collect-cash') {
      const { data: ord } = await supabase
        .from('orders').select('payment_method, payment_status, status').eq('order_id', orderId).single();
      if (!ord) return res.status(404).json({ error: 'Order not found.' });
      if (ord.payment_method !== 'COD') return res.status(400).json({ error: 'Not a COD order.' });
      if (ord.status !== 'ready') return res.status(400).json({ error: 'Order is not out for delivery.' });
      if (ord.payment_status === 'Collected') return res.json({ success: true, already: true });

      await supabase.from('orders')
        .update({ payment_status: 'Collected', updated_at: new Date().toISOString() })
        .eq('order_id', orderId);
      await supabase.from('order_events').insert({
        order_id: orderId, actor: 'delivery', event: 'cash_collected'
      });
      return res.json({ success: true });
    }

    if (action === 'verify-delivery') {
      const given = String(otp || '').trim();
      if (!given) return res.status(400).json({ error: 'Enter the customer\'s delivery code.' });

      const { data: ord } = await supabase
        .from('orders')
        .select('payment_method, payment_status, customer_email')
        .eq('order_id', orderId).single();
      if (!ord) return res.status(404).json({ error: 'Order not found.' });

      // The cash-first rule
      if (ord.payment_method === 'COD' && ord.payment_status !== 'Collected') {
        return res.status(400).json({ error: 'Collect the cash first, then ask for the code.' });
      }

      const { data: row } = await supabase
        .from('delivery_otps').select('otp, attempts, expires_at').eq('order_id', orderId).single();
      if (!row) return res.status(400).json({ error: 'No delivery code found — tap "Resend code" first.' });
      if (new Date(row.expires_at) < new Date()) {
        return res.status(400).json({ error: 'The code expired — resend a fresh one.' });
      }
      if (row.attempts >= MAX_OTP_ATTEMPTS) {
        return res.status(400).json({ error: 'Too many wrong attempts — resend a fresh code.' });
      }
      if (given !== String(row.otp)) {
        await supabase.from('delivery_otps').update({ attempts: row.attempts + 1 }).eq('order_id', orderId);
        return res.status(400).json({ error: `Wrong code. ${MAX_OTP_ATTEMPTS - row.attempts - 1} attempt(s) left.` });
      }

      // State machine does the actual transition (atomic, audit-logged)
      const { data, error } = await supabase.rpc('advance_order_status', {
        p_order_id: orderId, p_new_status: 'delivered', p_actor: 'delivery'
      });
      if (error) return res.status(400).json({ error: error.message });

      const proofId = deliveryProofId();
      await supabase.from('delivery_otps').delete().eq('order_id', orderId);
      await supabase.from('order_events').insert({
        order_id: orderId, actor: 'delivery', event: 'delivery_verified',
        note: 'OTP verified | Proof: ' + proofId
      });

      sendStatusUpdate(ord.customer_email, orderId, 'delivered').catch(() => {});
      return res.json({ success: true, proofId });
    }

    if (action === 'resend-otp') {
      const { data: ord } = await supabase
        .from('orders').select('status, customer_email').eq('order_id', orderId).single();
      if (!ord || ord.status !== 'ready') {
        return res.status(400).json({ error: 'Order is not out for delivery.' });
      }
      const code = String(crypto.randomInt(100000, 1000000));
      await supabase.from('delivery_otps').upsert({
        order_id: orderId, otp: code, attempts: 0,
        expires_at: new Date(Date.now() + DELIVERY_OTP_TTL_MS).toISOString(),
        created_at: new Date().toISOString()
      });
      await sendDeliveryOtp(ord.customer_email, orderId, code);
      return res.json({ success: true });
    }

    // Today's completed deliveries — proof ID, time, address
    if (action === 'get-completed') {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const { data: orders } = await supabase
        .from('orders')
        .select('order_id, customer_name, delivery_address, total, payment_method, updated_at, vendors(name)')
        .eq('status', 'delivered')
        .gte('updated_at', startOfDay.toISOString())
        .order('updated_at', { ascending: false });

      const ids = (orders || []).map(o => o.order_id);
      const proofs = {};
      if (ids.length) {
        const { data: evs } = await supabase
          .from('order_events')
          .select('order_id, note, created_at')
          .eq('event', 'delivery_verified')
          .in('order_id', ids);
        (evs || []).forEach(e => {
          const m = /Proof:\s*(\S+)/.exec(e.note || '');
          proofs[e.order_id] = { proof: m ? m[1] : '', at: e.created_at };
        });
      }
      return res.json((orders || []).map(o => ({
        ...o,
        proof_id: proofs[o.order_id]?.proof || '',
        delivered_at: proofs[o.order_id]?.at || o.updated_at
      })));
    }

    res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
