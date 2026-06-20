const guard = require('../lib/guard');
const supabase = require('../lib/supabase');
const { sendComplaintAlert, sendComplaintResolution, sendReturnUpdate } = require('../lib/email');
const { validateCustomerSession } = require('./customer-auth');
const { findSession, getToken, newSessionToken, hashToken } = require('../lib/sessions');
const { hashPassword, verifyPassword } = require('../lib/password');
const { checkBlocked, recordFailure, clearFailures } = require('../lib/throttle');
const cloudinary = require('../lib/cloudinary');
const { uploadBinaryFile } = require('../lib/drive');
const crypto = require('crypto');

const RECEIPT_MAX_BYTES = 4 * 1024 * 1024;   // raw file cap (stays under Vercel's body limit)
const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];

// QC photos live on Cloudinary for the life of the case and stay there (no
// Google Drive archival — per the chosen "Cloudinary only" storage policy).

const QC_SLOTS = ['top', 'bottom', 'left', 'right'];

// For a set of order ids, return { [orderId]: [{product_id, name}] } of the
// items whose product is flagged return_photo_qc — i.e. the items that require
// the 4-angle inspection at pickup.
async function flaggedProductsByOrder(orderIds) {
  const out = {};
  if (!orderIds.length) return out;
  const { data: items } = await supabase
    .from('order_items').select('order_id, product_id, product_name').in('order_id', orderIds);
  const pids = [...new Set((items || []).map(i => i.product_id).filter(Boolean))];
  if (!pids.length) return out;
  const { data: prods } = await supabase
    .from('products').select('id, return_photo_qc').in('id', pids);
  const flagged = new Set((prods || []).filter(p => p.return_photo_qc).map(p => p.id));
  (items || []).forEach(i => {
    if (flagged.has(i.product_id)) {
      (out[i.order_id] = out[i.order_id] || []).push({ product_id: i.product_id, name: i.product_name });
    }
  });
  return out;
}

const RETURN_WINDOW_DAYS = 3;
const EXCHANGE_WINDOW_HOURS = 48;   // fashion-only exchanges, raised within 48h of delivery
const RETURN_STATUSES = [
  'Requested', 'Approved', 'Rejected', 'Ready', 'Assigned', 'Picked up',
  'QC failed', 'Returned', 'Refunded', 'Exchange scheduled', 'Exchanged'
];

// Unambiguous alphabet (no I/O/0/1) for human-readable Exchange IDs.
function genExchangeId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const d = new Date();
  const ymd = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  let tail = '';
  for (let i = 0; i < 4; i++) tail += chars[crypto.randomInt(chars.length)];
  return `EXC-${ymd}-${tail}`;
}
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
      // Public: ids of exchange-eligible (fashion) products, so the account page
      // shows the "Exchange" option only for orders containing one.
      if (req.query.exchangeableProducts) {
        const { data } = await supabase.from('products').select('id').eq('exchangeable', true);
        return res.json((data || []).map(p => p.id));
      }
      // Public: ids of final-sale products (no return/exchange). The account page
      // hides Return/Exchange when EVERY item in an order is final-sale.
      if (req.query.finalSaleProducts) {
        const { data } = await supabase.from('products').select('id').eq('final_sale', true);
        return res.json((data || []).map(p => p.id));
      }

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
          .select('order_id, exchange_id, request_type, reason, status, resolution, admin_note, refund_amount, refund_method, refund_receipt_url, picked_up_at, created_at, updated_at')
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

      // Logged-in vendor: RETURNS to action for their shop (dispatch a pickup
      // partner, then confirm receipt). Includes the order's items + qc_status.
      if (req.query.vendorReturns) {
        const vs = await validateVendorSession(getToken(req));
        if (!vs) return res.status(401).json({ error: 'Not logged in.' });
        const { data: rows } = await supabase
          .from('return_requests')
          .select('id, order_id, reason, status, qc_status, assigned_partner_id, admin_note, refund_amount, refund_method, returned_received_at, created_at, updated_at')
          .eq('vendor_id', vs.vendor_id)
          .eq('request_type', 'return')
          .order('created_at', { ascending: false }).limit(200);
        const list = rows || [];
        const ids = list.map(r => r.order_id);
        if (ids.length) {
          const { data: items } = await supabase
            .from('order_items').select('order_id, product_id, product_name, qty').in('order_id', ids);
          const byOrder = {};
          (items || []).forEach(i => { (byOrder[i.order_id] = byOrder[i.order_id] || []).push(i); });
          list.forEach(r => { r.items = byOrder[r.order_id] || []; });
        }
        return res.json(list);
      }

      // Logged-in vendor: EXCHANGES to re-prepare for their shop. Each carries
      // the Exchange ID and the original order's items (the products to remake).
      if (req.query.vendorExchanges) {
        const vs = await validateVendorSession(getToken(req));
        if (!vs) return res.status(401).json({ error: 'Not logged in.' });
        const { data: rows } = await supabase
          .from('return_requests')
          .select('id, order_id, exchange_id, reason, status, admin_note, created_at, updated_at')
          .eq('vendor_id', vs.vendor_id)
          .eq('request_type', 'exchange')
          .order('created_at', { ascending: false }).limit(200);
        const list = rows || [];
        const ids = list.map(r => r.order_id);
        if (ids.length) {
          const { data: items } = await supabase
            .from('order_items').select('order_id, product_id, product_name, qty').in('order_id', ids);
          const byOrder = {};
          (items || []).forEach(i => { (byOrder[i.order_id] = byOrder[i.order_id] || []).push(i); });
          list.forEach(r => { r.items = byOrder[r.order_id] || []; });
        }
        return res.json(list);
      }

      // Logged-in vendor: active pickup partners to dispatch an exchange to.
      if (req.query.activePartners) {
        const vs = await validateVendorSession(getToken(req));
        if (!vs) return res.status(401).json({ error: 'Not logged in.' });
        const { data } = await supabase
          .from('return_partners').select('id, name').eq('active', true).order('name');
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
        const rows = data || [];
        // Attach QC photos (live or archived) so admin can review at Gate 3.
        const ids = rows.map(r => r.order_id);
        if (ids.length) {
          const { data: photos } = await supabase
            .from('return_photos').select('order_id, product_id, slot, url, archived_at').in('order_id', ids);
          const byOrder = {};
          (photos || []).forEach(p => { (byOrder[p.order_id] = byOrder[p.order_id] || []).push(p); });
          rows.forEach(r => { r.photos = byOrder[r.order_id] || []; });
        }
        return res.json(rows);
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
        const requestType = req.body.type === 'exchange' ? 'exchange' : 'return';
        if (!reason || !String(reason).trim()) return res.status(400).json({ error: `Please choose a reason for the ${requestType}.` });

        const norm = String(phone || '').replace(/\D/g, '').slice(-10);
        const { data: ord } = await supabase
          .from('orders')
          .select('order_id, vendor_id, status, customer_name, customer_email, customer_phone, updated_at')
          .eq('order_id', orderId).eq('customer_phone', norm).single();
        if (!ord) return res.status(404).json({ error: 'Order not found.' });
        if (ord.status !== 'delivered') return res.status(400).json({ error: 'You can request a return only after the order is delivered.' });

        // Final-sale guard: block only when EVERY item in the order is final-sale
        // (mixed orders stay returnable/exchangeable).
        {
          const { data: oiAll } = await supabase
            .from('order_items').select('product_id').eq('order_id', orderId);
          const allPids = [...new Set((oiAll || []).map(i => i.product_id).filter(Boolean))];
          if (allPids.length) {
            const { data: fs } = await supabase
              .from('products').select('id').in('id', allPids).eq('final_sale', true);
            if ((fs || []).length === allPids.length) {
              return res.status(400).json({ error: 'This order is final sale — it cannot be returned or exchanged.' });
            }
          }
        }

        // Window starts at delivery — read the delivered event, fall back to updated_at
        const { data: ev } = await supabase
          .from('order_events').select('created_at')
          .eq('order_id', orderId).eq('to_status', 'delivered')
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        const deliveredAt = ev ? new Date(ev.created_at) : new Date(ord.updated_at);
        const elapsedMs = Date.now() - deliveredAt.getTime();
        if (requestType === 'exchange') {
          if (elapsedMs > EXCHANGE_WINDOW_HOURS * 3600000) {
            return res.status(400).json({ error: `The ${EXCHANGE_WINDOW_HOURS}-hour exchange window for this order has passed.` });
          }
          // Exchange is fashion-only: the order must contain an exchangeable item.
          const { data: oi } = await supabase
            .from('order_items').select('product_id').eq('order_id', orderId);
          const pids = (oi || []).map(i => i.product_id).filter(Boolean);
          let eligible = false;
          if (pids.length) {
            const { data: prods } = await supabase
              .from('products').select('id').in('id', pids).eq('exchangeable', true);
            eligible = (prods || []).length > 0;
          }
          if (!eligible) return res.status(400).json({ error: 'This order has no items eligible for exchange.' });
        } else if (elapsedMs > RETURN_WINDOW_DAYS * 86400000) {
          return res.status(400).json({ error: `The ${RETURN_WINDOW_DAYS}-day return window for this order has passed.` });
        }

        const { data: existing } = await supabase
          .from('return_requests').select('status').eq('order_id', orderId).maybeSingle();
        if (existing) return res.status(400).json({ error: 'A return or exchange is already in progress for this order.' });

        const ret = {
          order_id: orderId, vendor_id: ord.vendor_id, request_type: requestType,
          customer_name: ord.customer_name, email: ord.customer_email, phone: ord.customer_phone,
          reason: String(reason).trim().slice(0, 600),
          // Exchanges skip admin: auto-approved, Exchange ID minted now, routed
          // straight to the vendor to re-prepare.
          ...(requestType === 'exchange'
            ? { status: 'Approved', resolution: 'exchange', exchange_id: genExchangeId() }
            : { status: 'Requested' })
        };
        const { error } = await supabase.from('return_requests').insert(ret);
        if (error) {
          if (error.code === '23505') return res.status(400).json({ error: 'A return or exchange is already in progress for this order.' });
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
            .select('order_id, exchange_id, request_type, reason, resolution, status, qc_status, customer_name, assigned_at')
            .eq('assigned_partner_id', partner.partner_id)
            .in('status', ['Assigned', 'Picked up'])
            .order('assigned_at', { ascending: true });
          const list = rets || [];
          const ids = list.map(r => r.order_id);
          const orders = {};
          let flagged = {}, photosByOrder = {};
          if (ids.length) {
            const { data: ords } = await supabase
              .from('orders')
              .select('order_id, customer_name, delivery_address, address_json, total, items_json, vendors(name)')
              .in('order_id', ids);
            (ords || []).forEach(o => { orders[o.order_id] = o; });
            flagged = await flaggedProductsByOrder(ids);
            const { data: photos } = await supabase
              .from('return_photos').select('order_id, product_id, slot, url').in('order_id', ids);
            (photos || []).forEach(p => { (photosByOrder[p.order_id] = photosByOrder[p.order_id] || []).push(p); });
          }
          return res.json(list.map(r => ({
            ...r,
            order: orders[r.order_id] || null,
            qc_products: flagged[r.order_id] || [],
            requires_photo_qc: (flagged[r.order_id] || []).length > 0,
            photos: photosByOrder[r.order_id] || []
          })));
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

        // Helper: confirm this order is a picked-up return assigned to the caller.
        const ownsPickup = async (orderId) => {
          if (!orderId) return null;
          const { data } = await supabase
            .from('return_requests').select('id, status, request_type, assigned_partner_id, email, order_id')
            .eq('order_id', orderId).maybeSingle();
          if (!data || data.assigned_partner_id !== partner.partner_id) return null;
          return data;
        };

        // Sign one Cloudinary upload (the photo uploads browser -> Cloudinary).
        if (action === 'rp-sign-upload') {
          const ret = await ownsPickup(String(req.body.orderId || ''));
          if (!ret) return res.status(404).json({ error: 'This pickup is not assigned to you.' });
          if (ret.status !== 'Picked up') return res.status(400).json({ error: 'Confirm the pickup before adding photos.' });
          try {
            return res.json(cloudinary.signUpload(`returns/${ret.order_id}`));
          } catch (e) { return res.status(503).json({ error: e.message }); }
        }

        // Record one captured QC photo (after it lands on Cloudinary).
        if (action === 'rp-save-photo') {
          const ret = await ownsPickup(String(req.body.orderId || ''));
          if (!ret) return res.status(404).json({ error: 'This pickup is not assigned to you.' });
          const slot = String(req.body.slot || '');
          if (!QC_SLOTS.includes(slot)) return res.status(400).json({ error: 'Invalid photo slot.' });
          if (!req.body.url) return res.status(400).json({ error: 'Missing photo url.' });
          // One photo per (order, product, slot): replace any prior shot.
          await supabase.from('return_photos').delete()
            .eq('order_id', ret.order_id).eq('product_id', req.body.productId || null).eq('slot', slot);
          const { error } = await supabase.from('return_photos').insert({
            order_id: ret.order_id, product_id: req.body.productId || null, slot,
            public_id: String(req.body.publicId || ''), url: String(req.body.url)
          });
          if (error) throw error;
          return res.json({ success: true });
        }

        // Partner's physical QC verdict (Gate 2). Pass -> awaits admin Gate 3.
        // Fail -> the item goes back to the customer, no refund.
        if (action === 'rp-qc') {
          const ret = await ownsPickup(String(req.body.orderId || ''));
          if (!ret) return res.status(404).json({ error: 'This pickup is not assigned to you.' });
          if (ret.status !== 'Picked up') return res.status(400).json({ error: 'Confirm the pickup first.' });
          const pass = req.body.result === 'pass';
          const note = String(req.body.note || '').trim().slice(0, 600);

          if (pass) {
            // Every flagged product must have all four angles before a pass.
            const flagged = await flaggedProductsByOrder([ret.order_id]);
            const need = flagged[ret.order_id] || [];
            if (need.length) {
              const { data: photos } = await supabase
                .from('return_photos').select('product_id, slot').eq('order_id', ret.order_id);
              const have = {};
              (photos || []).forEach(p => { (have[p.product_id] = have[p.product_id] || new Set()).add(p.slot); });
              const incomplete = need.find(p => QC_SLOTS.some(s => !(have[p.product_id] && have[p.product_id].has(s))));
              if (incomplete) return res.status(400).json({ error: `Capture all 4 angles for "${incomplete.name}" before passing QC.` });
            }
          }

          const upd = {
            qc_status: pass ? 'passed' : 'failed',
            qc_note: note || null,
            updated_at: new Date().toISOString()
          };
          // QC fail -> case closes, item goes back. QC pass: an EXCHANGE is
          // completed at the door (partner hands over the replacement), so it
          // closes as 'Exchanged'; a RETURN stays 'Picked up' for the admin's
          // refund gate.
          if (!pass) upd.status = 'QC failed';
          else if (ret.request_type === 'exchange') {
            upd.status = 'Exchanged';
            if (!ret.picked_up_at) upd.picked_up_at = new Date().toISOString();
          }
          const { data: r } = await supabase
            .from('return_requests').update(upd).eq('id', ret.id).select('*').single();
          if (r && r.email) sendReturnUpdate(r.email, r).catch(() => {});
          return res.json({ success: true, qc_status: upd.qc_status, status: upd.status || ret.status });
        }

        return res.status(400).json({ error: 'Unknown action' });
      }

      // ----- Vendor: dispatch a return OR exchange to a pickup partner -----
      // (Admin is out of the logistics loop; the vendor assigns the partner.
      // This generates the customer's pickup code.) Returns dispatch from
      // 'Requested'; exchanges from 'Approved' (after re-preparing).
      if (action === 'vendor-dispatch' || action === 'vendor-exchange-dispatch') {
        const vs = await validateVendorSession(getToken(req));
        if (!vs) return res.status(401).json({ error: 'Please sign in again.' });
        const { data: ret } = await supabase
          .from('return_requests')
          .select('id, status, request_type, vendor_id, email, order_id')
          .eq('id', req.body.returnId).maybeSingle();
        if (!ret || ret.vendor_id !== vs.vendor_id) return res.status(404).json({ error: 'Request not found for your shop.' });
        if (!['Requested', 'Approved', 'Ready', 'Assigned'].includes(ret.status)) {
          return res.status(400).json({ error: 'This request cannot be dispatched right now.' });
        }
        const { data: partner } = await supabase
          .from('return_partners').select('id, active').eq('id', req.body.partnerId).maybeSingle();
        if (!partner || !partner.active) return res.status(400).json({ error: 'Choose an active pickup partner.' });

        const code = String(crypto.randomInt(100000, 1000000));
        await supabase.from('return_otps').upsert({
          order_id: ret.order_id, otp: code, attempts: 0,
          expires_at: new Date(Date.now() + PICKUP_OTP_TTL_MS).toISOString(),
          created_at: new Date().toISOString()
        });
        const { data: upd } = await supabase
          .from('return_requests')
          .update({ assigned_partner_id: req.body.partnerId, assigned_at: new Date().toISOString(),
                    status: 'Assigned', updated_at: new Date().toISOString() })
          .eq('id', ret.id).select('*').single();
        if (upd && upd.email) sendReturnUpdate(upd.email, upd).catch(() => {});
        return res.json({ success: true });
      }

      // ----- Vendor: confirm a returned item is back in hand -> 'Returned' -----
      // (After the pickup partner has collected + passed QC. Opens the refund
      // window for the admin.)
      if (action === 'vendor-return-received') {
        const vs = await validateVendorSession(getToken(req));
        if (!vs) return res.status(401).json({ error: 'Please sign in again.' });
        const { data: ret } = await supabase
          .from('return_requests')
          .select('id, status, qc_status, request_type, vendor_id, email, order_id')
          .eq('id', req.body.returnId).maybeSingle();
        if (!ret || ret.vendor_id !== vs.vendor_id) return res.status(404).json({ error: 'Return not found for your shop.' });
        if (ret.request_type !== 'return') return res.status(400).json({ error: 'That request is not a return.' });
        if (ret.status !== 'Picked up') return res.status(400).json({ error: 'The item must be picked up before you can confirm receipt.' });
        // If photo QC was required it must have passed.
        const flagged = await flaggedProductsByOrder([ret.order_id]);
        if ((flagged[ret.order_id] || []).length && ret.qc_status !== 'passed') {
          return res.status(400).json({ error: 'Photo QC has not passed for this return yet.' });
        }
        const { data: upd } = await supabase
          .from('return_requests')
          .update({ status: 'Returned', returned_received_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', ret.id).select('*').single();
        if (upd && upd.email) sendReturnUpdate(upd.email, upd).catch(() => {});
        return res.json({ success: true });
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
        // status is optional — a note-only update (e.g. on exchange cards) leaves
        // the current status untouched. When given, it must be valid.
        const newStatus = (req.body.status === undefined || req.body.status === '') ? null : req.body.status;
        if (newStatus !== null && !RETURN_STATUSES.includes(newStatus)) {
          return res.status(400).json({ error: 'Invalid return status.' });
        }
        const upd = { updated_at: new Date().toISOString() };
        if (newStatus) upd.status = newStatus;
        if (req.body.admin_note !== undefined) upd.admin_note = String(req.body.admin_note || '').trim().slice(0, 1000);
        if (req.body.resolution === 'refund' || req.body.resolution === 'exchange') upd.resolution = req.body.resolution;
        // Approving an exchange mints its Exchange ID (the vendor prepares against it).
        if (newStatus === 'Approved') {
          const { data: cur } = await supabase
            .from('return_requests').select('request_type, exchange_id').eq('id', req.body.returnId).maybeSingle();
          if (cur && cur.request_type === 'exchange' && !cur.exchange_id) upd.exchange_id = genExchangeId();
        }
        if (newStatus === 'Refunded') {
          upd.refund_amount = (req.body.refund_amount != null && req.body.refund_amount !== '') ? Number(req.body.refund_amount) : null;
          upd.refund_method = String(req.body.refund_method || '').trim().slice(0, 60);
        }
        const { data: r, error } = await supabase
          .from('return_requests').update(upd).eq('id', req.body.returnId).select('*').single();
        if (error) throw error;
        // On refund: restore stock + reverse commission (idempotent in the DB).
        if (newStatus === 'Refunded' && r) {
          const { error: rpcErr } = await supabase.rpc('process_return_refund', { p_order_id: r.order_id });
          if (rpcErr) throw rpcErr;
        }
        if (r && r.email) sendReturnUpdate(r.email, r).catch(() => {});
        return res.json({ success: true });
      }

      // ----- Admin: process the refund once the item is back ('Returned') -----
      // Pure refund to the customer's saved UPI/bank. The admin MUST upload a
      // transaction receipt — it's saved to Google Drive FIRST, and only on a
      // successful upload is the refund completed.
      if (action === 'process-refund') {
        const { data: ret } = await supabase
          .from('return_requests')
          .select('id, order_id, request_type, status, email, phone')
          .eq('id', req.body.returnId).maybeSingle();
        if (!ret) return res.status(404).json({ error: 'Return not found.' });
        if (ret.request_type !== 'return') return res.status(400).json({ error: 'Only returns are refunded here.' });
        if (ret.status !== 'Returned') return res.status(400).json({ error: 'The item must be received back (Returned) before refunding.' });

        const { data: cust } = await supabase
          .from('customers').select('refund_upi, bank_account, bank_ifsc, bank_holder')
          .eq('phone', ret.phone).maybeSingle();
        const hasUpi = cust && cust.refund_upi;
        const hasBank = cust && cust.bank_account && cust.bank_ifsc;
        if (!hasUpi && !hasBank) {
          return res.status(400).json({ error: 'The customer has not saved any refund (UPI/bank) details yet.' });
        }

        // Validate + save the transaction receipt to Google Drive (required).
        const rc = req.body.receipt || {};
        if (!rc.data || !rc.mimeType) return res.status(400).json({ error: 'Please attach the transaction receipt.' });
        if (!RECEIPT_TYPES.includes(rc.mimeType)) return res.status(400).json({ error: 'Receipt must be an image or PDF.' });
        let buf;
        try { buf = Buffer.from(String(rc.data), 'base64'); } catch (_) { buf = null; }
        if (!buf || !buf.length) return res.status(400).json({ error: 'Could not read the receipt file.' });
        if (buf.length > RECEIPT_MAX_BYTES) return res.status(400).json({ error: 'Receipt is too large (max 4 MB).' });

        const ext = rc.mimeType === 'application/pdf' ? 'pdf' : (rc.mimeType.split('/')[1] || 'jpg');
        let receiptUrl;
        try {
          const up = await uploadBinaryFile(`refund-receipt-${ret.order_id}.${ext}`, rc.mimeType, buf, { shareAnyone: true });
          receiptUrl = up.webViewLink || up.id || null;
        } catch (e) {
          return res.status(502).json({ error: 'Could not save the receipt to Google Drive — refund not processed. ' + e.message });
        }

        const { data: ord } = await supabase
          .from('orders').select('total').eq('order_id', ret.order_id).maybeSingle();
        const method = hasUpi ? `UPI: ${cust.refund_upi}` : `Bank: ${cust.bank_account} / ${cust.bank_ifsc}`;
        const { data: upd } = await supabase.from('return_requests').update({
          status: 'Refunded', resolution: 'refund',
          refund_amount: ord ? ord.total : null, refund_method: method,
          refund_receipt_url: receiptUrl,
          updated_at: new Date().toISOString()
        }).eq('id', ret.id).select('*').single();
        const { error: rpcErr } = await supabase.rpc('process_return_refund', { p_order_id: ret.order_id });
        if (rpcErr) throw rpcErr;
        if (upd && upd.email) sendReturnUpdate(upd.email, upd).catch(() => {});
        return res.json({ success: true, refund_method: method, receipt_url: receiptUrl });
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
          .from('return_requests').select('id, order_id, status, request_type, email').eq('id', returnId).maybeSingle();
        if (!ret) return res.status(404).json({ error: 'Return not found.' });
        // Exchanges can only be dispatched once the vendor has prepared the
        // replacement (status 'Ready'); returns just need admin approval.
        const ok = ret.request_type === 'exchange'
          ? ['Ready', 'Assigned'].includes(ret.status)
          : ['Approved', 'Assigned'].includes(ret.status);
        if (!ok) {
          return res.status(400).json({ error: ret.request_type === 'exchange'
            ? 'The vendor must prepare the replacement (Ready) before assigning a pickup partner.'
            : 'Approve the return before assigning a pickup partner.' });
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
