'use strict';

/*
 * A hash map keyed by special values, built on top of the ultra-precision
 * special-value sorter (ultra_special_sort.js, used here as a module).
 *
 * Plain JS objects/Maps can't key reliably by the values the sorter handles:
 * Complex/Decimal instances collide or compare by reference, and signed zero is
 * treated inconsistently. This map borrows two things from the sorter:
 *
 *   1. reprValue() as the *canonical key* — so value-equal Decimals, every NaN,
 *      and structurally-equal Complex numbers map to the same bucket, while the
 *      sorter's +0.0 / -0.0 distinction is preserved; and
 *
 *   2. PrecisionSpecialValueSorter for sorted iteration (sortedKeys /
 *      sortedEntries), giving a deterministic order over mixed special keys.
 *
 * Collisions are handled by separate chaining with automatic resize.
 */

const {
  PrecisionSpecialValueSorter,
  reprValue,
  reprArray,
} = require('./ultra_special_sort');

class PrecisionHashMap {
  constructor(options = {}) {
    this.sorter = new PrecisionSpecialValueSorter(options);
    this._capacity = 8;
    this._size = 0;
    this._buckets = Array.from({ length: this._capacity }, () => []);
    this._loadFactor = 0.75;
  }

  // Canonical, value-based key (handles NaN, Decimal, Complex, None, ±0.0).
  _repr(key) { return reprValue(key); }

  // FNV-1a 32-bit hash of the canonical key string.
  _hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  _indexFor(repr, capacity = this._capacity) {
    return this._hash(repr) % capacity;
  }

  set(key, value) {
    if ((this._size + 1) / this._capacity > this._loadFactor) {
      this._resize(this._capacity * 2);
    }
    const repr = this._repr(key);
    const chain = this._buckets[this._indexFor(repr)];
    for (const entry of chain) {
      if (entry.repr === repr) { entry.value = value; return this; }
    }
    chain.push({ key, repr, value });
    this._size++;
    return this;
  }

  get(key) {
    const repr = this._repr(key);
    const chain = this._buckets[this._indexFor(repr)];
    for (const entry of chain) {
      if (entry.repr === repr) return entry.value;
    }
    return undefined;
  }

  has(key) {
    const repr = this._repr(key);
    const chain = this._buckets[this._indexFor(repr)];
    return chain.some((e) => e.repr === repr);
  }

  delete(key) {
    const repr = this._repr(key);
    const chain = this._buckets[this._indexFor(repr)];
    const idx = chain.findIndex((e) => e.repr === repr);
    if (idx === -1) return false;
    chain.splice(idx, 1);
    this._size--;
    return true;
  }

  _resize(newCapacity) {
    const newBuckets = Array.from({ length: newCapacity }, () => []);
    for (const chain of this._buckets) {
      for (const entry of chain) {
        newBuckets[this._indexFor(entry.repr, newCapacity)].push(entry);
      }
    }
    this._buckets = newBuckets;
    this._capacity = newCapacity;
  }

  get size() { return this._size; }

  _allEntries() {
    const out = [];
    for (const chain of this._buckets) for (const e of chain) out.push(e);
    return out;
  }

  keys() { return this._allEntries().map((e) => e.key); }
  values() { return this._allEntries().map((e) => e.value); }
  entries() { return this._allEntries().map((e) => [e.key, e.value]); }

  forEach(callback) {
    for (const e of this._allEntries()) callback(e.value, e.key, this);
  }

  clear() {
    this._capacity = 8;
    this._size = 0;
    this._buckets = Array.from({ length: this._capacity }, () => []);
  }

  // ---- sorter-powered ordered views ---------------------------------------
  sortedKeys() {
    const ks = this.keys();
    this.sorter.precisionSort(ks);
    return ks;
  }

  sortedEntries() {
    const byRepr = new Map();
    for (const e of this._allEntries()) byRepr.set(e.repr, e);
    return this.sortedKeys().map((k) => {
      const e = byRepr.get(this._repr(k));
      return [e.key, e.value];
    });
  }

  stats() {
    let used = 0;
    let maxChain = 0;
    let collisions = 0;
    for (const chain of this._buckets) {
      if (chain.length > 0) used++;
      if (chain.length > maxChain) maxChain = chain.length;
      if (chain.length > 1) collisions += chain.length - 1;
    }
    return {
      size: this._size,
      capacity: this._capacity,
      used_buckets: used,
      load_factor: this._size / this._capacity,
      max_chain: maxChain,
      collisions,
    };
  }
}

// ---------------------------------------------------------------------------
// Demonstration
// ---------------------------------------------------------------------------
function demonstrateHashMap() {
  const { Decimal, cmplx } = require('./ultra_special_sort');

  console.log('PRECISION HASH MAP (special-value keys via the sorter)');
  console.log('='.repeat(60));

  const map = new PrecisionHashMap({ precision_mode: 'maximum', zero_distinction: true });

  // Keys of many kinds, including ones a plain object/Map mishandles.
  map.set(42, 'the answer');
  map.set('42', 'string forty-two');         // distinct from number 42
  map.set(NaN, 'not a number');              // NaN as a usable key
  map.set(Infinity, 'positive infinity');
  map.set(-Infinity, 'negative infinity');
  map.set(0.0, 'positive zero');
  map.set(-0.0, 'negative zero');            // distinct from +0.0
  map.set(null, 'none value');               // None
  map.set(new Decimal('1.5'), 'decimal 1.5');
  map.set(cmplx(3, 4), 'three plus four i');
  map.set(3.14159, 'pi-ish');

  console.log(`\nSize: ${map.size}`);

  console.log('\nLookups:');
  const probes = [42, '42', NaN, Infinity, -Infinity, 0.0, -0.0, null,
    new Decimal('1.5'), cmplx(3, 4), 2.71];
  for (const k of probes) {
    const v = map.get(k);
    console.log(`  get ${reprValue(k).padEnd(20)} -> ${v === undefined ? '(missing)' : `'${v}'`}`);
  }

  console.log('\nKey behaviours a plain Map/object gets wrong:');
  console.log(`  NaN is a real key:                has(NaN) = ${map.has(NaN)}`);
  console.log(`  value-equal Decimals collide:     get(new Decimal('1.5')) = '${map.get(new Decimal('1.5'))}'`);
  console.log(`  structural Complex equality:       get(cmplx(3,4)) = '${map.get(cmplx(3, 4))}'`);
  console.log(`  +0.0 and -0.0 are distinct keys:  +0='${map.get(0.0)}', -0='${map.get(-0.0)}'`);
  console.log(`  number 42 != string '42':         42='${map.get(42)}', '42'='${map.get('42')}'`);

  console.log('\nUpdate + delete:');
  map.set(42, 'UPDATED answer');
  console.log(`  after update: get(42) = '${map.get(42)}'  (size ${map.size})`);
  map.delete(null);
  console.log(`  after delete(null): has(null) = ${map.has(null)}  (size ${map.size})`);

  console.log('\nSorted entries (ordered by the sorter):');
  for (const [k, v] of map.sortedEntries()) {
    console.log(`  ${reprValue(k).padEnd(20)} => '${v}'`);
  }

  console.log(`\nStats: ${JSON.stringify(map.stats())}`);

  // ---- resize / stress check ----------------------------------------------
  console.log('\n' + '-'.repeat(60));
  console.log('Resize + round-trip check (300 numeric keys):');
  const big = new PrecisionHashMap({ precision_mode: 'fast' });
  for (let i = 0; i < 300; i++) big.set(i * 1.5, `v${i}`);
  let allFound = true;
  for (let i = 0; i < 300; i++) {
    if (big.get(i * 1.5) !== `v${i}`) { allFound = false; break; }
  }
  console.log(`  inserted 300, size = ${big.size}, all retrievable = ${allFound}`);
  console.log(`  stats: ${JSON.stringify(big.stats())}`);

  console.log('\n' + '='.repeat(60));
}

module.exports = {
  PrecisionHashMap,
};

if (require.main === module) {
  demonstrateHashMap();
}
