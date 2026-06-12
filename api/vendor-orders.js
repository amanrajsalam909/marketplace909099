const guard = require('../lib/guard');
const supabase = require('../lib/supabase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!guard(req, res)) return;

  try {
    const { token, status } = req.query;

    if (req.method === 'GET') {
      if (!token) return res.status(401).json({ error: 'Unauthorized' });

      const session = await validateVendorSession(token);
      if (!session) return res.status(401).json({ error: 'Unauthorized' });

      let query = supabase
        .from('orders')
        .select('*')
        .eq('vendor_id', session.vendor_id);

      if (status) {
        query = query.eq('status', status);
      }

      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) throw error;

      const formattedOrders = data.map(order => ({
        ...order,
        items: order.items_json ? JSON.parse(order.items_json) : []
      }));

      return res.json(formattedOrders);
    }

    if (req.method === 'POST') {
      const { action, orderId, newStatus } = req.body;

      if (!token) return res.status(401).json({ error: 'Unauthorized' });

      const session = await validateVendorSession(token);
      if (!session) return res.status(401).json({ error: 'Unauthorized' });

      if (action === 'update-status') {
        if (!orderId || !newStatus) return res.status(400).json({ error: 'Order ID and status required' });

        const { data: order } = await supabase
          .from('orders')
          .select('vendor_id')
          .eq('order_id', orderId)
          .single();

        if (!order || order.vendor_id !== session.vendor_id) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        const { error } = await supabase
          .from('orders')
          .update({ status: newStatus, updated_at: new Date().toISOString() })
          .eq('order_id', orderId);

        if (error) throw error;
        return res.json({ success: true });
      }

      res.status(400).json({ error: 'Invalid action' });
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
