const guard = require('../lib/guard');
const supabase = require('../lib/supabase');
const crypto = require('crypto');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!guard(req, res)) return;

  try {
    const token = req.query.token || (req.body || {}).token;
    const session = await validateAdminSession(token);
    if (!session) return res.status(401).json({ error: 'Unauthorized' });

    if (req.method === 'GET') {
      const { action } = req.query;

      if (action === 'stats') {
        const [vendorsRes, ordersRes] = await Promise.all([
          supabase.from('vendors').select('id, is_active'),
          supabase.from('orders').select('total, status, vendor_id, created_at')
        ]);
        const vendors = vendorsRes.data || [];
        const orders = ordersRes.data || [];
        return res.json({
          vendors_total: vendors.length,
          vendors_active: vendors.filter(v => v.is_active).length,
          orders_total: orders.length,
          orders_pending: orders.filter(o => o.status === 'pending').length,
          revenue_total: orders.reduce((s, o) => s + Number(o.total || 0), 0)
        });
      }

      if (action === 'vendors') {
        const { data, error } = await supabase
          .from('vendors')
          .select('*, categories(name, icon)')
          .order('created_at', { ascending: false });
        if (error) throw error;
        return res.json(data);
      }

      if (action === 'categories') {
        const { data, error } = await supabase
          .from('categories')
          .select('*')
          .order('sort_order');
        if (error) throw error;
        return res.json(data);
      }

      if (action === 'offers') {
        const { data, error } = await supabase
          .from('offers')
          .select('*, vendors(name)')
          .order('created_at', { ascending: false });
        if (error) throw error;
        return res.json(data);
      }

      if (action === 'orders') {
        const { data, error } = await supabase
          .from('orders')
          .select('order_id, vendor_id, customer_name, customer_phone, total, status, payment_method, payment_status, utr, commission_amount, created_at')
          .order('created_at', { ascending: false })
          .limit(100);
        if (error) throw error;
        return res.json(data);
      }

      if (action === 'accounting') {
        const { from, to } = period(req.query.days);
        const { data, error } = await supabase.rpc('platform_accounting', { p_from: from, p_to: to });
        if (error) throw error;
        return res.json(data);
      }

      if (action === 'pending-payments') {
        const { data, error } = await supabase
          .from('orders')
          .select('order_id, vendor_id, customer_name, customer_phone, total, status, utr, created_at')
          .eq('payment_status', 'Pending Verification')
          .neq('status', 'cancelled')
          .order('created_at', { ascending: false });
        if (error) throw error;
        return res.json(data);
      }

      return res.status(400).json({ error: 'Invalid action' });
    }

    if (req.method === 'POST') {
      const { action } = req.body;

      // ---------- Vendors ----------
      if (action === 'create-vendor') {
        const { vendor, password } = req.body;
        if (!vendor || !vendor.name || !vendor.email || !password) {
          return res.status(400).json({ error: 'Vendor name, email and password are required' });
        }
        if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

        const slug = vendor.name.toLowerCase().trim()
          .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
          + '-' + Math.random().toString(36).slice(2, 6);

        const { data: newVendor, error: vendorError } = await supabase
          .from('vendors')
          .insert({
            name: vendor.name.trim(),
            slug,
            email: vendor.email.trim().toLowerCase(),
            phone: vendor.phone || '',
            address: vendor.address || '',
            description: vendor.description || '',
            category_id: vendor.category_id || null,
            commission_percent: Number(vendor.commission_percent) || 14,
            is_active: true
          })
          .select('id')
          .single();
        if (vendorError) {
          if (vendorError.code === '23505') return res.status(400).json({ error: 'A vendor with this email already exists' });
          throw vendorError;
        }

        const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
        const { error: userError } = await supabase
          .from('vendor_users')
          .insert({
            vendor_id: newVendor.id,
            email: vendor.email.trim().toLowerCase(),
            password_hash: passwordHash,
            role: 'owner',
            is_active: true
          });
        if (userError) throw userError;

        return res.json({ success: true, id: newVendor.id });
      }

      if (action === 'update-vendor') {
        const { vendorId, fields } = req.body;
        if (!vendorId || !fields) return res.status(400).json({ error: 'vendorId and fields required' });

        const allowed = {};
        for (const k of ['name', 'phone', 'address', 'description', 'category_id', 'commission_percent', 'is_active']) {
          if (k in fields) allowed[k] = fields[k];
        }
        allowed.updated_at = new Date().toISOString();

        const { error } = await supabase.from('vendors').update(allowed).eq('id', vendorId);
        if (error) throw error;
        return res.json({ success: true });
      }

      if (action === 'reset-vendor-password') {
        const { vendorId, password } = req.body;
        if (!vendorId || !password || password.length < 6) {
          return res.status(400).json({ error: 'vendorId and a password of at least 6 characters required' });
        }
        const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
        const { error } = await supabase
          .from('vendor_users')
          .update({ password_hash: passwordHash })
          .eq('vendor_id', vendorId);
        if (error) throw error;
        return res.json({ success: true });
      }

      // Merchant Partnership Agreement + KYC/compliance record (admin-managed).
      // Also updates the shop category when sent, since the required documents
      // are category-driven (Food → FSSAI, Electronics → BIS + E-Waste, …).
      if (action === 'save-vendor-agreement') {
        const { vendorId } = req.body;
        if (!vendorId) return res.status(400).json({ error: 'vendorId required' });
        const update = {
          compliance: sanitizeCompliance(req.body.agreement || {}),
          updated_at: new Date().toISOString()
        };
        if ('categoryId' in req.body) update.category_id = req.body.categoryId || null;
        const { error } = await supabase.from('vendors').update(update).eq('id', vendorId);
        if (error) throw error;
        return res.json({ success: true });
      }

      if (action === 'create-offer') {
        const o = req.body.offer || {};
        if (!o.name || !String(o.name).trim()) return res.status(400).json({ error: 'Offer name required.' });
        if (!['percent', 'flat'].includes(o.discount_type)) return res.status(400).json({ error: 'Invalid discount type.' });
        const v = Number(o.discount_value);
        if (!Number.isFinite(v) || v <= 0) return res.status(400).json({ error: 'Discount value must be greater than 0.' });
        if (o.discount_type === 'percent' && v > 90) return res.status(400).json({ error: 'Percent discount cannot exceed 90%.' });
        if (!o.valid_from || !o.valid_to || new Date(o.valid_to) <= new Date(o.valid_from)) {
          return res.status(400).json({ error: 'End date must be after the start date.' });
        }

        const { error } = await supabase.from('offers').insert({
          vendor_id: o.vendor_id || null,            // null = all shops
          name: String(o.name).trim().slice(0, 80),
          description: String(o.description || '').trim().slice(0, 200),
          discount_type: o.discount_type,
          discount_value: v,
          max_discount: o.max_discount ? Number(o.max_discount) : null,
          min_order: Number(o.min_order) || 0,
          valid_from: new Date(o.valid_from).toISOString(),
          valid_to: new Date(o.valid_to).toISOString(),
          max_uses: o.max_uses ? parseInt(o.max_uses, 10) : null,
          created_by: 'admin'
        });
        if (error) throw error;
        return res.json({ success: true });
      }

      if (action === 'toggle-offer') {
        const { error } = await supabase
          .from('offers').update({ active: req.body.active === true }).eq('id', req.body.offerId);
        if (error) throw error;
        return res.json({ success: true });
      }

      if (action === 'delete-offer') {
        const { error } = await supabase.from('offers').delete().eq('id', req.body.offerId);
        if (error) throw error;
        return res.json({ success: true });
      }

      if (action === 'set-delivery-pin') {
        const pin = String(req.body.pin || '').trim();
        if (!/^\d{4,8}$/.test(pin)) return res.status(400).json({ error: 'PIN must be 4–8 digits.' });
        const { error } = await supabase
          .from('platform_settings')
          .upsert({ key: 'delivery_pin', value: pin, updated_at: new Date().toISOString() });
        if (error) throw error;
        return res.json({ success: true });
      }

      if (action === 'verify-payment') {
        const { orderId, utr } = req.body;
        if (!orderId) return res.status(400).json({ error: 'orderId required' });

        const { data, error } = await supabase.rpc('verify_payment', {
          p_order_id: orderId,
          p_utr: String(utr || '').trim()
        });
        if (error) return res.status(400).json({ error: error.message });
        return res.json(data);
      }

      // ---------- Categories ----------
      if (action === 'create-category') {
        const { name, icon } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ error: 'Category name required' });

        const { error } = await supabase
          .from('categories')
          .insert({ name: name.trim(), icon: (icon || '🛍️').trim(), is_active: true });
        if (error) {
          if (error.code === '23505') return res.status(400).json({ error: 'This category already exists' });
          throw error;
        }
        return res.json({ success: true });
      }

      if (action === 'update-category') {
        const { categoryId, fields } = req.body;
        if (!categoryId || !fields) return res.status(400).json({ error: 'categoryId and fields required' });

        const allowed = {};
        for (const k of ['name', 'icon', 'sort_order', 'is_active']) {
          if (k in fields) allowed[k] = fields[k];
        }
        const { error } = await supabase.from('categories').update(allowed).eq('id', categoryId);
        if (error) throw error;
        return res.json({ success: true });
      }

      if (action === 'delete-category') {
        const { categoryId } = req.body;
        if (!categoryId) return res.status(400).json({ error: 'categoryId required' });

        // Detach vendors first so the FK doesn't block deletion
        await supabase.from('vendors').update({ category_id: null }).eq('category_id', categoryId);
        const { error } = await supabase.from('categories').delete().eq('id', categoryId);
        if (error) throw error;
        return res.json({ success: true });
      }

      return res.status(400).json({ error: 'Invalid action' });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

function period(days) {
  const to = new Date(Date.now() + 60 * 1000).toISOString();
  if (days === '0') {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    return { from: start.toISOString(), to };
  }
  const n = parseInt(days, 10);
  if (Number.isFinite(n) && n > 0) {
    return { from: new Date(Date.now() - n * 86400000).toISOString(), to };
  }
  return { from: '2000-01-01T00:00:00Z', to };
}

async function validateAdminSession(token) {
  if (!token) return null;
  const { data } = await supabase
    .from('admin_sessions')
    .select('admin_id, expires_at')
    .eq('token', token)
    .single();
  if (!data) return null;
  if (new Date(data.expires_at) < new Date()) return null;
  return data;
}

// ---- Merchant agreement / KYC sanitiser: only known keys, bounded lengths,
//      enum-checked statuses. The whole record lives in vendors.compliance. ----
// Master list of every document type the UI may submit (category-dependent).
const KYC_DOC_KEYS = ['gstin', 'pan', 'aadhaar', 'ownership', 'udyam', 'items_list', 'fssai', 'bis', 'epr', 'cdsco', 'drug_license'];
const KYC_STATUSES = ['Pending', 'Submitted', 'Verified', 'Rejected', 'N/A'];
const AGREEMENT_STATUSES = ['Draft', 'Active', 'Expired', 'Terminated'];
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

function sanitizeCompliance(a) {
  const ag = a.agreement || {}, bank = a.bank || {}, docs = a.documents || {}, pol = a.policies || {};
  const out = { agreement: {}, bank: {}, documents: {}, policies: {} };

  out.agreement = {
    status: AGREEMENT_STATUSES.includes(ag.status) ? ag.status : 'Draft',
    start_date: clip(ag.start_date, 20),
    end_date: clip(ag.end_date, 20),
    signed_on: clip(ag.signed_on, 20),
    notes: clip(ag.notes, 2000)
  };

  out.bank = {
    holder: clip(bank.holder, 120),
    account_number: clip(bank.account_number, 34).replace(/\s+/g, ''),
    ifsc: clip(bank.ifsc, 15).toUpperCase(),
    bank_name: clip(bank.bank_name, 120),
    status: KYC_STATUSES.includes(bank.status) ? bank.status : 'Pending',
    note: clip(bank.note, 500)
  };

  // Store only the documents actually submitted (category-specific set),
  // ignoring any unknown keys.
  for (const k of Object.keys(docs)) {
    if (!KYC_DOC_KEYS.includes(k)) continue;
    const d = docs[k] || {};
    out.documents[k] = {
      number: clip(d.number, 80),
      status: KYC_STATUSES.includes(d.status) ? d.status : 'Pending',
      url: clip(d.url, 500),
      note: clip(d.note, 500)
    };
  }

  out.policies = {
    return: clip(pol.return, 3000),
    cancellation: clip(pol.cancellation, 3000),
    delivery: clip(pol.delivery, 3000)
  };

  return out;
}
