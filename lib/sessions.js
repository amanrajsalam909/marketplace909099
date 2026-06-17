// Session-token handling, shared by every auth path.
//
// Two goals, both invisible to users:
//  1. Tokens at rest are HASHED. We store sha256(token); the client keeps the
//     raw token. A DB read-leak therefore exposes no usable session.
//  2. getToken() reads the token from the `Authorization: Bearer` header first
//     (so it stops appearing in URLs / logs), falling back to the legacy
//     ?token= query and body.token — so older/cached clients keep working.
//
// Migration is seamless: findSession() looks up by hash first, then falls back
// to the raw token, so sessions created BEFORE this change stay valid until
// they expire on their own. Nobody is forced to log in again.

const crypto = require('crypto');
const supabase = require('./supabase');

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// Returns { token } to hand to the client and { stored } to save in the DB.
function newSessionToken() {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, stored: hashToken(token) };
}

// Look up a session row by token (hashed first, raw legacy fallback). Returns
// the selected columns or null. Caller still checks expiry.
async function findSession(table, token, columns) {
  if (!token) return null;
  let { data } = await supabase.from(table).select(columns).eq('token', hashToken(token)).maybeSingle();
  if (data) return data;
  ({ data } = await supabase.from(table).select(columns).eq('token', token).maybeSingle());
  return data || null;
}

// Delete a session by token in both forms (hashed + legacy raw).
async function deleteSession(table, token) {
  if (!token) return;
  await supabase.from(table).delete().eq('token', hashToken(token));
  await supabase.from(table).delete().eq('token', token);
}

// Extract the bearer token: Authorization header → ?token= → body.token.
function getToken(req) {
  const h = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (h && /^Bearer\s+/i.test(h)) return h.replace(/^Bearer\s+/i, '').trim();
  if (req.query && req.query.token) return req.query.token;
  if (req.body && req.body.token) return req.body.token;
  return null;
}

module.exports = { hashToken, newSessionToken, findSession, deleteSession, getToken };
