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
        .select('*, product_variants(specs, stock)')
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
        mrp: (product.mrp !== undefined && product.mrp !== null && product.mrp !== '')
          ? (parseFloat(product.mrp) || null) : null,
        stock: Math.max(0, Math.trunc(Number(product.stock)) || 0),
        image_url: product.imageUrl || product.image_url || '',
        active: product.active !== false,
        spec_template_id: product.spec_template_id || null,
        specs: Array.isArray(product.specs) ? product.specs : []
      };

      // Per-variant stock (size × colour). When the product tracks variants,
      // products.stock becomes the cached SUM of the variant stocks.
      const variants = sanitizeVariants(product.variants);
      if (variants) {
        p.stock = variants.reduce((s, v) => s + v.stock, 0);
      }

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
        if (variants) await writeVariants(product.id, variants);
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
      if (variants) await writeVariants(data.id, variants);
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

// Sanitise the vendor-submitted variant grid into [{specs:{label:value}, stock}].
// Returns null when the product is not variant-tracked (no array sent), so the
// caller leaves products.stock as the single value. An empty array clears them.
function sanitizeVariants(input) {
  if (!Array.isArray(input)) return null;
  const out = [];
  const seen = new Set();
  for (const v of input) {
    if (!v || typeof v !== 'object' || !v.specs || typeof v.specs !== 'object') continue;
    const specs = {};
    for (const [k, val] of Object.entries(v.specs)) {
      const label = String(k).trim().slice(0, 60);
      const value = String(val).trim().slice(0, 120);
      if (label && value) specs[label] = value;
      if (Object.keys(specs).length >= 30) break;
    }
    if (!Object.keys(specs).length) continue;
    // De-dupe by canonical key set so two identical combos can't both insert.
    const key = JSON.stringify(Object.keys(specs).sort().map(k => [k, specs[k]]));
    if (seen.has(key)) continue;
    seen.add(key);
    const stock = Math.max(0, Math.trunc(Number(v.stock)) || 0);
    out.push({ specs, stock });
    if (out.length >= 300) break;
  }
  return out;
}

// Replace a product's variant rows with the submitted set (delete-then-insert).
async function writeVariants(productId, variants) {
  await supabase.from('product_variants').delete().eq('product_id', productId);
  if (!variants.length) return;
  const rows = variants.map(v => ({ product_id: productId, specs: v.specs, stock: v.stock }));
  const { error } = await supabase.from('product_variants').insert(rows);
  if (error) throw error;
}

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
