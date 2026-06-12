const guard = require('../lib/guard');
const supabase = require('../lib/supabase');
const crypto = require('crypto');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!guard(req, res)) return;

  try {
    const { action, email, password, token } = req.body || {};

    if (action === 'login') {
      if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

      const { data: admin } = await supabase
        .from('admin_users')
        .select('id, email, password_hash, is_active')
        .eq('email', email)
        .single();

      if (!admin || !admin.is_active) return res.status(401).json({ error: 'Invalid credentials' });

      const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
      if (admin.password_hash !== passwordHash) return res.status(401).json({ error: 'Invalid credentials' });

      const sessionToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      const { error: sessionError } = await supabase
        .from('admin_sessions')
        .insert({ token: sessionToken, admin_id: admin.id, expires_at: expiresAt });
      if (sessionError) throw sessionError;

      await supabase.from('admin_users').update({ last_login: new Date().toISOString() }).eq('id', admin.id);

      return res.json({ success: true, token: sessionToken, admin: { email: admin.email } });
    }

    if (action === 'validate') {
      const session = await validateAdminSession(token);
      if (!session) return res.status(401).json({ error: 'Unauthorized' });
      return res.json({ valid: true });
    }

    if (action === 'change-password') {
      const session = await validateAdminSession(token);
      if (!session) return res.status(401).json({ error: 'Unauthorized' });
      if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

      const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
      const { error } = await supabase
        .from('admin_users')
        .update({ password_hash: passwordHash })
        .eq('id', session.admin_id);
      if (error) throw error;
      return res.json({ success: true });
    }

    if (action === 'logout') {
      if (token) await supabase.from('admin_sessions').delete().eq('token', token);
      return res.json({ success: true });
    }

    res.status(400).json({ error: 'Invalid action' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

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
