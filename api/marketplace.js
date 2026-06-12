const guard = require('../lib/guard');
const supabase = require('../lib/supabase');

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
        const { data, error } = await supabase
          .from('vendors')
          .select('id, name, slug, description, logo_url, banner_url, address, phone, is_active, category_id, categories(name, icon)')
          .eq('is_active', true)
          .order('name');

        if (error) throw error;
        return res.json(data);
      }

      if (action === 'categories') {
        const { data, error } = await supabase
          .from('categories')
          .select('id, name, icon, sort_order')
          .eq('is_active', true)
          .order('sort_order');

        if (error) throw error;
        return res.json(data);
      }

      if (action === 'products') {
        const { vendorId } = req.query;

        let query = supabase
          .from('products')
          .select('id, name, category, description, price, image_url, vendor_id, active')
          .eq('active', true);

        if (vendorId) {
          query = query.eq('vendor_id', vendorId);
        }

        const { data, error } = await query.order('category').order('name');
        if (error) throw error;
        return res.json(data);
      }

      return res.json({ action: 'marketplace', status: 'ready' });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
