// Nightly storage-cycle job. Lives in lib/ (a module, NOT an api/ function) so
// it doesn't count against the Hobby plan's 12-Serverless-Function limit; it is
// invoked from api/admin.js via `?action=cleanup`. Trigger it from a free
// external scheduler (e.g. cron-job.org) once a day:
//
//   GET https://marketplace909099.vercel.app/api/admin?action=cleanup
//   Header: Authorization: Bearer <CRON_SECRET>
//
// For every order DELIVERED more than ARCHIVE_AFTER_DAYS ago and not yet
// archived: back the FULL order (row + line items + event log) up to Google
// Drive as one JSON file, then SLIM it in the DB — delete the heavy children
// and null the bulky columns, but KEEP the small orders row so accounting and
// reviews keep working. The DB is NEVER touched unless the Drive upload first
// succeeds, so a failed backup means nothing is deleted that run.

const supabase = require('./supabase');
const { uploadJsonFile } = require('./drive');

const ARCHIVE_AFTER_DAYS = 15;
const MAX_PER_RUN = 500;   // safety cap: archive at most this many orders per run

module.exports = async (req, res) => {
  // ---- auth: only someone holding CRON_SECRET may run this
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization || '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // One-off Google Drive connectivity self-test (touches NO orders). Proves the
  // credentials + upload path work. Remove once verified.
  if (req.query && req.query.selftest === 'drive') {
    try {
      const uploaded = await uploadJsonFile(
        `rajkotmarket-drive-selftest-${Date.now()}.json`,
        JSON.stringify({ ok: true, at: new Date().toISOString(), note: 'RajkotMarket Drive connectivity test' }, null, 2)
      );
      return res.json({ selftest: 'drive', ok: true, drive_file: { id: uploaded.id, name: uploaded.name, link: uploaded.webViewLink || null } });
    } catch (e) {
      return res.status(500).json({ selftest: 'drive', ok: false, error: e.message });
    }
  }

  try {
    const cutoff = new Date(Date.now() - ARCHIVE_AFTER_DAYS * 86400000).toISOString();

    // 1. Orders whose 'delivered' event is older than the cutoff.
    const { data: delEvents, error: evErr } = await supabase
      .from('order_events')
      .select('order_id, created_at')
      .eq('to_status', 'delivered')
      .lt('created_at', cutoff)
      .limit(5000);
    if (evErr) throw evErr;

    const candidateIds = [...new Set((delEvents || []).map(e => e.order_id))];
    if (!candidateIds.length) return res.json({ purged: 0, message: 'Nothing to archive.' });

    // 2. Of those, the ones still present, still delivered, and not yet archived.
    const { data: orders, error: ordErr } = await supabase
      .from('orders')
      .select('*')
      .in('order_id', candidateIds)
      .eq('status', 'delivered')
      .is('archived_at', null)
      .limit(MAX_PER_RUN);
    if (ordErr) throw ordErr;
    if (!orders || !orders.length) return res.json({ purged: 0, message: 'Nothing to archive.' });

    const ids = orders.map(o => o.order_id);

    // 3. Pull the heavy children we're about to delete, so the backup is whole.
    const [{ data: items, error: itErr }, { data: events, error: evErr2 }] = await Promise.all([
      supabase.from('order_items').select('*').in('order_id', ids),
      supabase.from('order_events').select('*').in('order_id', ids)
    ]);
    if (itErr) throw itErr;
    if (evErr2) throw evErr2;

    const itemsByOrder = groupBy(items || [], 'order_id');
    const eventsByOrder = groupBy(events || [], 'order_id');

    const archive = {
      generated_at: new Date().toISOString(),
      archived_after_days: ARCHIVE_AFTER_DAYS,
      cutoff,
      order_count: orders.length,
      orders: orders.map(o => ({
        ...o,
        items: itemsByOrder[o.order_id] || [],
        events: eventsByOrder[o.order_id] || []
      }))
    };

    // 4. Upload the backup FIRST. If this throws, we abort before any delete.
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `rajkotmarket-orders-${stamp}.json`;
    const uploaded = await uploadJsonFile(filename, JSON.stringify(archive, null, 2));

    // 5. Backup is safe — now slim the DB (atomic in Postgres).
    const { data: slimmed, error: slimErr } = await supabase
      .rpc('archive_slim_orders', { p_order_ids: ids });
    if (slimErr) throw slimErr;

    return res.json({
      purged: slimmed ?? ids.length,
      orders: ids.length,
      drive_file: { id: uploaded.id, name: uploaded.name, link: uploaded.webViewLink || null }
    });
  } catch (e) {
    console.error('cleanup failed:', e.message);
    return res.status(500).json({ error: e.message });
  }
};

function groupBy(rows, key) {
  const out = {};
  for (const r of rows) (out[r[key]] ||= []).push(r);
  return out;
}
