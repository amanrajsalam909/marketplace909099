const guard = require('../lib/guard');
const supabase = require('../lib/supabase');
const crypto = require('crypto');
const { verifyPassword, hashPassword } = require('../lib/password');
const { checkBlocked, recordFailure, clearFailures } = require('../lib/throttle');

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

      const throttleId = 'vendor:' + String(email).trim().toLowerCase();
      const block = await checkBlocked(throttleId);
      if (block.blocked) {
        return res.status(429).json({ error: `Too many attempts. Please try again in ${Math.ceil(block.retryAfter / 60)} minute(s).` });
      }

      const { data: vendor, error: vendorError } = await supabase
        .from('vendors')
        .select('id, name, email')
        .eq('email', email)
        .single();

      if (vendorError || !vendor) { await recordFailure(throttleId); return res.status(401).json({ error: 'Invalid credentials' }); }

      const { data: user, error: userError } = await supabase
        .from('vendor_users')
        .select('password_hash')
        .eq('vendor_id', vendor.id)
        .eq('email', email)
        .single();

      if (userError || !user) { await recordFailure(throttleId); return res.status(401).json({ error: 'Invalid credentials' }); }

      const { ok, needsRehash } = await verifyPassword(password, user.password_hash);
      if (!ok) { await recordFailure(throttleId); return res.status(401).json({ error: 'Invalid credentials' }); }

      // Silent upgrade of a legacy sha256 hash to bcrypt — invisible to the user.
      if (needsRehash) {
        const newHash = await hashPassword(password);
        await supabase.from('vendor_users').update({ password_hash: newHash })
          .eq('vendor_id', vendor.id).eq('email', email);
      }
      await clearFailures(throttleId);

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
