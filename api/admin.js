const guard = require('../lib/guard');
const supabase = require('../lib/supabase');
const crypto = require('crypto');
const { findSession, getToken } = require('../lib/sessions');
const { hashPassword } = require('../lib/password');
const { sendStatusUpdate } = require('../lib/email');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Maintenance cron (external scheduler), authenticated by CRON_SECRET rather
  // than an admin session. Folded in here so it doesn't add a 13th Serverless
  // Function (Hobby plan allows only 12). Intercepted before guard/session.
  if (((req.query && req.query.action) || (req.body && req.body.action)) === 'cleanup') {
    return require('../lib/cleanup')(req, res);
  }

  if (!guard(req, res)) return;

  try {
    const token = getToken(req);
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

      // Delivery partners roster (never expose password_hash).
      if (action === 'delivery-partners') {
        const { data, error } = await supabase
          .from('delivery_partners')
          .select('id, name, login_id, phone, active, created_at')
          .order('created_at', { ascending: false });
        if (error) throw error;
        return res.json(data || []);
      }

      // Products with their return photo-QC flag (admin sets which items need
      // the 4-angle inspection at pickup).
      if (action === 'products') {
        const { data, error } = await supabase
          .from('products')
          .select('id, name, category, price, active, return_photo_qc, exchangeable, final_sale, vendors(name)')
          .order('name', { ascending: true });
        if (error) throw error;
        return res.json(data || []);
      }

      // ---------- Specification templates (pickable-choice specs) ----------
      if (action === 'spec-templates') {
        const { data, error } = await supabase
          .from('spec_templates')
          .select('id, name, fields, is_active, is_static, sort_order')
          .order('sort_order', { ascending: true })
          .order('name', { ascending: true });
        if (error) throw error;
        return res.json(data || []);
      }

      return res.status(400).json({ error: 'Invalid action' });
    }

    if (req.method === 'POST') {
      const { action } = req.body;

      // ---------- Delivery partners (per-account logins) ----------
      if (action === 'create-delivery-partner') {
        const name = String(req.body.name || '').trim().slice(0, 120);
        const loginId = String(req.body.loginId || '').trim().toLowerCase();
        const password = String(req.body.password || '');
        const phone = String(req.body.phone || '').replace(/\D/g, '').slice(-10);
        if (!name || !loginId || password.length < 6) {
          return res.status(400).json({ error: 'Name, login id and a password of 6+ characters are required.' });
        }
        const { error } = await supabase.from('delivery_partners').insert({
          name, login_id: loginId, phone, password_hash: await hashPassword(password)
        });
        if (error) {
          if (error.code === '23505') return res.status(400).json({ error: 'That login id is already taken.' });
          throw error;
        }
        return res.json({ success: true });
      }
      if (action === 'update-delivery-partner') {
        const upd = { updated_at: new Date().toISOString() };
        if (req.body.name !== undefined)  upd.name = String(req.body.name || '').trim().slice(0, 120);
        if (req.body.phone !== undefined) upd.phone = String(req.body.phone || '').replace(/\D/g, '').slice(-10);
        if (req.body.active !== undefined) upd.active = req.body.active === true;
        if (req.body.password) {
          if (String(req.body.password).length < 6) return res.status(400).json({ error: 'Password must be 6+ characters.' });
          upd.password_hash = await hashPassword(String(req.body.password));
        }
        // Disabling a partner also drops their active session.
        if (upd.active === false || upd.password_hash) {
          await supabase.from('delivery_sessions').delete().eq('delivery_partner_id', req.body.partnerId);
        }
        const { error } = await supabase.from('delivery_partners').update(upd).eq('id', req.body.partnerId);
        if (error) throw error;
        return res.json({ success: true });
      }

      // ---------- Cancel an order (admin override) ----------
      if (action === 'cancel-order') {
        const orderId = req.body.orderId;
        const reason = String(req.body.reason || '').trim().slice(0, 300);
        const { data: ord } = await supabase
          .from('orders').select('order_id, status, customer_email').eq('order_id', orderId).maybeSingle();
        if (!ord) return res.status(404).json({ error: 'Order not found.' });
        const { error } = await supabase.rpc('admin_cancel_order', {
          p_order_id: orderId, p_reason: reason || 'Cancelled by admin'
        });
        if (error) return res.status(400).json({ error: error.message });
        if (ord.customer_email) sendStatusUpdate(ord.customer_email, orderId, 'cancelled').catch(() => {});
        return res.json({ success: true });
      }

      // ---------- Per-product return photo-QC flag (admin only) ----------
      if (action === 'set-product-qc') {
        const { error } = await supabase
          .from('products')
          .update({ return_photo_qc: req.body.on === true, updated_at: new Date().toISOString() })
          .eq('id', req.body.productId);
        if (error) throw error;
        return res.json({ success: true });
      }

      // ---------- Per-product exchangeable (fashion) flag (admin only) ----------
      if (action === 'set-product-exchangeable') {
        const { error } = await supabase
          .from('products')
          .update({ exchangeable: req.body.on === true, updated_at: new Date().toISOString() })
          .eq('id', req.body.productId);
        if (error) throw error;
        return res.json({ success: true });
      }

      // ---------- Per-product final-sale (non-returnable/exchangeable) flag ----------
      if (action === 'set-product-final-sale') {
        const { error } = await supabase
          .from('products')
          .update({ final_sale: req.body.on === true, updated_at: new Date().toISOString() })
          .eq('id', req.body.productId);
        if (error) throw error;
        return res.json({ success: true });
      }

      // ---------- On-demand Google Drive backup ----------
      // Saves a JSON snapshot of a dataset to Drive. Read-only; never edits the
      // DB (unlike the nightly ?action=cleanup archive). Logic in lib/backup.js
      // to avoid adding a 13th Serverless Function (Hobby cap is 12).
      if (action === 'backup') {
        const result = await require('../lib/backup')(String(req.body.dataset || ''));
        return res.json({ success: true, ...result });
      }

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

      // ---------- Specification templates (pickable-choice specs) ----------
      if (action === 'save-spec-template') {
        const name = String(req.body.name || '').trim().slice(0, 120);
        if (!name) return res.status(400).json({ error: 'Template name is required.' });

        const fields = normalizeSpecFields(req.body.fields);
        if (!fields.length) {
          return res.status(400).json({ error: 'Add at least one spec field with one or more options.' });
        }

        const row = {
          name,
          fields,
          is_active: req.body.is_active !== false,
          is_static: req.body.is_static === true,
          sort_order: Math.trunc(Number(req.body.sort_order)) || 0,
          updated_at: new Date().toISOString()
        };

        if (req.body.id) {
          const { error } = await supabase.from('spec_templates').update(row).eq('id', req.body.id);
          if (error) throw error;
          return res.json({ success: true, id: req.body.id });
        }
        const { data, error } = await supabase.from('spec_templates').insert(row).select('id').single();
        if (error) throw error;
        return res.json({ success: true, id: data.id });
      }

      if (action === 'delete-spec-template') {
        const { id } = req.body;
        if (!id) return res.status(400).json({ error: 'id required' });
        // products.spec_template_id is ON DELETE SET NULL, so products keep their
        // denormalized specs snapshot and simply lose the template link.
        const { error } = await supabase.from('spec_templates').delete().eq('id', id);
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

// Sanitise an admin-submitted spec-template field list into a stable shape:
// [{key, label, options[]}]. Each field needs a label + at least one option;
// keys are slugified from the label and de-duped so the vendor/customer code
// can address fields reliably.
function normalizeSpecFields(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  const seen = new Set();
  for (const f of input) {
    if (!f || typeof f !== 'object') continue;
    const label = String(f.label || '').trim().slice(0, 60);
    if (!label) continue;

    const options = [];
    const optSeen = new Set();
    for (const o of (Array.isArray(f.options) ? f.options : [])) {
      const opt = String(o).trim().slice(0, 60);
      if (!opt) continue;
      const dedupe = opt.toLowerCase();
      if (optSeen.has(dedupe)) continue;
      optSeen.add(dedupe);
      options.push(opt);
      if (options.length >= 100) break;
    }
    if (!options.length) continue;

    let key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'field';
    let unique = key, n = 2;
    while (seen.has(unique)) unique = `${key}_${n++}`;
    seen.add(unique);

    const field = { key: unique, label, options };

    // Optional colour swatches: { "<option name>": "#rrggbb" }. Only keep
    // entries that map to a real option and a valid 6-digit hex.
    if (f.swatches && typeof f.swatches === 'object') {
      const swatches = {};
      for (const opt of options) {
        const hex = String(f.swatches[opt] || '').trim();
        if (/^#[0-9a-f]{6}$/i.test(hex)) swatches[opt] = hex.toLowerCase();
      }
      if (Object.keys(swatches).length) field.swatches = swatches;
    }

    out.push(field);
    if (out.length >= 30) break;
  }
  return out;
}

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
  const data = await findSession('admin_sessions', token, 'admin_id, expires_at');
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
