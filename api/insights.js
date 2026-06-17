// Read-only "insights" endpoint — showcases the precision-algorithms toolkit
// (lib/algorithms) on real marketplace data. Every action here is a GET and
// performs ZERO writes: it never touches checkout, payments, auth or stock,
// so it cannot regress the live storefront.
//
//   GET /api/insights?action=product-lookup&code=XIZ5J
//   GET /api/insights?action=budget-combo&vendorId=<uuid>&budget=200
//   GET /api/insights?action=sales-trend&days=30&k=7[&vendorId=<uuid>]
//   GET /api/insights?action=delivery-route&from=Race Course&to=Mavdi
//   GET /api/insights?action=catalog-graph&vendorId=<uuid>[&from=&to=]
//   GET /api/insights?action=order-pipeline[&vendorId=<uuid>]

const guard = require('../lib/guard');
const supabase = require('../lib/supabase');
const {
  PrecisionBinarySearch,
  PrecisionHashMap,
  TwoPointer,
  SlidingWindow,
  WeightedPrecisionGraph,
  PrecisionGraph,
  PrecisionStack,
  PrecisionQueue,
  Decimal,
} = require('../lib/algorithms');
const { ZONES, buildZoneGraph } = require('../lib/algorithms/rajkot-zones');

// Decimal -> JS number for JSON (keeps an exact string alongside when useful).
const num = (d) => (d == null ? null : Number(d.toString()));

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!guard(req, res)) return;

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { action } = req.query;
    switch (action) {
      case 'product-lookup':  return await productLookup(req, res);
      case 'budget-combo':    return await budgetCombo(req, res);
      case 'sales-trend':     return await salesTrend(req, res);
      case 'delivery-route':  return await deliveryRoute(req, res);
      case 'catalog-graph':   return await catalogGraph(req, res);
      case 'order-pipeline':  return await orderPipeline(req, res);
      default:
        return res.json({
          endpoint: 'insights',
          algorithms: {
            'product-lookup': 'binary_search + hash_table — exact product_no lookup',
            'budget-combo':   'two_pointer — two items within a budget (exact ₹ sums)',
            'sales-trend':    'sliding_window — k-day moving-average & peak revenue window',
            'delivery-route': 'dijkstra — shortest path/ETA across Rajkot zones',
            'catalog-graph':  'graph_traversal — vendor→category→product BFS/DFS',
            'order-pipeline': 'stack_queue — FIFO next-to-process order queue',
          },
        });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// --- binary_search + hash_table -------------------------------------------
// Exact lookup of a product by its 5-char product_no. We index every active
// product in a PrecisionHashMap (O(1) get) AND a sorted array searched with
// PrecisionBinarySearch (O(log n)); both must agree. On a miss, the binary
// search's insertion point yields the nearest codes as suggestions.
async function productLookup(req, res) {
  const code = String(req.query.code || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (!code) return res.status(400).json({ error: 'Provide ?code=<product_no>' });

  let q = supabase.from('products')
    .select('id, name, price, product_no, category, vendor_id, stock')
    .eq('active', true);
  if (req.query.vendorId) q = q.eq('vendor_id', req.query.vendorId);
  const { data, error } = await q;
  if (error) throw error;
  const products = data || [];

  // O(1) hash index keyed by product_no
  const index = new PrecisionHashMap();
  for (const p of products) if (p.product_no) index.set(String(p.product_no).toUpperCase(), p);

  // O(log n) binary search over sorted product_no codes
  const bs = new PrecisionBinarySearch();
  const codes = bs.sort(products.map((p) => String(p.product_no || '').toUpperCase()));
  const idx = bs.search(codes, code);

  const found = index.get(code);
  let suggestions = [];
  if (!found) {
    const ins = bs.insertionIndex(codes, code);
    suggestions = codes.slice(Math.max(0, ins - 2), ins + 2);
  }

  return res.json({
    query: code,
    found: !!found,
    product: found || null,
    binary_search_index: idx,        // -1 when absent
    hash_and_bsearch_agree: (idx !== -1) === !!found,
    suggestions,                      // nearest codes on a miss
    index_stats: index.stats(),       // load factor / collisions of the hash index
    catalog_size: products.length,
  });
}

// --- two_pointer -----------------------------------------------------------
// "What two items can I get for ≤ ₹budget?" Classic sorted two-pointer over
// product prices, with exact Decimal sums (no 0.1+0.2 float drift).
async function budgetCombo(req, res) {
  const vendorId = req.query.vendorId;
  if (!vendorId) return res.status(400).json({ error: 'Provide ?vendorId=<uuid>' });
  const budget = Number(req.query.budget);
  if (!Number.isFinite(budget) || budget <= 0) return res.status(400).json({ error: 'Provide a positive ?budget=' });

  const { data, error } = await supabase.from('products')
    .select('id, name, price, stock')
    .eq('active', true).eq('vendor_id', vendorId).gt('stock', 0);
  if (error) throw error;
  const products = data || [];

  // price -> queue of products at that price (to map pairs back to real items)
  const byPrice = new Map();
  for (const p of products) {
    const key = new Decimal(p.price).toString();
    if (!byPrice.has(key)) byPrice.set(key, []);
    byPrice.get(key).push(p);
  }
  const pickPair = ([a, b]) => {
    const ka = new Decimal(a).toString(), kb = new Decimal(b).toString();
    const first = byPrice.get(ka)[0];
    const pool = byPrice.get(kb).filter((p) => p.id !== first.id);
    const second = pool[0];
    if (!second) return null;
    return { items: [first.name, second.name], prices: [num(a), num(b)], total: num(new Decimal(a).add(new Decimal(b))) };
  };

  const tp = new TwoPointer();
  const sorted = tp.prepareNumeric(products.map((p) => p.price));

  const exact = (tp.allPairsWithSum(sorted, budget) || []).map(pickPair).filter(Boolean);
  const closestRaw = tp.closestPairSum(sorted, budget);
  const closest = closestRaw.pair ? pickPair(closestRaw.pair) : null;

  return res.json({
    vendor_id: vendorId,
    budget,
    exact_matches: exact,                              // pairs that hit the budget exactly
    closest_to_budget: closest,                        // best pair if no exact match
    in_stock_products: products.length,
  });
}

// --- sliding_window --------------------------------------------------------
// Daily revenue time series -> k-day moving average and the peak k-day window,
// all with exact Decimal sums.
async function salesTrend(req, res) {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
  let k = Math.max(parseInt(req.query.k, 10) || 7, 1);
  if (k > days) k = days;

  const since = new Date(Date.now() - days * 86400000).toISOString();
  let q = supabase.from('orders')
    .select('total, created_at, status')
    .gte('created_at', since).neq('status', 'cancelled');
  if (req.query.vendorId) q = q.eq('vendor_id', req.query.vendorId);
  const { data, error } = await q;
  if (error) throw error;
  const orders = data || [];

  // Build a contiguous day axis and bucket revenue (exact Decimal sums).
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const axis = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    axis.push(d.toISOString().slice(0, 10));
  }
  const revByDay = new Map(axis.map((d) => [d, new Decimal('0')]));
  for (const o of orders) {
    const day = String(o.created_at).slice(0, 10);
    if (revByDay.has(day)) revByDay.set(day, revByDay.get(day).add(new Decimal(o.total || 0)));
  }
  const daily = axis.map((d) => revByDay.get(d));

  const sw = new SlidingWindow();
  const movingAvg = sw.windowAverages(daily, k);      // Decimal[]
  const peakSum = sw.maxSum(daily, k);                 // Decimal | null

  // Locate which window is the peak, for a human-readable date range.
  let peakWindow = null;
  if (peakSum) {
    const sums = sw.windowSums(daily, k);
    const i = sums.findIndex((s) => s.toString() === peakSum.toString());
    if (i >= 0) peakWindow = { from: axis[i], to: axis[i + k - 1], revenue: num(peakSum) };
  }

  const total = daily.reduce((s, d) => s.add(d), new Decimal('0'));
  return res.json({
    days, window_k: k, vendor_id: req.query.vendorId || null,
    daily: axis.map((d, i) => ({ date: d, revenue: num(daily[i]) })),
    moving_average: movingAvg.map((d, i) => ({ ending: axis[i + k - 1], avg: num(d) })),
    peak_window: peakWindow,
    total_revenue: num(total),
    orders_counted: orders.length,
  });
}

// --- dijkstra --------------------------------------------------------------
// Shortest delivery path + ETA / fee estimate across Rajkot zones.
async function deliveryRoute(req, res) {
  const from = req.query.from, to = req.query.to;
  if (!from || !to || !ZONES.includes(from) || !ZONES.includes(to)) {
    return res.status(400).json({ error: 'Provide ?from= and ?to= from the zone list.', zones: ZONES });
  }
  const speed = Math.max(Number(req.query.speed) || 25, 1);  // km/h
  const perKm = Math.max(Number(req.query.perKm) || 8, 0);   // ₹/km
  const base = Math.max(Number(req.query.base) || 20, 0);    // ₹ base fee

  const g = buildZoneGraph(WeightedPrecisionGraph);
  const { distance, path } = g.shortestPath(from, to);
  if (!path) return res.json({ from, to, reachable: false });

  const km = num(distance);
  return res.json({
    from, to, reachable: true,
    path, distance_km: km,
    eta_minutes: Math.round((km / speed) * 60),
    fee_estimate: Math.round(base + perKm * km),
    assumptions: { speed_kmph: speed, per_km: perKm, base_fee: base },
  });
}

// --- graph_traversal (BFS / DFS) ------------------------------------------
// Vendor catalog as a graph: shop → category → product. BFS gives a
// breadth-first catalog tour; bfsPath finds the route to a product.
async function catalogGraph(req, res) {
  const vendorId = req.query.vendorId;
  if (!vendorId) return res.status(400).json({ error: 'Provide ?vendorId=<uuid>' });

  const [{ data: vendor }, { data: products, error }] = await Promise.all([
    supabase.from('vendors').select('name').eq('id', vendorId).single(),
    supabase.from('products').select('name, category').eq('active', true).eq('vendor_id', vendorId),
  ]);
  if (error) throw error;
  const items = products || [];
  if (!items.length) return res.json({ vendor_id: vendorId, products: 0, bfs: [], dfs: [] });

  const root = `🏪 ${(vendor && vendor.name) || 'Shop'}`;
  const graph = new PrecisionGraph({}, /* directed */ false);
  graph.addNode(root);
  const categories = new Set();
  for (const p of items) {
    const cat = p.category || 'Uncategorised';
    if (!categories.has(cat)) { categories.add(cat); graph.addNode(cat); graph.addEdge(root, cat); }
    graph.addNode(p.name);
    graph.addEdge(cat, p.name);
  }

  const out = { vendor_id: vendorId, root, products: items.length, categories: [...categories] };
  out.bfs = graph.bfs(root);
  out.dfs = graph.dfs(root);
  if (req.query.from && req.query.to) out.path = graph.bfsPath(req.query.from, req.query.to);
  return res.json(out);
}

// --- stack_queue -----------------------------------------------------------
// Active orders as a FIFO processing queue (oldest first = next to process)
// and a LIFO stack (newest first), over the same data.
async function orderPipeline(req, res) {
  const DONE = ['delivered', 'cancelled', 'returned'];
  let q = supabase.from('orders')
    .select('order_id, status, total, created_at')
    .order('created_at', { ascending: true });
  if (req.query.vendorId) q = q.eq('vendor_id', req.query.vendorId);
  const { data, error } = await q;
  if (error) throw error;
  const active = (data || []).filter((o) => !DONE.includes(o.status));

  const age = (iso) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  const fifo = new PrecisionQueue();   // FIFO: oldest dequeued first
  const lifo = new PrecisionStack();    // LIFO: newest popped first
  for (const o of active) { fifo.enqueue(o.order_id); lifo.push(o.order_id); }

  const byId = new Map(active.map((o) => [o.order_id, o]));
  const decorate = (id) => {
    const o = byId.get(id);
    return { order_id: id, status: o.status, total: Number(o.total || 0), age_minutes: age(o.created_at) };
  };

  return res.json({
    vendor_id: req.query.vendorId || null,
    active_orders: active.length,
    next_to_process: fifo.front() ? decorate(fifo.front()) : null,   // FIFO front
    most_recent: lifo.peek() ? decorate(lifo.peek()) : null,         // LIFO top
    processing_queue: fifo.toArray().map(decorate),                  // FIFO order
  });
}
