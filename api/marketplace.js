const guard = require('../lib/guard');
const supabase = require('../lib/supabase');

// Edge-cache read-only GETs on Vercel's CDN. s-maxage = how long a response is
// served fresh from the edge (no function/DB hit); stale-while-revalidate = how
// long a stale copy is served while the function refreshes in the background.
// Turns the ~0.7-1.7s function+Supabase round trip into a ~tens-of-ms CDN hit
// for the vast majority of visitors. Safe here: all of these are read-only and
// the data changes rarely (and checkout re-validates stock atomically anyway).
const edgeCache = (res, sMaxage, swr) =>
  res.setHeader('Cache-Control', `public, s-maxage=${sMaxage}, stale-while-revalidate=${swr}`);

// Vendor ids are UUIDs. Validate before interpolating into a PostgREST filter
// string (.or()) — otherwise a crafted value could alter the query.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!guard(req, res)) return;

  try {
    if (req.method === 'GET') {
      const { action } = req.query;

      if (action === 'vendors') {
        // Pull ONLY the public policies sub-object (compliance->policies), never
        // the full compliance blob — keeps KYC/bank data out of the function and
        // off the wire entirely.
        const { data, error } = await supabase
          .from('vendors')
          .select('id, name, slug, description, logo_url, banner_url, address, phone, is_active, category_id, delivery_fee, delivery_eta_mins, min_order, accepts_cod, upi_id, is_open, categories(name, icon), policies:compliance->policies')
          .eq('is_active', true)
          .order('name');

        if (error) throw error;
        const out = (data || []).map(v => ({ ...v, policies: v.policies || {} }));
        edgeCache(res, 120, 600);
        return res.json(out);
      }

      if (action === 'offers') {
        const now = new Date().toISOString();
        let query = supabase
          .from('offers')
          .select('id, vendor_id, name, description, discount_type, discount_value, max_discount, min_order, valid_to, max_uses, uses_count')
          .eq('active', true)
          .lte('valid_from', now)
          .gte('valid_to', now)
          .order('discount_value', { ascending: false });

        if (req.query.vendorId) {
          if (!UUID_RE.test(req.query.vendorId)) return res.status(400).json({ error: 'Invalid vendorId' });
          query = query.or(`vendor_id.eq.${req.query.vendorId},vendor_id.is.null`);
        }

        const { data, error } = await query;
        if (error) throw error;
        // usage-cap filter (column-to-column compare isn't supported in the query API)
        edgeCache(res, 60, 300);
        return res.json((data || []).filter(o => o.max_uses === null || o.uses_count < o.max_uses));
      }

      if (action === 'categories') {
        const { data, error } = await supabase
          .from('categories')
          .select('id, name, icon, sort_order')
          .eq('is_active', true)
          .order('sort_order');

        if (error) throw error;
        edgeCache(res, 300, 3600);
        return res.json(data);
      }

      if (action === 'spec-templates') {
        const { data, error } = await supabase
          .from('spec_templates')
          .select('id, name, fields, is_static, track_variant_stock, sort_order')
          .eq('is_active', true)
          .order('sort_order')
          .order('name');

        if (error) throw error;
        // Short TTL: admin edits to templates should reach vendors quickly.
        edgeCache(res, 30, 120);
        return res.json(data);
      }

      if (action === 'products') {
        const { vendorId } = req.query;

        let query = supabase
          .from('products')
          .select('id, name, category, description, price, stock, image_url, vendor_id, active, product_no, spec_template_id, specs, product_variants(specs, stock)')
          .eq('active', true);

        if (vendorId) {
          query = query.eq('vendor_id', vendorId);
        }

        const { data, error } = await query.order('category').order('name');
        if (error) throw error;
        // Shorter TTL — stock changes with orders. The listing can be slightly
        // stale; checkout re-checks stock atomically.
        edgeCache(res, 30, 120);
        return res.json(data);
      }

      return res.json({ action: 'marketplace', status: 'ready' });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
