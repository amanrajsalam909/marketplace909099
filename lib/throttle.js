// Invisible brute-force throttle for PASSWORD logins (admin + vendor).
//
// A legitimate user typing their correct password NEVER hits this — it only
// bites after many wrong guesses in a row, then asks the attacker to wait.
// Customers are unaffected (they log in by OTP, not password).
//
// State lives in the `login_attempts` table (see setup-login-throttle.sql).
// Everything here is FAIL-OPEN: if the table is missing or the DB errors, we
// allow the login rather than lock people out. The throttle is a safety net,
// not a gate.

const supabase = require('./supabase');

const MAX_FAILS = 10;                       // allowed wrong attempts before a block
const BLOCK_MS = 15 * 60 * 1000;            // how long the block lasts
const WINDOW_MS = 15 * 60 * 1000;           // failures older than this don't count

// identifier should be stable per principal, e.g. `vendor:alice@x.com`.
async function checkBlocked(identifier) {
  try {
    const { data } = await supabase
      .from('login_attempts')
      .select('blocked_until')
      .eq('identifier', identifier)
      .single();
    if (data && data.blocked_until && new Date(data.blocked_until) > new Date()) {
      const retryAfter = Math.ceil((new Date(data.blocked_until) - Date.now()) / 1000);
      return { blocked: true, retryAfter };
    }
  } catch (_) { /* fail-open */ }
  return { blocked: false, retryAfter: 0 };
}

async function recordFailure(identifier) {
  try {
    const { data } = await supabase
      .from('login_attempts')
      .select('fails, updated_at')
      .eq('identifier', identifier)
      .single();

    const fresh = data && (Date.now() - new Date(data.updated_at).getTime()) < WINDOW_MS;
    const fails = (fresh ? data.fails : 0) + 1;
    const blocked_until = fails >= MAX_FAILS ? new Date(Date.now() + BLOCK_MS).toISOString() : null;

    await supabase
      .from('login_attempts')
      .upsert({ identifier, fails, blocked_until, updated_at: new Date().toISOString() });
  } catch (_) { /* fail-open */ }
}

async function clearFailures(identifier) {
  try {
    await supabase.from('login_attempts').delete().eq('identifier', identifier);
  } catch (_) { /* ignore */ }
}

module.exports = { checkBlocked, recordFailure, clearFailures, MAX_FAILS };
