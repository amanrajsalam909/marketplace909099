'use strict';

/*
 * BFS and DFS graph traversal built on top of the ultra-precision special-value
 * sorter (ultra_special_sort.js, used here as a module).
 *
 * Node labels may be arbitrary special values — numbers, NaN, ±Infinity,
 * subnormals, Decimal, Complex, numeric/plain strings, or None (null). Two
 * things make that work:
 *
 *   1. Neighbour expansion order is made deterministic by sorting each node's
 *      adjacency list with PrecisionSpecialValueSorter, so BFS/DFS always
 *      visit neighbours in the sorter's total order (-inf < numbers <
 *      numeric-strings < ... < +inf < nan < None).
 *
 *   2. The visited-set is keyed by reprValue() — a canonical string form — so
 *      NaN (which is !== itself) and value-equal Decimals (distinct objects)
 *      are deduplicated correctly.
 */

const {
  PrecisionSpecialValueSorter,
  reprValue,
  reprArray,
} = require('./ultra_special_sort');

class PrecisionGraph {
  constructor(options = {}, directed = false) {
    this.directed = directed;
    this.sorter = new PrecisionSpecialValueSorter(options);
    this.nodes = new Map(); // key -> value
    this.adj = new Map();   // key -> array of neighbour values
  }

  _key(value) {
    return reprValue(value);
  }

  addNode(value) {
    const k = this._key(value);
    if (!this.nodes.has(k)) {
      this.nodes.set(k, value);
      this.adj.set(k, []);
    }
    return k;
  }

  addEdge(u, v) {
    this.addNode(u);
    this.addNode(v);
    this.adj.get(this._key(u)).push(v);
    if (!this.directed) this.adj.get(this._key(v)).push(u);
  }

  neighbors(value) {
    return this.adj.get(this._key(value)) || [];
  }

  // Neighbours visited in precision-sorted order (the sorter as a tie-breaker).
  sortedNeighbors(value) {
    const ns = this.neighbors(value).slice();
    this.sorter.precisionSort(ns);
    return ns;
  }

  // --- Breadth-First Search -------------------------------------------------
  bfs(start) {
    const order = [];
    const visited = new Set();
    const queue = [start];
    visited.add(this._key(start));
    while (queue.length) {
      const node = queue.shift();
      order.push(node);
      for (const nb of this.sortedNeighbors(node)) {
        const k = this._key(nb);
        if (!visited.has(k)) {
          visited.add(k);
          queue.push(nb);
        }
      }
    }
    return order;
  }

  // --- Depth-First Search (recursive, pre-order) ----------------------------
  dfs(start) {
    const order = [];
    const visited = new Set();
    const visit = (node) => {
      const k = this._key(node);
      if (visited.has(k)) return;
      visited.add(k);
      order.push(node);
      for (const nb of this.sortedNeighbors(node)) visit(nb);
    };
    visit(start);
    return order;
  }

  // --- Depth-First Search (iterative, same pre-order) -----------------------
  dfsIterative(start) {
    const order = [];
    const visited = new Set();
    const stack = [start];
    while (stack.length) {
      const node = stack.pop();
      const k = this._key(node);
      if (visited.has(k)) continue;
      visited.add(k);
      order.push(node);
      // push in reverse sorted order so the smallest is popped first
      const ns = this.sortedNeighbors(node);
      for (let i = ns.length - 1; i >= 0; i--) {
        if (!visited.has(this._key(ns[i]))) stack.push(ns[i]);
      }
    }
    return order;
  }

  /**
   * BFS shortest path (fewest edges) from `start` to a node equal to `target`
   * (canonical-key equality). Returns an array of values, or null.
   */
  bfsPath(start, target) {
    const targetKey = this._key(target);
    const visited = new Set([this._key(start)]);
    const queue = [[start]];
    while (queue.length) {
      const path = queue.shift();
      const node = path[path.length - 1];
      if (this._key(node) === targetKey) return path;
      for (const nb of this.sortedNeighbors(node)) {
        const k = this._key(nb);
        if (!visited.has(k)) {
          visited.add(k);
          queue.push([...path, nb]);
        }
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Demonstration
// ---------------------------------------------------------------------------
function demonstrateTraversal() {
  console.log('BFS / DFS TRAVERSAL (built on the special-value sorter)');
  console.log('='.repeat(60));

  const g = new PrecisionGraph({ precision_mode: 'maximum' }, /* directed */ false);

  // An undirected graph whose labels mix ordinary numbers and special values.
  g.addEdge(0, 5);
  g.addEdge(0, 3);
  g.addEdge(0, Infinity);
  g.addEdge(0, -Infinity);
  g.addEdge(0, 2);
  g.addEdge(5, NaN);
  g.addEdge(5, 1);
  g.addEdge(3, 4);
  g.addEdge(2, '2.5');     // numeric string node
  g.addEdge(2, null);      // None node
  g.addEdge(Infinity, 4);

  console.log('\nNeighbours of 0 (raw vs. precision-sorted expansion order):');
  console.log(`  raw:    ${reprArray(g.neighbors(0))}`);
  console.log(`  sorted: ${reprArray(g.sortedNeighbors(0))}`);

  console.log('\nBFS from 0:');
  console.log(`  ${reprArray(g.bfs(0))}`);

  console.log('\nDFS from 0 (recursive):');
  console.log(`  ${reprArray(g.dfs(0))}`);

  console.log('\nDFS from 0 (iterative — same order):');
  console.log(`  ${reprArray(g.dfsIterative(0))}`);

  console.log('\nBFS shortest path 0 -> 4:');
  console.log(`  ${reprArray(g.bfsPath(0, 4))}`);

  console.log('\nBFS shortest path 0 -> nan:');
  console.log(`  ${reprArray(g.bfsPath(0, NaN))}`);

  // Directed graph example
  console.log('\n' + '-'.repeat(60));
  console.log('Directed graph (numbers only):');
  const d = new PrecisionGraph({ precision_mode: 'fast' }, /* directed */ true);
  d.addEdge(1, 3);
  d.addEdge(1, 2);
  d.addEdge(2, 4);
  d.addEdge(3, 4);
  d.addEdge(4, 5);
  console.log(`  BFS from 1: ${reprArray(d.bfs(1))}`);
  console.log(`  DFS from 1: ${reprArray(d.dfs(1))}`);
  console.log(`  path 1 -> 5: ${reprArray(d.bfsPath(1, 5))}`);

  console.log('\n' + '='.repeat(60));
}

module.exports = {
  PrecisionGraph,
};

if (require.main === module) {
  demonstrateTraversal();
}
