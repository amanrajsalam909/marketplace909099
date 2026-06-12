const guard = require('../lib/guard');
const supabase = require('../lib/supabase');
const crypto = require('crypto');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!guard(req, res)) return;

  try {
    const { action, email, password, token, vendorId } = req.body || {};

    if (action === 'login') {
      if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

      const { data: vendor, error: vendorError } = await supabase
        .from('vendors')
        .select('id, name, email')
        .eq('email', email)
        .single();

      if (vendorError || !vendor) return res.status(401).json({ error: 'Invalid credentials' });

      const { data: user, error: userError } = await supabase
        .from('vendor_users')
        .select('password_hash')
        .eq('vendor_id', vendor.id)
        .eq('email', email)
        .single();

      if (userError || !user) return res.status(401).json({ error: 'Invalid credentials' });

      const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
      if (user.password_hash !== passwordHash) return res.status(401).json({ error: 'Invalid credentials' });

      const sessionToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const { error: sessionError } = await supabase
        .from('vendor_sessions')
        .insert({ token: sessionToken, vendor_id: vendor.id, expires_at: expiresAt });

      if (sessionError) throw sessionError;

      return res.json({ success: true, token: sessionToken, vendor });
    }

    if (action === 'validate') {
      if (!token) return res.status(401).json({ error: 'Unauthorized' });

      const { data, error } = await supabase
        .from('vendor_sessions')
        .select('vendor_id, expires_at')
        .eq('token', token)
        .single();

      if (error || !data) return res.status(401).json({ error: 'Unauthorized' });
      if (new Date(data.expires_at) < new Date()) return res.status(401).json({ error: 'Session expired' });

      const { data: vendor } = await supabase
        .from('vendors')
        .select('id, name, email')
        .eq('id', data.vendor_id)
        .single();

      return res.json({ valid: true, vendor });
    }

    if (action === 'logout') {
      if (!token) return res.status(400).json({ error: 'Token required' });

      await supabase.from('vendor_sessions').delete().eq('token', token);
      return res.json({ success: true });
    }

    res.status(400).json({ error: 'Invalid action' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
