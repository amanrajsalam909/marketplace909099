const guard = require('../lib/guard');
const supabase = require('../lib/supabase');
const { sendLoginOtp } = require('../lib/email');
const crypto = require('crypto');

const OTP_EXPIRY_MS = 15 * 60 * 1000;
const SESSION_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;

const ADDRESS_LABELS = ['Home', 'Office', 'Other'];

// Same field shape the checkout stores in orders.address_json
function sanitizeAddress(p) {
  if (!p || typeof p !== 'object') return null;
  const f = k => String(p[k] || '').trim().slice(0, 120);
  const a = {
    flat: f('flat'), building: f('building'), street: f('street'),
    area: f('area'), landmark: f('landmark'), city: f('city'),
    pin: f('pin').replace(/\D/g, '').slice(0, 6)
  };
  if (!a.flat || !a.area || !a.city || !/^[1-9]\d{5}$/.test(a.pin)) return null;
  return a;
}

function normalizePhone(phone) {
  phone = String(phone || '').trim().replace(/[\s\-()]/g, '');
  if (phone.startsWith('+91')) phone = phone.slice(3);
  else if (phone.startsWith('91') && phone.length === 12) phone = phone.slice(2);
  if (!/^\d{10}$/.test(phone)) throw new Error('Please enter a valid 10-digit mobile number.');
  return phone;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!guard(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, phone, email, otp, token } = req.body || {};

  try {
    if (action === 'send-otp') {
      const nPhone = normalizePhone(phone);
      const nEmail = String(email || '').trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(nEmail)) {
        return res.json({ success: false, error: 'Please enter a valid email address.' });
      }

      // 60s cooldown, derived from the stored expiry — no extra column needed
      const { data: existing } = await supabase
        .from('otp_sessions').select('expires_at').eq('phone', nPhone).single();
      if (existing) {
        const sentAt = new Date(existing.expires_at).getTime() - OTP_EXPIRY_MS;
        const elapsed = Date.now() - sentAt;
        if (elapsed < RESEND_COOLDOWN_MS) {
          return res.json({ success: false, error: `Please wait ${Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000)}s before requesting a new code.` });
        }
      }

      const code = String(crypto.randomInt(100000, 1000000)); // crypto-grade randomness
      await supabase.from('otp_sessions').upsert({
        phone: nPhone, email: nEmail, otp: code, attempts: 0,
        expires_at: new Date(Date.now() + OTP_EXPIRY_MS).toISOString(),
        created_at: new Date().toISOString()
      });

      await sendLoginOtp(nEmail, code);
      return res.json({ success: true });
    }

    if (action === 'verify-otp') {
      const nPhone = normalizePhone(phone);
      if (!otp) return res.json({ success: false, error: 'Please enter the code.' });

      const { data: row } = await supabase
        .from('otp_sessions').select('otp, email, attempts, expires_at').eq('phone', nPhone).single();
      if (!row) return res.json({ success: false, error: 'No code found. Please request a new one.' });

      if (new Date(row.expires_at) < new Date()) {
        await supabase.from('otp_sessions').delete().eq('phone', nPhone);
        return res.json({ success: false, error: 'Code expired. Please request a new one.' });
      }
      // Brute-force protection the old system lacked
      if (row.attempts >= MAX_VERIFY_ATTEMPTS) {
        await supabase.from('otp_sessions').delete().eq('phone', nPhone);
        return res.json({ success: false, error: 'Too many wrong attempts. Please request a new code.' });
      }
      if (String(otp).trim() !== String(row.otp)) {
        await supabase.from('otp_sessions').update({ attempts: row.attempts + 1 }).eq('phone', nPhone);
        return res.json({ success: false, error: `Incorrect code. ${MAX_VERIFY_ATTEMPTS - row.attempts - 1} attempt(s) left.` });
      }

      await supabase.from('otp_sessions').delete().eq('phone', nPhone);

      const { data: customer } = await supabase
        .from('customers').select('name').eq('phone', nPhone).single();

      const sessionToken = crypto.randomBytes(32).toString('hex');
      await supabase.from('customer_sessions').insert({
        token: sessionToken, phone: nPhone, email: row.email,
        name: customer?.name || null,
        expires_at: new Date(Date.now() + SESSION_EXPIRY_MS).toISOString()
      });

      return res.json({ success: true, token: sessionToken, phone: nPhone, email: row.email, name: customer?.name || '' });
    }

    if (action === 'validate') {
      const session = await validateCustomerSession(token);
      return res.json({ valid: !!session, ...(session || {}) });
    }

    // ----- Address book: Home / Office / Other slots on the customer row -----
    if (action === 'get-addresses') {
      const session = await validateCustomerSession(token);
      if (!session) return res.status(401).json({ error: 'Session expired — please sign in again.' });
      const { data } = await supabase
        .from('customers').select('addresses').eq('phone', session.phone).single();
      return res.json({ addresses: (data && data.addresses) || {} });
    }

    if (action === 'save-address' || action === 'delete-address') {
      const session = await validateCustomerSession(token);
      if (!session) return res.status(401).json({ error: 'Session expired — please sign in again.' });
      const label = String(req.body.label || '');
      if (!ADDRESS_LABELS.includes(label)) {
        return res.status(400).json({ error: 'Label must be Home, Office or Other.' });
      }

      const { data: cust } = await supabase
        .from('customers').select('id, addresses').eq('phone', session.phone).single();
      const book = (cust && cust.addresses) || {};

      if (action === 'save-address') {
        const a = sanitizeAddress(req.body.address);
        if (!a) return res.status(400).json({ error: 'Flat/house, area, city and a valid 6-digit PIN are required.' });
        book[label] = a;
      } else {
        delete book[label];
      }

      if (cust) {
        const { error } = await supabase
          .from('customers').update({ addresses: book }).eq('phone', session.phone);
        if (error) throw error;
      } else {
        // Signed in but never ordered: the customers row doesn't exist yet
        const { error } = await supabase.from('customers').insert({
          phone: session.phone, email: session.email, name: session.name || '',
          total_orders: 0, total_spent: 0, addresses: book
        });
        if (error) throw error;
      }
      return res.json({ success: true, addresses: book });
    }

    if (action === 'logout') {
      if (token) await supabase.from('customer_sessions').delete().eq('token', token);
      return res.json({ success: true });
    }

    res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

async function validateCustomerSession(token) {
  if (!token) return null;
  const { data } = await supabase
    .from('customer_sessions')
    .select('phone, email, name, expires_at')
    .eq('token', token)
    .single();
  if (!data) return null;
  if (new Date(data.expires_at) < new Date()) return null;
  return data;
}

module.exports.validateCustomerSession = validateCustomerSession;
