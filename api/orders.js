const guard = require('../lib/guard');
const supabase = require('../lib/supabase');
const { sendOrderConfirmation, sendVendorNotification, sendStatusUpdate } = require('../lib/email');
const { validateCustomerSession } = require('./customer-auth');
const { getToken } = require('../lib/sessions');
const crypto = require('crypto');

const CUSTOMER_CANCEL_WINDOW_MS = 10 * 60 * 1000;

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
      // Logged-in customer: list my orders
      if (req.query.myOrders) {
        const session = await validateCustomerSession(getToken(req));
        if (!session) return res.status(401).json({ error: 'Not logged in.' });

        const { data } = await supabase
          .from('orders')
          .select('order_id, status, subtotal, delivery_fee, discount_amount, offer_name, total, payment_method, payment_status, items_json, created_at, vendors(name)')
          .eq('customer_phone', session.phone)
          .order('created_at', { ascending: false })
          .limit(50);
        return res.json(data || []);
      }

      // Delivery OTP for the tracking page — ONLY the logged-in order owner
      // may see it (otherwise the delivery partner could read it themselves
      // and fake the handover).
      if (req.query.deliveryOtp) {
        const ordId = req.query.deliveryOtp;
        const { data: ord } = await supabase
          .from('orders')
          .select('order_id, status, customer_phone')
          .eq('order_id', ordId)
          .single();
        if (!ord || ord.status !== 'ready') return res.json({ available: false });

        const session = await validateCustomerSession(getToken(req));
        if (!session) return res.json({ authRequired: true });
        if (session.phone !== ord.customer_phone) return res.json({ notOwner: true });

        const { data: otpRow } = await supabase
          .from('delivery_otps')
          .select('otp, expires_at')
          .eq('order_id', ordId)
          .single();
        if (!otpRow || new Date(otpRow.expires_at) < new Date()) {
          return res.json({ available: false });
        }
        return res.json({ available: true, otp: otpRow.otp });
      }

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
          qty: Math.trunc(Number(i.qty ?? i.quantity)) || 0,
          specs: sanitizeSpecs(i.specs)
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
            address: String(customer.address || '').trim(),
            address_parts: sanitizeAddressParts(customer.address_parts)
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

      // Customer self-cancellation: own order, still pending, within 10 minutes
      if (action === 'cancel') {
        const session = await validateCustomerSession(getToken(req));
        if (!session) return res.status(401).json({ error: 'Please sign in to cancel an order.' });

        const { orderId } = req.body;
        const { data: ord } = await supabase
          .from('orders')
          .select('order_id, status, customer_phone, customer_email, created_at')
          .eq('order_id', orderId)
          .single();

        if (!ord || ord.customer_phone !== session.phone) {
          return res.status(404).json({ error: 'Order not found.' });
        }
        if (ord.status !== 'pending') {
          return res.status(400).json({ error: `This order is already ${ord.status} and can no longer be cancelled. Contact the shop for help.` });
        }
        if (Date.now() - new Date(ord.created_at).getTime() > CUSTOMER_CANCEL_WINDOW_MS) {
          return res.status(400).json({ error: 'The 10-minute cancellation window has closed. Contact the shop for help.' });
        }

        // Atomic: re-checks status under lock, restores stock, audit-logs
        const { data, error } = await supabase.rpc('cancel_order', {
          p_order_id: orderId, p_actor: 'customer', p_reason: 'Cancelled by customer'
        });
        if (error) return res.status(400).json({ error: error.message });

        sendStatusUpdate(ord.customer_email, orderId, 'cancelled').catch(() => {});
        return res.json(data);
      }

      return res.status(400).json({ error: 'Invalid action' });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// Structured Indian address fields (flat/house, building, street, area,
// landmark, city, PIN) — stored as JSONB so the delivery panel can show
// labelled fields. Returns null when nothing usable was sent.
function sanitizeAddressParts(p) {
  if (!p || typeof p !== 'object') return null;
  const f = k => String(p[k] || '').trim().slice(0, 120);
  const out = {
    flat: f('flat'), building: f('building'), street: f('street'),
    area: f('area'), landmark: f('landmark'), city: f('city'),
    pin: f('pin').replace(/\D/g, '').slice(0, 6)
  };
  return Object.values(out).some(Boolean) ? out : null;
}

// The customer's chosen spec values for a cart line: a flat { label: value }
// map (e.g. { Size: 'M', Colour: 'Red' }). Bounded and string-coerced so only
// clean data reaches the order. Returns null when there's nothing usable.
function sanitizeSpecs(specs) {
  if (!specs || typeof specs !== 'object' || Array.isArray(specs)) return null;
  const out = {};
  for (const [k, v] of Object.entries(specs)) {
    const label = String(k).trim().slice(0, 60);
    const value = String(v).trim().slice(0, 120);
    if (label && value) out[label] = value;
    if (Object.keys(out).length >= 30) break;
  }
  return Object.keys(out).length ? out : null;
}

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
