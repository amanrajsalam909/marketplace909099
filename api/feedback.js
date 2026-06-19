const guard = require('../lib/guard');
const supabase = require('../lib/supabase');
const { sendComplaintAlert, sendComplaintResolution, sendReturnUpdate } = require('../lib/email');
const { validateCustomerSession } = require('./customer-auth');
const { findSession, getToken, newSessionToken, hashToken } = require('../lib/sessions');
const { hashPassword, verifyPassword } = require('../lib/password');
const { checkBlocked, recordFailure, clearFailures } = require('../lib/throttle');
const crypto = require('crypto');

const RETURN_WINDOW_DAYS = 3;
const RETURN_STATUSES = [
  'Requested', 'Approved', 'Rejected', 'Assigned', 'Picked up',
  'QC failed', 'Refunded', 'Exchange scheduled', 'Exchanged'
];
const PICKUP_OTP_TTL_MS = 24 * 60 * 60 * 1000;   // a pickup window is generous
const MAX_PICKUP_OTP_ATTEMPTS = 5;
const PARTNER_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
// Statuses where the customer should see the pickup OTP in their profile.
const OTP_VISIBLE_STATUSES = ['Assigned'];

// Reviews + complaints in one function (Vercel function budget).
// Submissions are authenticated by knowledge of order ID + matching phone —
// the same proof used by the tracking page.
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!guard(req, res)) return;

  try {
    if (req.method === 'GET') {
      // Public: approved reviews + average for one shop.
      // Scoped to PRODUCT reviews (product_id set) so the shop's overall ★ is
      // the average of its product reviews; legacy order-level rows are ignored.
      if (req.query.reviews && req.query.vendorId) {
        const { data } = await supabase
          .from('reviews')
          .select('customer_name, rating, comment, created_at')
          .eq('vendor_id', req.query.vendorId)
          .eq('approved', true)
          .not('product_id', 'is', null)
          .order('created_at', { ascending: false })
          .limit(20);
        const list = data || [];
        const avg = list.length ? Math.round(list.reduce((s, r) => s + r.rating, 0) / list.length * 10) / 10 : 0;
        return res.json({ avg, count: list.length, reviews: list });
      }

      // Public: approved reviews + average for ONE product
      if (req.query.reviews && req.query.productId) {
        const { data } = await supabase
          .from('reviews')
          .select('customer_name, rating, comment, created_at')
          .eq('product_id', req.query.productId)
          .eq('approved', true)
          .order('created_at', { ascending: false })
          .limit(20);
        const list = data || [];
        const avg = list.length ? Math.round(list.reduce((s, r) => s + r.rating, 0) / list.length * 10) / 10 : 0;
        return res.json({ avg, count: list.length, reviews: list });
      }

      // Public: bulk per-product rating summary for the storefront grid.
      // ?productRatings=1 [&vendorId=]  ->  { [productId]: { avg, count } }
      // Left uncached so a freshly submitted rating shows on the next reload.
      if (req.query.productRatings) {
        let q = supabase.from('product_ratings').select('product_id, avg_rating, review_count');
        if (req.query.vendorId) {
          const { data: prods } = await supabase
            .from('products').select('id').eq('vendor_id', req.query.vendorId);
          const ids = (prods || []).map(p => p.id);
          if (!ids.length) return res.json({});
          q = q.in('product_id', ids);
        }
        const { data } = await q;
        const map = {};
        for (const r of (data || [])) map[r.product_id] = { avg: Number(r.avg_rating), count: r.review_count };
        return res.json(map);
      }

      // Logged-in customer: their own complaints (status + resolution)
      if (req.query.myComplaints) {
        const cs = await validateCustomerSession(getToken(req));
        if (!cs) return res.status(401).json({ error: 'Not logged in.' });
        const { data } = await supabase
          .from('complaints')
          .select('order_id, subject, description, status, resolution, resolved_at, created_at')
          .eq('phone', cs.phone)
          .order('created_at', { ascending: false });
        return res.json(data || []);
      }

      // Logged-in customer: their own return requests (+ pickup OTP when one is
      // assigned — the customer reads this out to the pickup partner at the door).
      if (req.query.myReturns) {
        const cs = await validateCustomerSession(getToken(req));
        if (!cs) return res.status(401).json({ error: 'Not logged in.' });
        const { data } = await supabase
          .from('return_requests')
          .select('order_id, reason, status, resolution, admin_note, refund_amount, refund_method, created_at, updated_at')
          .eq('phone', cs.phone)
          .order('created_at', { ascending: false });
        const rows = data || [];
        const awaiting = rows.filter(r => OTP_VISIBLE_STATUSES.includes(r.status)).map(r => r.order_id);
        if (awaiting.length) {
          const { data: otps } = await supabase
            .from('return_otps').select('order_id, otp, expires_at').in('order_id', awaiting);
          const byOrder = {};
          (otps || []).forEach(o => { byOrder[o.order_id] = o; });
          rows.forEach(r => {
            const o = byOrder[r.order_id];
            if (o && new Date(o.expires_at) > new Date()) r.pickup_otp = o.otp;
          });
        }
        return res.json(rows);
      }

      // Logged-in vendor: returns for their own orders (read-only)
      if (req.query.vendorReturns) {
        const vs = await validateVendorSession(getToken(req));
        if (!vs) return res.status(401).json({ error: 'Not logged in.' });
        const { data } = await supabase
          .from('return_requests')
          .select('order_id, reason, status, admin_note, refund_amount, refund_method, created_at, updated_at')
          .eq('vendor_id', vs.vendor_id)
          .order('created_at', { ascending: false }).limit(200);
        return res.json(data || []);
      }

      // Admin: all reviews or all complaints
      const session = await validateAdminSession(getToken(req));
      if (!session) return res.status(401).json({ error: 'Unauthorized' });

      if (req.query.reviews) {
        const { data } = await supabase
          .from('reviews').select('*, vendors(name)').order('created_at', { ascending: false }).limit(200);
        return res.json(data || []);
      }
      if (req.query.complaints) {
        const { data } = await supabase
          .from('complaints').select('*, vendors(name)').order('created_at', { ascending: false }).limit(200);
        return res.json(data || []);
      }
      if (req.query.returns) {
        const { data } = await supabase
          .from('return_requests')
          .select('*, vendors(name), return_partners(name)')
          .order('created_at', { ascending: false }).limit(200);
        return res.json(data || []);
      }
      // Admin: the roster of pickup partners (never expose password_hash).
      if (req.query.partners) {
        const { data } = await supabase
          .from('return_partners')
          .select('id, name, login_id, phone, active, created_at')
          .order('created_at', { ascending: false });
        return res.json(data || []);
      }
      return res.status(400).json({ error: 'Invalid query' });
    }

    if (req.method === 'POST') {
      const { action } = req.body || {};

      // Per-product reviews: a delivered order's items are each rated. Accepts
      // the new shape { orderId, phone, items: [{productId, rating, comment}] }
      // and still tolerates the old single { rating, comment, productId }.
      if (action === 'submit-review') {
        const { orderId, phone } = req.body;
        const ord = await ownOrder(orderId, phone);
        if (!ord) return res.status(404).json({ error: 'Order not found.' });
        if (ord.status !== 'delivered') return res.status(400).json({ error: 'You can review an order once it has been delivered.' });

        let items = Array.isArray(req.body.items) ? req.body.items : null;
        if (!items && req.body.rating != null && req.body.productId) {
          items = [{ productId: req.body.productId, rating: req.body.rating, comment: req.body.comment }];
        }
        if (!items || !items.length) return res.status(400).json({ error: 'Please rate at least one product.' });

        // Only products that were actually in this order may be reviewed.
        const { data: orderItems } = await supabase
          .from('order_items').select('product_id, product_name').eq('order_id', orderId);
        const nameById = {};
        for (const it of (orderItems || [])) nameById[it.product_id] = it.product_name;

        const rows = [];
        for (const it of items) {
          const pid = it.productId;
          const r = parseInt(it.rating, 10);
          if (!pid || !(pid in nameById)) continue;   // not part of this order
          if (!r || r < 1 || r > 5) continue;          // no/invalid rating → skip this item
          rows.push({
            order_id: orderId,
            vendor_id: ord.vendor_id,
            product_id: pid,
            product_name: nameById[pid],
            customer_name: ord.customer_name,
            rating: r,
            comment: String(it.comment || '').trim().slice(0, 1000),
            approved: true   // per-product reviews show instantly (delivered+phone is the proof)
          });
        }
        if (!rows.length) return res.status(400).json({ error: 'Please select a star rating for at least one product.' });

        // Insert per-row so an already-reviewed product (unique violation on
        // order_id+product_id) is skipped without aborting the others.
        let saved = 0, skipped = 0;
        for (const row of rows) {
          const { error } = await supabase.from('reviews').insert(row);
          if (error) {
            if (error.code === '23505') { skipped++; continue; }
            throw error;
          }
          saved++;
        }
        return res.json({ success: true, saved, skipped });
      }

      if (action === 'submit-complaint') {
        const { orderId, phone, subject, description } = req.body;
        if (!subject || !String(subject).trim() || !description || !String(description).trim()) {
          return res.status(400).json({ error: 'Please fill in the subject and description.' });
        }
        const ord = await ownOrder(orderId, phone);
        if (!ord) return res.status(404).json({ error: 'Order not found.' });

        // Anti-spam: max 3 complaints per order
        const { count } = await supabase
          .from('complaints').select('id', { count: 'exact', head: true }).eq('order_id', orderId);
        if ((count || 0) >= 3) return res.status(400).json({ error: 'Complaint limit reached for this order. Please contact us by email.' });

        const complaint = {
          order_id: orderId,
          vendor_id: ord.vendor_id,
          customer_name: ord.customer_name,
          email: ord.customer_email,
          phone: ord.customer_phone,
          subject: String(subject).trim().slice(0, 150),
          description: String(description).trim().slice(0, 2000),
          status: 'Open'
        };
        const { error } = await supabase.from('complaints').insert(complaint);
        if (error) throw error;

        sendComplaintAlert(complaint).catch(() => {});
        return res.json({ success: true });
      }

      // Customer requests a return on a delivered order (within the window)
      if (action === 'submit-return') {
        const { orderId, phone, reason } = req.body;
        if (!reason || !String(reason).trim()) return res.status(400).json({ error: 'Please choose a reason for the return.' });

        const norm = String(phone || '').replace(/\D/g, '').slice(-10);
        const { data: ord } = await supabase
          .from('orders')
          .select('order_id, vendor_id, status, customer_name, customer_email, customer_phone, updated_at')
          .eq('order_id', orderId).eq('customer_phone', norm).single();
        if (!ord) return res.status(404).json({ error: 'Order not found.' });
        if (ord.status !== 'delivered') return res.status(400).json({ error: 'You can request a return only after the order is delivered.' });

        // Window starts at delivery — read the delivered event, fall back to updated_at
        const { data: ev } = await supabase
          .from('order_events').select('created_at')
          .eq('order_id', orderId).eq('to_status', 'delivered')
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        const deliveredAt = ev ? new Date(ev.created_at) : new Date(ord.updated_at);
        if (Date.now() - deliveredAt.getTime() > RETURN_WINDOW_DAYS * 86400000) {
          return res.status(400).json({ error: `The ${RETURN_WINDOW_DAYS}-day return window for this order has passed.` });
        }

        const { data: existing } = await supabase
          .from('return_requests').select('status').eq('order_id', orderId).maybeSingle();
        if (existing) return res.status(400).json({ error: 'A return is already in progress for this order.' });

        const ret = {
          order_id: orderId, vendor_id: ord.vendor_id,
          customer_name: ord.customer_name, email: ord.customer_email, phone: ord.customer_phone,
          reason: String(reason).trim().slice(0, 600), status: 'Requested'
        };
        const { error } = await supabase.from('return_requests').insert(ret);
        if (error) {
          if (error.code === '23505') return res.status(400).json({ error: 'A return is already in progress for this order.' });
          throw error;
        }
        if (ret.email) sendReturnUpdate(ret.email, ret).catch(() => {});
        return res.json({ success: true });
      }

      // ----- Return pickup partner portal (return-partner.html) -----
      // Per-partner login (id + password). Throttled like the other password
      // logins; customers are unaffected (they use OTP).
      if (action === 'rp-login') {
        const loginId = String(req.body.loginId || '').trim().toLowerCase();
        const password = String(req.body.password || '');
        if (!loginId || !password) return res.status(400).json({ error: 'Enter your login id and password.' });

        const ident = 'partner:' + loginId;
        const block = await checkBlocked(ident);
        if (block.blocked) return res.status(429).json({ error: `Too many attempts. Try again in ${Math.ceil(block.retryAfter / 60)} min.` });

        const { data: p } = await supabase
          .from('return_partners').select('*').eq('login_id', loginId).maybeSingle();
        const check = p ? await verifyPassword(password, p.password_hash) : { ok: false };
        if (!p || !p.active || !check.ok) {
          await recordFailure(ident);
          return res.status(401).json({ error: 'Wrong login id or password.' });
        }
        await clearFailures(ident);
        if (check.needsRehash) {
          await supabase.from('return_partners')
            .update({ password_hash: await hashPassword(password) }).eq('id', p.id);
        }
        const { token, stored } = newSessionToken();
        await supabase.from('partner_sessions').insert({
          token: stored, partner_id: p.id,
          expires_at: new Date(Date.now() + PARTNER_SESSION_TTL_MS).toISOString()
        });
        return res.json({ token, name: p.name });
      }

      // Everything else partner-scoped requires a valid partner session.
      if (typeof action === 'string' && action.startsWith('rp-')) {
        const partner = await validatePartnerSession(getToken(req));
        if (!partner) return res.status(401).json({ error: 'Session expired — please log in again.' });

        // Pickups assigned to THIS partner that are still open.
        if (action === 'rp-orders') {
          const { data: rets } = await supabase
            .from('return_requests')
            .select('order_id, reason, resolution, status, customer_name, phone, assigned_at')
            .eq('assigned_partner_id', partner.partner_id)
            .in('status', ['Assigned', 'Picked up'])
            .order('assigned_at', { ascending: true });
          const list = rets || [];
          const ids = list.map(r => r.order_id);
          const orders = {};
          if (ids.length) {
            const { data: ords } = await supabase
              .from('orders')
              .select('order_id, customer_name, customer_phone, delivery_address, address_json, total, items_json, vendors(name)')
              .in('order_id', ids);
            (ords || []).forEach(o => { orders[o.order_id] = o; });
          }
          return res.json(list.map(r => ({ ...r, order: orders[r.order_id] || null })));
        }

        // Verify the customer's pickup OTP at the door -> mark Picked up.
        if (action === 'rp-verify-otp') {
          const orderId = String(req.body.orderId || '');
          const given = String(req.body.otp || '').trim();
          if (!given) return res.status(400).json({ error: 'Ask the customer for the pickup code shown in their profile.' });

          const { data: ret } = await supabase
            .from('return_requests')
            .select('id, status, assigned_partner_id, order_id, email')
            .eq('order_id', orderId).maybeSingle();
          if (!ret || ret.assigned_partner_id !== partner.partner_id) {
            return res.status(404).json({ error: 'This pickup is not assigned to you.' });
          }
          if (ret.status !== 'Assigned') return res.status(400).json({ error: 'This pickup is not awaiting collection.' });

          const { data: row } = await supabase
            .from('return_otps').select('otp, attempts, expires_at').eq('order_id', orderId).maybeSingle();
          if (!row) return res.status(400).json({ error: 'No pickup code found for this order.' });
          if (new Date(row.expires_at) < new Date()) return res.status(400).json({ error: 'The pickup code expired — ask the admin to reassign.' });
          if (row.attempts >= MAX_PICKUP_OTP_ATTEMPTS) return res.status(400).json({ error: 'Too many wrong attempts on this code.' });
          if (given !== String(row.otp)) {
            await supabase.from('return_otps').update({ attempts: row.attempts + 1 }).eq('order_id', orderId);
            return res.status(400).json({ error: `Wrong code. ${MAX_PICKUP_OTP_ATTEMPTS - row.attempts - 1} attempt(s) left.` });
          }

          const { data: upd } = await supabase
            .from('return_requests')
            .update({ status: 'Picked up', picked_up_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq('id', ret.id).select('*').single();
          await supabase.from('return_otps').delete().eq('order_id', orderId);
          if (upd && upd.email) sendReturnUpdate(upd.email, upd).catch(() => {});
          return res.json({ success: true });
        }

        return res.status(400).json({ error: 'Unknown action' });
      }

      // ----- Admin moderation -----
      const session = await validateAdminSession(getToken(req));
      if (!session) return res.status(401).json({ error: 'Unauthorized' });

      if (action === 'set-review-approval') {
        const { error } = await supabase
          .from('reviews').update({ approved: req.body.approved === true }).eq('id', req.body.reviewId);
        if (error) throw error;
        return res.json({ success: true });
      }
      if (action === 'delete-review') {
        const { error } = await supabase.from('reviews').delete().eq('id', req.body.reviewId);
        if (error) throw error;
        return res.json({ success: true });
      }
      if (action === 'update-complaint') {
        const status = ['Open', 'In Progress', 'Resolved'].includes(req.body.status) ? req.body.status : 'Open';
        const { error } = await supabase.from('complaints').update({ status }).eq('id', req.body.complaintId);
        if (error) throw error;
        return res.json({ success: true });
      }

      // Record the solution and email it to the customer (the resolution is
      // delivered outside the app; the admin section drives it via this API).
      if (action === 'resolve-complaint') {
        const resolution = String(req.body.resolution || '').trim().slice(0, 2000);
        if (!resolution) return res.status(400).json({ error: 'Please write the solution to send to the customer.' });

        const { data: c } = await supabase
          .from('complaints').select('*').eq('id', req.body.complaintId).single();
        if (!c) return res.status(404).json({ error: 'Complaint not found.' });

        const { error } = await supabase
          .from('complaints')
          .update({ status: 'Resolved', resolution, resolved_at: new Date().toISOString() })
          .eq('id', req.body.complaintId);
        if (error) throw error;

        if (c.email) sendComplaintResolution(c.email, c, resolution).catch(() => {});
        return res.json({ success: true });
      }

      // Admin advances a return and emails the customer the update.
      if (action === 'update-return') {
        if (!RETURN_STATUSES.includes(req.body.status)) {
          return res.status(400).json({ error: 'Invalid return status.' });
        }
        const upd = { status: req.body.status, updated_at: new Date().toISOString() };
        if (req.body.admin_note !== undefined) upd.admin_note = String(req.body.admin_note || '').trim().slice(0, 1000);
        if (req.body.resolution === 'refund' || req.body.resolution === 'exchange') upd.resolution = req.body.resolution;
        if (req.body.status === 'Refunded') {
          upd.refund_amount = (req.body.refund_amount != null && req.body.refund_amount !== '') ? Number(req.body.refund_amount) : null;
          upd.refund_method = String(req.body.refund_method || '').trim().slice(0, 60);
        }
        const { data: r, error } = await supabase
          .from('return_requests').update(upd).eq('id', req.body.returnId).select('*').single();
        if (error) throw error;
        // On refund: restore stock + reverse commission (idempotent in the DB).
        if (req.body.status === 'Refunded' && r) {
          const { error: rpcErr } = await supabase.rpc('process_return_refund', { p_order_id: r.order_id });
          if (rpcErr) throw rpcErr;
        }
        if (r && r.email) sendReturnUpdate(r.email, r).catch(() => {});
        return res.json({ success: true });
      }

      // ----- Pickup partner roster (admin) -----
      if (action === 'create-partner') {
        const name = String(req.body.name || '').trim().slice(0, 120);
        const loginId = String(req.body.loginId || '').trim().toLowerCase();
        const password = String(req.body.password || '');
        const phone = String(req.body.phone || '').replace(/\D/g, '').slice(-10);
        if (!name || !loginId || password.length < 6) {
          return res.status(400).json({ error: 'Name, login id and a password of 6+ characters are required.' });
        }
        const { error } = await supabase.from('return_partners').insert({
          name, login_id: loginId, phone, password_hash: await hashPassword(password)
        });
        if (error) {
          if (error.code === '23505') return res.status(400).json({ error: 'That login id is already taken.' });
          throw error;
        }
        return res.json({ success: true });
      }
      if (action === 'update-partner') {
        const upd = { updated_at: new Date().toISOString() };
        if (req.body.name !== undefined)  upd.name = String(req.body.name || '').trim().slice(0, 120);
        if (req.body.phone !== undefined) upd.phone = String(req.body.phone || '').replace(/\D/g, '').slice(-10);
        if (req.body.active !== undefined) upd.active = req.body.active === true;
        if (req.body.password) {
          if (String(req.body.password).length < 6) return res.status(400).json({ error: 'Password must be 6+ characters.' });
          upd.password_hash = await hashPassword(String(req.body.password));
        }
        const { error } = await supabase.from('return_partners').update(upd).eq('id', req.body.partnerId);
        if (error) throw error;
        return res.json({ success: true });
      }

      // Assign an approved return to a partner -> generate the pickup OTP that
      // the customer will see in their profile. (Gate before the physical pickup.)
      if (action === 'assign-partner') {
        const { returnId, partnerId } = req.body;
        const { data: ret } = await supabase
          .from('return_requests').select('id, order_id, status, email').eq('id', returnId).maybeSingle();
        if (!ret) return res.status(404).json({ error: 'Return not found.' });
        if (!['Approved', 'Assigned'].includes(ret.status)) {
          return res.status(400).json({ error: 'Approve the return before assigning a pickup partner.' });
        }
        const { data: partner } = await supabase
          .from('return_partners').select('id, active').eq('id', partnerId).maybeSingle();
        if (!partner || !partner.active) return res.status(400).json({ error: 'Choose an active partner.' });

        const code = String(crypto.randomInt(100000, 1000000));
        await supabase.from('return_otps').upsert({
          order_id: ret.order_id, otp: code, attempts: 0,
          expires_at: new Date(Date.now() + PICKUP_OTP_TTL_MS).toISOString(),
          created_at: new Date().toISOString()
        });
        const { data: upd } = await supabase
          .from('return_requests')
          .update({ assigned_partner_id: partnerId, assigned_at: new Date().toISOString(),
                    status: 'Assigned', updated_at: new Date().toISOString() })
          .eq('id', returnId).select('*').single();
        if (upd && upd.email) sendReturnUpdate(upd.email, upd).catch(() => {});
        return res.json({ success: true });
      }

      return res.status(400).json({ error: 'Invalid action' });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

async function ownOrder(orderId, phone) {
  if (!orderId || !phone) return null;
  const norm = String(phone).replace(/\D/g, '').slice(-10);
  const { data } = await supabase
    .from('orders')
    .select('order_id, vendor_id, status, customer_name, customer_email, customer_phone')
    .eq('order_id', orderId)
    .eq('customer_phone', norm)
    .single();
  return data || null;
}

async function validateVendorSession(token) {
  if (!token) return null;
  const data = await findSession('vendor_sessions', token, 'vendor_id, expires_at');
  if (!data) return null;
  if (new Date(data.expires_at) < new Date()) return null;
  return data;
}

async function validateAdminSession(token) {
  if (!token) return null;
  const data = await findSession('admin_sessions', token, 'admin_id, expires_at');
  if (!data) return null;
  if (new Date(data.expires_at) < new Date()) return null;
  return data;
}

async function validatePartnerSession(token) {
  if (!token) return null;
  const data = await findSession('partner_sessions', token, 'partner_id, expires_at');
  if (!data) return null;
  if (new Date(data.expires_at) < new Date()) return null;
  return data;
}
