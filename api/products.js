const guard = require('../lib/guard');
const supabase = require('../lib/supabase');
const { findSession, getToken } = require('../lib/sessions');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!guard(req, res)) return;

  try {
    if (req.method === 'GET') {
      const { vendorId } = req.query;

      let query = supabase
        .from('products')
        .select('*')
        .eq('active', true);

      if (vendorId) {
        query = query.eq('vendor_id', vendorId);
      }

      const { data, error } = await query.order('category').order('name');
      if (error) throw error;
      return res.json(data);
    }

    if (req.method === 'POST') {
      const { token, product } = req.body;
      const session = await validateVendorSession(getToken(req));
      if (!session) return res.status(401).json({ error: 'Unauthorized' });

      const p = {
        vendor_id: session.vendor_id,
        name: product.name,
        category: product.category || '',
        description: product.description || '',
        price: parseFloat(product.price) || 0,
        stock: Math.max(0, Math.trunc(Number(product.stock)) || 0),
        image_url: product.imageUrl || product.image_url || '',
        active: product.active !== false
      };

      // Optional vendor-supplied product number (5-char base36). When omitted,
      // the DB default (gen_product_no) assigns a unique one automatically.
      const code = String(product.product_no || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
      if (code) {
        if (code.length !== 5) {
          return res.status(400).json({ error: 'Product number must be exactly 5 letters or numbers (A–Z, 0–9).' });
        }
        p.product_no = code;
      }

      if (product.id) {
        const { data: existing } = await supabase
          .from('products')
          .select('vendor_id')
          .eq('id', product.id)
          .single();

        if (!existing || existing.vendor_id !== session.vendor_id) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        const { error } = await supabase
          .from('products')
          .update(p)
          .eq('id', product.id);
        if (error) {
          if (isDupCode(error)) return res.status(400).json({ error: 'That product number is already in use — pick another.' });
          throw error;
        }
        return res.json({ success: true, id: product.id });
      }

      const { data, error } = await supabase
        .from('products')
        .insert(p)
        .select('id, product_no')
        .single();
      if (error) {
        if (isDupCode(error)) return res.status(400).json({ error: 'That product number is already in use — pick another.' });
        throw error;
      }
      return res.json({ success: true, id: data.id, product_no: data.product_no });
    }

    if (req.method === 'DELETE') {
      const { token, productId } = req.body;
      const session = await validateVendorSession(getToken(req));
      if (!session) return res.status(401).json({ error: 'Unauthorized' });

      const { data: product } = await supabase
        .from('products')
        .select('vendor_id')
        .eq('id', productId)
        .single();

      if (!product || product.vendor_id !== session.vendor_id) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', productId);
      if (error) throw error;
      return res.json({ success: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// True when a DB error is a unique-violation on the product number column.
function isDupCode(error) {
  return error && error.code === '23505' && /product_no/.test(error.message || error.details || '');
}

async function validateVendorSession(token) {
  if (!token) return null;
  const data = await findSession('vendor_sessions', token, 'vendor_id, expires_at');
  if (!data) return null;
  if (new Date(data.expires_at) < new Date()) return null;
  return data;
}
