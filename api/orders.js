const guard = require('../lib/guard');
const supabase = require('../lib/supabase');
const { sendOrderConfirmation, sendVendorNotification } = require('../lib/email');
const crypto = require('crypto');

// The checkout pipeline lives in the database (place_marketplace_order RPC):
// one atomic transaction covering stock locking, validation, pricing,
// commission snapshot, audit logging and customer CRM. This handler only
// validates shape, invokes it, and sends emails afterwards.
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!guard(req, res)) return;

  try {
    if (req.method === 'GET') {
      // Customer order lookup: requires order ID + matching phone
      const { orderId, phone } = req.query;
      if (!orderId || !phone) {
        return res.status(400).json({ error: 'Order ID and phone number required' });
      }
      const norm = String(phone).replace(/\D/g, '').slice(-10);

      const { data, error } = await supabase
        .from('orders')
        .select('order_id, status, items_json, subtotal, delivery_fee, total, payment_method, payment_status, delivery_address, created_at, updated_at')
        .eq('order_id', orderId)
        .eq('customer_phone', norm)
        .single();

      if (error || !data) return res.status(404).json({ error: 'Order not found' });
      return res.json(data);
    }

    if (req.method === 'POST') {
      const { action } = req.body || {};

      if (action === 'place') {
        const { items, customer, payment_method, utr, idempotency_key } = req.body;

        if (!Array.isArray(items) || !items.length) {
          return res.status(400).json({ error: 'Your cart is empty.' });
        }
        if (!customer || typeof customer !== 'object') {
          return res.status(400).json({ error: 'Customer details are required.' });
        }

        // Server only forwards product ids + quantities; the database is the
        // single source of truth for prices, vendors, fees and stock.
        const lines = items.map(i => ({
          id: i.id,
          qty: Math.trunc(Number(i.qty ?? i.quantity)) || 0
        }));
        if (lines.some(l => !l.id || l.qty < 1)) {
          return res.status(400).json({ error: 'Invalid items in cart.' });
        }

        const idemKey = (typeof idempotency_key === 'string' && idempotency_key.length >= 16)
          ? idempotency_key
          : crypto.randomBytes(16).toString('hex');

        const { data, error } = await supabase.rpc('place_marketplace_order', {
          p_customer: {
            name: String(customer.name || '').trim(),
            phone: String(customer.phone || '').trim(),
            email: String(customer.email || '').trim().toLowerCase(),
            address: String(customer.address || '').trim()
          },
          p_items: lines,
          p_payment_method: payment_method === 'UPI' ? 'UPI' : 'COD',
          p_utr: String(utr || '').trim(),
          p_idempotency_key: idemKey
        });

        if (error) {
          // RAISE EXCEPTION messages from the pipeline are customer-readable
          return res.status(400).json({ error: error.message });
        }

        // Post-transaction side effects (never block or fail the order)
        if (!data.duplicate) {
          notifyByEmail(data.orders, customer).catch(e => console.error('email failed:', e.message));
        }

        return res.json(data);
      }

      return res.status(400).json({ error: 'Invalid action' });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

async function notifyByEmail(orders, customer) {
  for (const o of orders || []) {
    const { data: rows } = await supabase
      .from('order_items')
      .select('product_name, qty, unit_price, line_total')
      .eq('order_id', o.order_id);
    const items = (rows || []).map(r => ({ name: r.product_name, quantity: r.qty, price: r.unit_price }));

    await sendOrderConfirmation(customer.email, {
      order_id: o.order_id, items, total: o.total, status: 'pending'
    }).catch(() => {});

    const { data: vendor } = await supabase
      .from('vendors').select('email, name').eq('id', o.vendor_id).single();
    if (vendor) {
      await sendVendorNotification(vendor.email, {
        order_id: o.order_id, items, total: o.total,
        customer_name: customer.name, customer_phone: customer.phone,
        delivery_address: customer.address
      }, vendor.name).catch(() => {});
    }
  }
}
