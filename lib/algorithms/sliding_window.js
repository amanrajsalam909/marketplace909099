'use strict';

/*
 * Sliding-window technique built on top of the ultra-precision special-value
 * sorter (ultra_special_sort.js, used here as a module).
 *
 * The precision layer supplies the two operations a sliding window leans on:
 *
 *   - running window sums/averages use exact Decimal arithmetic (add/divide),
 *     so a window over 0.1, 0.2 sums to exactly 0.3; and
 *   - window max/min use a monotonic deque ordered by the sorter's
 *     _preciseNumericCompare.
 *
 * The "longest distinct-element window" variant uses canonical reprValue()
 * equality, so NaN, value-equal Decimals and structural Complex numbers count
 * as duplicates correctly.
 */

const {
  PrecisionSpecialValueSorter,
  Decimal,
  reprValue,
  reprArray,
} = require('./ultra_special_sort');

function negate(d) {
  const n = new Decimal(d);
  if (!n.special || n.special === 'inf') n.neg = !d.neg;
  return n;
}

class SlidingWindow {
  constructor(options = {}) {
    this.sorter = new PrecisionSpecialValueSorter(options);
  }

  _toDecimal(v) { return v instanceof Decimal ? v : new Decimal(v); }
  _cmp(a, b) { return this.sorter._preciseNumericCompare(a, b); }

  // --- fixed-size windows ---------------------------------------------------

  /** Exact sums of every window of length k. */
  windowSums(arr, k) {
    if (arr.length < k || k <= 0) return [];
    const sums = [];
    let sum = new Decimal('0');
    for (let i = 0; i < k; i++) sum = sum.add(this._toDecimal(arr[i]));
    sums.push(sum);
    for (let i = k; i < arr.length; i++) {
      sum = sum.add(this._toDecimal(arr[i])).add(negate(this._toDecimal(arr[i - k])));
      sums.push(sum);
    }
    return sums;
  }

  /** Maximum window sum of length k (exact). */
  maxSum(arr, k) {
    const sums = this.windowSums(arr, k);
    if (!sums.length) return null;
    let best = sums[0];
    for (const s of sums) if (this._cmp(s, best) > 0) best = s;
    return best;
  }

  /** Exact averages of every window of length k. */
  windowAverages(arr, k) {
    const kDec = new Decimal(k);
    return this.windowSums(arr, k).map((s) => s.divide(kDec));
  }

  /** Maximum element of every window of length k (monotonic deque). */
  windowMaximums(arr, k) {
    const res = [];
    const dq = []; // indices, values non-increasing
    for (let i = 0; i < arr.length; i++) {
      while (dq.length && dq[0] <= i - k) dq.shift();
      while (dq.length && this._cmp(arr[dq[dq.length - 1]], arr[i]) <= 0) dq.pop();
      dq.push(i);
      if (i >= k - 1) res.push(arr[dq[0]]);
    }
    return res;
  }

  /** Minimum element of every window of length k (monotonic deque). */
  windowMinimums(arr, k) {
    const res = [];
    const dq = []; // indices, values non-decreasing
    for (let i = 0; i < arr.length; i++) {
      while (dq.length && dq[0] <= i - k) dq.shift();
      while (dq.length && this._cmp(arr[dq[dq.length - 1]], arr[i]) >= 0) dq.pop();
      dq.push(i);
      if (i >= k - 1) res.push(arr[dq[0]]);
    }
    return res;
  }

  // --- variable-size windows ------------------------------------------------

  /**
   * Smallest window length whose sum is >= target (assumes non-negative values).
   * Returns { length, range:[l,r], sum } or null.
   */
  minLenSumAtLeast(arr, target) {
    const t = this._toDecimal(target);
    let l = 0;
    let sum = new Decimal('0');
    let best = null;
    for (let r = 0; r < arr.length; r++) {
      sum = sum.add(this._toDecimal(arr[r]));
      while (this._cmp(sum, t) >= 0) {
        if (best === null || r - l + 1 < best.length) {
          best = { length: r - l + 1, range: [l, r], sum: new Decimal(sum) };
        }
        sum = sum.add(negate(this._toDecimal(arr[l])));
        l++;
      }
    }
    return best;
  }

  /**
   * Longest contiguous window with all-distinct elements (canonical equality).
   * Returns { length, range:[l,r], subarray }.
   */
  longestDistinct(arr) {
    const seen = new Map(); // repr -> last index
    let l = 0;
    let best = { length: 0, range: [0, -1] };
    for (let r = 0; r < arr.length; r++) {
      const key = reprValue(arr[r]);
      if (seen.has(key) && seen.get(key) >= l) l = seen.get(key) + 1;
      seen.set(key, r);
      if (r - l + 1 > best.length) best = { length: r - l + 1, range: [l, r] };
    }
    return { ...best, subarray: arr.slice(best.range[0], best.range[1] + 1) };
  }
}

// ---------------------------------------------------------------------------
// Demonstration
// ---------------------------------------------------------------------------
function demonstrateSlidingWindow() {
  console.log('SLIDING WINDOW TECHNIQUE (precision sums/extrema via the sorter)');
  console.log('='.repeat(60));

  const sw = new SlidingWindow({ precision_mode: 'maximum' });

  const data = [0.1, 0.2, 0.3, 1, 2, 3, 4];
  const k = 3;
  console.log(`\nData: ${reprArray(data)}   window size k = ${k}`);

  console.log('\nFixed-size windows:');
  console.log(`  windowSums:     ${reprArray(sw.windowSums(data, k).map((d) => d.toString()))}`);
  console.log(`  maxSum:         ${sw.maxSum(data, k).toString()}`);
  console.log(`  windowAverages: ${reprArray(sw.windowAverages(data, k).map((d) => d.toString()))}`);
  console.log(`  windowMaximums: ${reprArray(sw.windowMaximums(data, k))}`);
  console.log(`  windowMinimums: ${reprArray(sw.windowMinimums(data, k))}`);

  // Exactness highlight
  console.log('\nExact running sum (float 0.1 + 0.2 + 0.3):');
  console.log(`  float:   ${0.1 + 0.2 + 0.3}`);
  console.log(`  Decimal: ${sw.windowSums(data, k)[0].toString()}  (first window [0.1, 0.2, 0.3])`);

  console.log('\nVariable-size windows:');
  const need = sw.minLenSumAtLeast(data, 6);
  console.log(`  minLenSumAtLeast(target = 6): length ${need.length}, ` +
    `window ${reprArray(data.slice(need.range[0], need.range[1] + 1))}, sum ${need.sum.toString()}`);

  const seq = [1, 2, 1, 3, NaN, 3, new Decimal('2'), 2, NaN];
  const ld = sw.longestDistinct(seq);
  console.log(`\nlongestDistinct on ${reprArray(seq)}:`);
  console.log(`  length ${ld.length}, window ${reprArray(ld.subarray)}`);

  // window max/min with special values
  console.log('\nWindow extrema with special values:');
  const special = [3, Infinity, 1, -Infinity, 2, 5, 4];
  console.log(`  data: ${reprArray(special)}  (k=3)`);
  console.log(`  maximums: ${reprArray(sw.windowMaximums(special, 3))}`);
  console.log(`  minimums: ${reprArray(sw.windowMinimums(special, 3))}`);

  console.log('\n' + '='.repeat(60));
}

module.exports = {
  SlidingWindow,
};

if (require.main === module) {
  demonstrateSlidingWindow();
}
