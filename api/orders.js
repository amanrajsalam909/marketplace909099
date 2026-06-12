const guard = require('../lib/guard');
const supabase = require('../lib/supabase');
const { sendOrderConfirmation, sendVendorNotification } = require('../lib/email');
const crypto = require('crypto');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!guard(req, res)) return;

  try {
    if (req.method === 'GET') {
      const { orderId, phone } = req.query;

      // Customers can only look up their own order: order ID + matching phone required
      if (!orderId || !phone) {
        return res.status(400).json({ error: 'Order ID and phone number required' });
      }

      const { data, error } = await supabase
        .from('orders')
        .select('order_id, status, items_json, total, delivery_address, created_at, updated_at')
        .eq('order_id', orderId)
        .eq('customer_phone', phone)
        .single();

      if (error || !data) return res.status(404).json({ error: 'Order not found' });
      return res.json(data);
    }

    if (req.method === 'POST') {
      const { action, orderId, status, items, customer } = req.body;

      if (action === 'place') {
        if (!items || items.length === 0) {
          return res.status(400).json({ error: 'No items in order' });
        }

        const itemsByVendor = {};
        for (const item of items) {
          const vendorId = item.vendor_id || 'default';
          if (!itemsByVendor[vendorId]) itemsByVendor[vendorId] = [];
          itemsByVendor[vendorId].push(item);
        }

        const orders = [];
        const { data: existingCustomer } = await supabase
          .from('customers')
          .select('id')
          .eq('phone', customer.phone)
          .single();

        let customerId = existingCustomer?.id;
        if (!customerId) {
          const { data: newCustomer } = await supabase
            .from('customers')
            .insert({ phone: customer.phone, name: customer.name, email: customer.email })
            .select('id')
            .single();
          customerId = newCustomer?.id;
        }

        for (const [vendorId, vendorItems] of Object.entries(itemsByVendor)) {
          const orderId = 'ORD-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
          const itemTotal = vendorItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
          const deliveryFee = 30;
          const total = itemTotal + deliveryFee;

          const { error: orderError } = await supabase
            .from('orders')
            .insert({
              order_id: orderId,
              customer_id: customerId,
              vendor_id: vendorId === 'default' ? null : vendorId,
              items_json: JSON.stringify(vendorItems),
              total,
              status: 'pending',
              customer_phone: customer.phone,
              customer_email: customer.email,
              customer_name: customer.name,
              delivery_address: customer.address
            });

          if (orderError) throw orderError;
          orders.push({ order_id: orderId, vendor_id: vendorId, total, items: vendorItems });

          try {
            await sendOrderConfirmation(customer.email, { order_id: orderId, items: vendorItems, total, status: 'pending' });

            if (vendorId !== 'default') {
              const { data: vendor } = await supabase
                .from('vendors')
                .select('email, name')
                .eq('id', vendorId)
                .single();

              if (vendor) {
                await sendVendorNotification(vendor.email, {
                  order_id: orderId,
                  items: vendorItems,
                  total,
                  customer_name: customer.name,
                  customer_phone: customer.phone,
                  delivery_address: customer.address
                }, vendor.name);
              }
            }
          } catch (emailError) {
            console.error('Email send failed:', emailError);
          }
        }

        return res.json({ success: true, orders });
      }

      if (action === 'update-status') {
        if (!orderId || !status) return res.status(400).json({ error: 'Order ID and status required' });

        const { error } = await supabase
          .from('orders')
          .update({ status, updated_at: new Date().toISOString() })
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
