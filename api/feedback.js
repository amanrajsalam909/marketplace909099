const guard = require('../lib/guard');
const supabase = require('../lib/supabase');
const { sendComplaintAlert, sendComplaintResolution } = require('../lib/email');

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
      // Public: approved reviews + average for one shop
      if (req.query.reviews && req.query.vendorId) {
        const { data } = await supabase
          .from('reviews')
          .select('customer_name, rating, comment, created_at')
          .eq('vendor_id', req.query.vendorId)
          .eq('approved', true)
          .order('created_at', { ascending: false })
          .limit(20);
        const list = data || [];
        const avg = list.length ? Math.round(list.reduce((s, r) => s + r.rating, 0) / list.length * 10) / 10 : 0;
        return res.json({ avg, count: list.length, reviews: list });
      }

      // Admin: all reviews or all complaints
      const session = await validateAdminSession(req.query.token);
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
      return res.status(400).json({ error: 'Invalid query' });
    }

    if (req.method === 'POST') {
      const { action } = req.body || {};

      if (action === 'submit-review') {
        const { orderId, phone, rating, comment } = req.body;
        const ord = await ownOrder(orderId, phone);
        if (!ord) return res.status(404).json({ error: 'Order not found.' });
        if (ord.status !== 'delivered') return res.status(400).json({ error: 'You can review an order once it has been delivered.' });

        const r = parseInt(rating, 10);
        if (!r || r < 1 || r > 5) return res.status(400).json({ error: 'Please select a star rating.' });

        const { error } = await supabase.from('reviews').insert({
          order_id: orderId,
          vendor_id: ord.vendor_id,
          customer_name: ord.customer_name,
          rating: r,
          comment: String(comment || '').trim().slice(0, 1000),
          approved: false
        });
        if (error) {
          if (error.code === '23505') return res.status(400).json({ error: 'You have already reviewed this order.' });
          throw error;
        }
        return res.json({ success: true });
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

      // ----- Admin moderation -----
      const session = await validateAdminSession(req.body.token);
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
