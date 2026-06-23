const guard = require('../lib/guard');
const supabase = require('../lib/supabase');
const { findSession, getToken } = require('../lib/sessions');

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!guard(req, res)) return;

  try {
    const token = getToken(req);
    const session = await validateVendorSession(token);
    if (!session) return res.status(401).json({ error: 'Unauthorized' });

    if (req.method === 'GET') {
      if (req.query.offers) {
        const { data, error } = await supabase
          .from('offers')
          .select('*')
          .eq('vendor_id', session.vendor_id)
          .order('created_at', { ascending: false });
        if (error) throw error;
        return res.json(data);
      }

      const { data, error } = await supabase
        .from('vendors')
        .select('name, phone, address, description, logo_url, is_open, open_time, close_time, open_days, delivery_fee, delivery_eta_mins, min_order, accepts_cod, upi_id, commission_percent')
        .eq('id', session.vendor_id)
        .single();
      if (error) throw error;
      return res.json(data);
    }

    if (req.method === 'POST') {
      const { action } = req.body || {};

      // ----- Offer management (own shop only) -----
      if (action === 'create-offer') {
        const err = validateOffer(req.body.offer);
        if (err) return res.status(400).json({ error: err });
        const o = req.body.offer;

        const { error } = await supabase.from('offers').insert({
          vendor_id: session.vendor_id,
          name: String(o.name).trim().slice(0, 80),
          description: String(o.description || '').trim().slice(0, 200),
          discount_type: o.discount_type,
          discount_value: Number(o.discount_value),
          max_discount: o.max_discount ? Number(o.max_discount) : null,
          min_order: Number(o.min_order) || 0,
          valid_from: new Date(o.valid_from).toISOString(),
          valid_to: new Date(o.valid_to).toISOString(),
          max_uses: o.max_uses ? parseInt(o.max_uses, 10) : null,
          created_by: 'vendor'
        });
        if (error) throw error;
        return res.json({ success: true });
      }

      if (action === 'toggle-offer' || action === 'delete-offer') {
        const { data: offer } = await supabase
          .from('offers').select('vendor_id').eq('id', req.body.offerId).single();
        if (!offer || offer.vendor_id !== session.vendor_id) {
          return res.status(403).json({ error: 'Forbidden' });
        }
        if (action === 'toggle-offer') {
          const { error } = await supabase
            .from('offers').update({ active: req.body.active === true }).eq('id', req.body.offerId);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('offers').delete().eq('id', req.body.offerId);
          if (error) throw error;
        }
        return res.json({ success: true });
      }

      const f = (req.body || {}).fields || {};
      const updates = {};

      if ('is_open' in f) updates.is_open = f.is_open === true;
      if ('accepts_cod' in f) updates.accepts_cod = f.accepts_cod === true;

      if ('open_time' in f) {
        if (f.open_time === '' || f.open_time === null) updates.open_time = null;
        else if (TIME_RE.test(f.open_time)) updates.open_time = f.open_time;
        else return res.status(400).json({ error: 'Opening time must be HH:MM.' });
      }
      if ('close_time' in f) {
        if (f.close_time === '' || f.close_time === null) updates.close_time = null;
        else if (TIME_RE.test(f.close_time)) updates.close_time = f.close_time;
        else return res.status(400).json({ error: 'Closing time must be HH:MM.' });
      }
      // Hours must be set as a pair, and open strictly before close
      const ot = 'open_time' in updates ? updates.open_time : undefined;
      const ct = 'close_time' in updates ? updates.close_time : undefined;
      if (ot !== undefined || ct !== undefined) {
        if ((ot === null) !== (ct === null)) {
          return res.status(400).json({ error: 'Set both opening and closing time, or clear both for 24×7.' });
        }
        if (ot && ct && ot >= ct) {
          return res.status(400).json({ error: 'Opening time must be before closing time.' });
        }
      }

      if ('open_days' in f) {
        const days = String(f.open_days || '')
          .split(',').map(s => s.trim()).filter(s => /^[0-6]$/.test(s));
        if (!days.length) return res.status(400).json({ error: 'Select at least one open day.' });
        updates.open_days = [...new Set(days)].sort().join(',');
      }

      if ('delivery_fee' in f) {
        const v = Number(f.delivery_fee);
        if (!Number.isFinite(v) || v < 0 || v > 500) return res.status(400).json({ error: 'Delivery fee must be between ₹0 and ₹500.' });
        updates.delivery_fee = Math.round(v * 100) / 100;
      }
      if ('min_order' in f) {
        const v = Number(f.min_order);
        if (!Number.isFinite(v) || v < 0 || v > 100000) return res.status(400).json({ error: 'Minimum order must be a valid amount.' });
        updates.min_order = Math.round(v * 100) / 100;
      }
      if ('delivery_eta_mins' in f) {
        const v = Number(f.delivery_eta_mins);
        if (!Number.isInteger(v) || v < 5 || v > 1440) return res.status(400).json({ error: 'Delivery time must be between 5 and 1440 minutes.' });
        updates.delivery_eta_mins = v;
      }
      if ('upi_id' in f) {
        const v = String(f.upi_id || '').trim();
        if (v && !/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(v)) return res.status(400).json({ error: 'UPI ID looks invalid (expected like shop@upi).' });
        updates.upi_id = v || null;
      }
      if ('phone' in f) updates.phone = String(f.phone || '').trim();
      if ('address' in f) updates.address = String(f.address || '').trim();
      if ('description' in f) updates.description = String(f.description || '').trim();
      if ('logo_url' in f) {
        const v = String(f.logo_url || '').trim().slice(0, 500);
        if (v && !/^https?:\/\/.+/i.test(v)) return res.status(400).json({ error: 'Logo must be a valid http(s) image URL.' });
        updates.logo_url = v || null;
      }

      if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update.' });
      updates.updated_at = new Date().toISOString();

      const { error } = await supabase.from('vendors').update(updates).eq('id', session.vendor_id);
      if (error) throw error;
      return res.json({ success: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

function validateOffer(o) {
  if (!o || !o.name || !String(o.name).trim()) return 'Offer name is required.';
  if (!['percent', 'flat'].includes(o.discount_type)) return 'Discount type must be percent or flat.';
  const v = Number(o.discount_value);
  if (!Number.isFinite(v) || v <= 0) return 'Discount value must be greater than 0.';
  if (o.discount_type === 'percent' && v > 90) return 'Percent discount cannot exceed 90%.';
  if (o.max_discount && (!Number.isFinite(Number(o.max_discount)) || Number(o.max_discount) <= 0)) return 'Max discount must be a positive amount.';
  if (!o.valid_from || !o.valid_to) return 'Start and end dates are required.';
  if (new Date(o.valid_to) <= new Date(o.valid_from)) return 'End date must be after the start date.';
  if (o.max_uses && (!Number.isInteger(Number(o.max_uses)) || Number(o.max_uses) <= 0)) return 'Max uses must be a positive whole number.';
  return null;
}

async function validateVendorSession(token) {
  if (!token) return null;
  const data = await findSession('vendor_sessions', token, 'vendor_id, expires_at');
  if (!data) return null;
  if (new Date(data.expires_at) < new Date()) return null;
  return data;
}
