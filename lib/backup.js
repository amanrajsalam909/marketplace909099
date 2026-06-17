// On-demand "Save to Google Drive" backup. Lives in lib/ (a module, NOT an
// api/ function) so it doesn't count against the Hobby plan's 12-Serverless-
// Function limit; it is invoked from api/admin.js via the admin POST action
// `backup` (admin-session protected). Unlike lib/cleanup.js this is READ-ONLY:
// it snapshots a dataset to one JSON file on Drive and NEVER touches the DB.
//
// Datasets:
//   orders     – every order, with its line items and event log folded in
//   accounts   – customer accounts (the `customers` table)
//   returns     – return_requests
//   complaints – complaints

const supabase = require('./supabase');
const { uploadJsonFile } = require('./drive');

const LABELS = {
  orders: 'Orders',
  accounts: 'Accounts',
  returns: 'Returns',
  complaints: 'Complaints'
};

// Full order backup: rows + their children (items, events), like the nightly
// archive but read-only and for ALL orders currently in the DB.
async function buildOrders() {
  const { data: orders, error } = await supabase
    .from('orders').select('*')
    .order('created_at', { ascending: false })
    .limit(5000);
  if (error) throw error;

  let items = [], events = [];
  const ids = orders.map(o => o.order_id);
  if (ids.length) {
    const [it, ev] = await Promise.all([
      supabase.from('order_items').select('*').in('order_id', ids),
      supabase.from('order_events').select('*').in('order_id', ids)
    ]);
    if (it.error) throw it.error;
    if (ev.error) throw ev.error;
    items = it.data || [];
    events = ev.data || [];
  }
  const itemsByOrder = groupBy(items, 'order_id');
  const eventsByOrder = groupBy(events, 'order_id');

  return orders.map(o => ({
    ...o,
    items: itemsByOrder[o.order_id] || [],
    events: eventsByOrder[o.order_id] || []
  }));
}

async function buildTable(table) {
  const { data, error } = await supabase.from(table).select('*').limit(10000);
  if (error) throw error;
  return data || [];
}

const BUILDERS = {
  orders: buildOrders,
  accounts: () => buildTable('customers'),
  returns: () => buildTable('return_requests'),
  complaints: () => buildTable('complaints')
};

// Back one dataset up to Drive. Returns { dataset, label, count, drive_file }.
module.exports = async function backupToDrive(dataset) {
  const build = BUILDERS[dataset];
  if (!build) throw new Error('Unknown backup dataset: ' + dataset);

  const records = await build();

  // Stamp to the minute so same-day manual backups get distinct filenames
  // (Drive allows duplicate names, but distinct ones are easier to tell apart).
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '');
  const filename = `rajkotmarket-${dataset}-${stamp}.json`;
  const payload = {
    dataset,
    generated_at: new Date().toISOString(),
    count: records.length,
    records
  };

  const uploaded = await uploadJsonFile(filename, JSON.stringify(payload, null, 2));
  return {
    dataset,
    label: LABELS[dataset] || dataset,
    count: records.length,
    drive_file: { id: uploaded.id, name: uploaded.name, link: uploaded.webViewLink || null }
  };
};

function groupBy(rows, key) {
  const out = {};
  for (const r of rows) (out[r[key]] ||= []).push(r);
  return out;
}
