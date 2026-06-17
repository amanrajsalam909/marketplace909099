// Password hashing with transparent migration.
//
// Old accounts were stored as UNSALTED sha256 (fast → crackable if the DB
// leaks). We now use bcrypt. verifyPassword() accepts either format, so nobody
// has to reset anything: when a legacy sha256 hash verifies, the caller is told
// to re-hash (needsRehash) and silently upgrades the row to bcrypt on that
// login. Users keep typing the exact same password — they notice nothing.

const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const BCRYPT_ROUNDS = 12;

function sha256(pw) {
  return crypto.createHash('sha256').update(String(pw)).digest('hex');
}

// Constant-time compare of two hex strings (avoids login timing leaks).
function timingSafeHexEqual(a, b) {
  const ab = Buffer.from(String(a), 'hex');
  const bb = Buffer.from(String(b), 'hex');
  if (ab.length === 0 || ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Returns { ok, needsRehash }. needsRehash=true means a legacy hash matched and
// the caller should overwrite it with hashPassword(password).
async function verifyPassword(password, stored) {
  if (!stored) return { ok: false, needsRehash: false };
  if (typeof stored === 'string' && stored.startsWith('$2')) {
    // modern bcrypt
    const ok = await bcrypt.compare(String(password), stored).catch(() => false);
    return { ok, needsRehash: false };
  }
  // legacy unsalted sha256 (64 hex chars)
  const ok = String(stored).length === 64 && timingSafeHexEqual(sha256(password), stored);
  return { ok, needsRehash: ok };
}

async function hashPassword(password) {
  return bcrypt.hash(String(password), BCRYPT_ROUNDS);
}

module.exports = { verifyPassword, hashPassword, sha256 };
