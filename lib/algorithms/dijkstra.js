'use strict';

/*
 * Dijkstra's shortest-path algorithm built on top of the ultra-precision
 * special-value sorter (ultra_special_sort.js, used here as a module).
 *
 * The sorter's precision layer is used for the two numeric operations Dijkstra
 * depends on:
 *
 *   - edge weights and tentative distances are kept as exact `Decimal` values,
 *     summed with Decimal.add() (no floating-point round-off — so a path of
 *     0.1 + 0.2 equals exactly 0.3); and
 *
 *   - distance comparisons (the priority-queue "extract-min" and the relaxation
 *     test) go through PrecisionSpecialValueSorter._preciseNumericCompare, the
 *     same comparator the sorter uses, with +Infinity as the "unreached"
 *     sentinel.
 *
 * Node labels may be any value the sorter understands; they are keyed
 * canonically via reprValue().
 */

const {
  PrecisionSpecialValueSorter,
  Decimal,
  reprValue,
  reprArray,
} = require('./ultra_special_sort');

class WeightedPrecisionGraph {
  constructor(options = {}, directed = true) {
    this.directed = directed;
    this.sorter = new PrecisionSpecialValueSorter(options);
    this.nodes = new Map();        // key -> value
    this.adj = new Map();          // key -> [{ node, weight: Decimal }]
  }

  _key(value) { return reprValue(value); }

  _toDecimal(weight) {
    return weight instanceof Decimal ? weight : new Decimal(weight);
  }

  // Compare two distances (Decimals) using the sorter's precision comparator.
  _cmp(a, b) { return this.sorter._preciseNumericCompare(a, b); }

  addNode(value) {
    const k = this._key(value);
    if (!this.nodes.has(k)) {
      this.nodes.set(k, value);
      this.adj.set(k, []);
    }
    return k;
  }

  addEdge(u, v, weight) {
    this.addNode(u);
    this.addNode(v);
    const w = this._toDecimal(weight);
    this.adj.get(this._key(u)).push({ node: v, weight: w });
    if (!this.directed) this.adj.get(this._key(v)).push({ node: u, weight: w });
  }

  /**
   * Run Dijkstra from `start`. Returns { dist, prev } maps keyed by node key,
   * where dist holds exact Decimal distances (Decimal('inf') if unreachable).
   */
  dijkstra(start) {
    const dist = new Map();
    const prev = new Map();
    const visited = new Set();

    for (const k of this.nodes.keys()) dist.set(k, new Decimal('inf'));
    dist.set(this._key(start), new Decimal('0'));

    const remaining = new Set(this.nodes.keys());

    while (remaining.size) {
      // extract-min: scan remaining, compare distances via the sorter
      let minKey = null;
      let minDist = null;
      for (const k of remaining) {
        const d = dist.get(k);
        if (minKey === null || this._cmp(d, minDist) < 0) {
          minKey = k;
          minDist = d;
        }
      }
      if (minKey === null || minDist.isInfinite()) break; // rest unreachable

      remaining.delete(minKey);
      visited.add(minKey);

      for (const { node, weight } of this.adj.get(minKey)) {
        const vKey = this._key(node);
        if (visited.has(vKey)) continue;
        const alt = dist.get(minKey).add(weight); // exact Decimal sum
        if (this._cmp(alt, dist.get(vKey)) < 0) {
          dist.set(vKey, alt);
          prev.set(vKey, minKey);
        }
      }
    }

    return { dist, prev };
  }

  /**
   * Shortest path from `start` to `target`.
   * Returns { distance: Decimal|null, path: value[]|null }.
   */
  shortestPath(start, target) {
    const { dist, prev } = this.dijkstra(start);
    const startKey = this._key(start);
    const targetKey = this._key(target);

    const d = dist.get(targetKey);
    if (!d || d.isInfinite()) return { distance: null, path: null };

    const path = [];
    let cur = targetKey;
    while (cur !== undefined) {
      path.unshift(this.nodes.get(cur));
      if (cur === startKey) break;
      cur = prev.get(cur);
    }
    return { distance: d, path };
  }

  // Pretty distance table from a dijkstra() result.
  distanceTable(start) {
    const { dist } = this.dijkstra(start);
    const rows = [];
    for (const [k, value] of this.nodes) {
      const d = dist.get(k);
      rows.push(`  ${reprValue(value).padEnd(8)} : ${d.isInfinite() ? '∞ (unreachable)' : d.toString()}`);
    }
    return rows.join('\n');
  }
}

// ---------------------------------------------------------------------------
// Demonstration
// ---------------------------------------------------------------------------
function demonstrateDijkstra() {
  console.log("DIJKSTRA SHORTEST PATH (precision edge weights via the sorter)");
  console.log('='.repeat(60));

  // Classic directed weighted graph.
  const g = new WeightedPrecisionGraph({ precision_mode: 'maximum' }, /* directed */ true);
  g.addEdge('A', 'B', 7);
  g.addEdge('A', 'C', 9);
  g.addEdge('A', 'F', 14);
  g.addEdge('B', 'C', 10);
  g.addEdge('B', 'D', 15);
  g.addEdge('C', 'D', 11);
  g.addEdge('C', 'F', 2);
  g.addEdge('D', 'E', 6);
  g.addEdge('F', 'E', 9);

  console.log('\nShortest distances from A:');
  console.log(g.distanceTable('A'));

  const { distance, path } = g.shortestPath('A', 'E');
  console.log(`\nShortest path A -> E: ${reprArray(path)}  (distance ${distance.toString()})`);

  // Unreachable target
  g.addNode('Z');
  const z = g.shortestPath('A', 'Z');
  console.log(`Shortest path A -> Z: ${z.path === null ? 'unreachable' : reprArray(z.path)}`);

  // ---- precision payoff: 0.1 + 0.2 === 0.3 exactly ------------------------
  console.log('\n' + '-'.repeat(60));
  console.log('Exact-weight demo (float would mis-rank 0.1 + 0.2 vs 0.3):');
  const p = new WeightedPrecisionGraph({ precision_mode: 'maximum' }, true);
  p.addEdge('S', 'M', new Decimal('0.1'));
  p.addEdge('M', 'T', new Decimal('0.2'));
  p.addEdge('S', 'T', new Decimal('0.3'));

  const floatSum = 0.1 + 0.2;
  console.log(`  float:   0.1 + 0.2 = ${floatSum} (=== 0.3 ? ${floatSum === 0.3})`);
  const viaM = new Decimal('0.1').add(new Decimal('0.2'));
  console.log(`  Decimal: 0.1 + 0.2 = ${viaM.toString()} (=== 0.3 ? ${p._cmp(viaM, new Decimal('0.3')) === 0})`);

  const st = p.shortestPath('S', 'T');
  console.log(`  shortest S -> T: ${reprArray(st.path)} (distance ${st.distance.toString()})`);
  console.log('  (both routes cost exactly 0.3; Dijkstra keeps the direct edge it settled first)');

  // ---- high-precision weights ---------------------------------------------
  console.log('\n' + '-'.repeat(60));
  console.log('High-precision weights (28+ significant digits):');
  const h = new WeightedPrecisionGraph({ precision_mode: 'maximum', decimal_precision: 50 }, true);
  h.addEdge('P', 'Q', new Decimal('1.0000000000000000000000000001'));
  h.addEdge('Q', 'R', new Decimal('1.0000000000000000000000000002'));
  h.addEdge('P', 'R', new Decimal('2.0000000000000000000000000004')); // ties P->Q->R exactly
  const pr = h.shortestPath('P', 'R');
  console.log(`  P->Q->R sum: ${new Decimal('1.0000000000000000000000000001').add(new Decimal('1.0000000000000000000000000002')).toString()}`);
  console.log(`  direct P->R: 2.0000000000000000000000000004`);
  console.log(`  shortest P -> R: ${reprArray(pr.path)} (distance ${pr.distance.toString()})`);

  console.log('\n' + '='.repeat(60));
}

module.exports = {
  WeightedPrecisionGraph,
};

if (require.main === module) {
  demonstrateDijkstra();
}
