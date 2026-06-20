const guard = require('../lib/guard');
const supabase = require('../lib/supabase');
const crypto = require('crypto');
const { verifyPassword, hashPassword } = require('../lib/password');
const { checkBlocked, recordFailure, clearFailures } = require('../lib/throttle');
const { newSessionToken, findSession, deleteSession, getToken } = require('../lib/sessions');

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

      const throttleId = 'admin:' + String(email).trim().toLowerCase();
      const block = await checkBlocked(throttleId);
      if (block.blocked) {
        return res.status(429).json({ error: `Too many attempts. Please try again in ${Math.ceil(block.retryAfter / 60)} minute(s).` });
      }

      const { data: admin } = await supabase
        .from('admin_users')
        .select('id, email, password_hash, is_active')
        .eq('email', email)
        .single();

      if (!admin || !admin.is_active) { await recordFailure(throttleId); return res.status(401).json({ error: 'Invalid credentials' }); }

      const { ok, needsRehash } = await verifyPassword(password, admin.password_hash);
      if (!ok) { await recordFailure(throttleId); return res.status(401).json({ error: 'Invalid credentials' }); }

      if (needsRehash) {
        const newHash = await hashPassword(password);
        await supabase.from('admin_users').update({ password_hash: newHash }).eq('id', admin.id);
      }
      await clearFailures(throttleId);

      const { token: sessionToken, stored } = newSessionToken();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      // Single session per account: drop any other active sessions first.
      await supabase.from('admin_sessions').delete().eq('admin_id', admin.id);

      const { error: sessionError } = await supabase
        .from('admin_sessions')
        .insert({ token: stored, admin_id: admin.id, expires_at: expiresAt });
      if (sessionError) throw sessionError;

      await supabase.from('admin_users').update({ last_login: new Date().toISOString() }).eq('id', admin.id);

      return res.json({ success: true, token: sessionToken, admin: { email: admin.email } });
    }

    if (action === 'validate') {
      const session = await validateAdminSession(getToken(req));
      if (!session) return res.status(401).json({ error: 'Unauthorized' });
      return res.json({ valid: true });
    }

    if (action === 'change-password') {
      const session = await validateAdminSession(getToken(req));
      if (!session) return res.status(401).json({ error: 'Unauthorized' });
      if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

      const passwordHash = await hashPassword(password);
      const { error } = await supabase
        .from('admin_users')
        .update({ password_hash: passwordHash })
        .eq('id', session.admin_id);
      if (error) throw error;
      return res.json({ success: true });
    }

    if (action === 'logout') {
      await deleteSession('admin_sessions', getToken(req));
      return res.json({ success: true });
    }

    res.status(400).json({ error: 'Invalid action' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

async function validateAdminSession(token) {
  if (!token) return null;
  const data = await findSession('admin_sessions', token, 'admin_id, expires_at');
  if (!data) return null;
  if (new Date(data.expires_at) < new Date()) return null;
  return data;
}
