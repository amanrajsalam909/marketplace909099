const guard = require('../lib/guard');
const supabase = require('../lib/supabase');
const { sendStatusUpdate } = require('../lib/email');

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

        const { data, error } = await supabase.rpc('advance_order_status', {
          p_order_id: orderId,
          p_new_status: newStatus,
          p_actor: actor
        });
        if (error) return res.status(400).json({ error: error.message });

        if (['confirmed', 'ready', 'delivered'].includes(newStatus)) {
          sendStatusUpdate(order.customer_email, orderId, newStatus).catch(() => {});
        }
        return res.json(data);
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
