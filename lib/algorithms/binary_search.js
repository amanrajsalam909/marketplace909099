'use strict';

/*
 * Precision binary search built on top of the ultra-precision special-value
 * sorter (ultra_special_sort.js, used here as a module).
 *
 * The sorter does NOT order values by a single comparator — it buckets them
 * (None / NaN / -inf / numbers / numeric-strings / complex / other / +inf /
 * complex-inf …) and concatenates the buckets in a fixed order. To binary
 * search an array that the sorter produced, we need a comparator that
 * reproduces that exact total order. `PrecisionBinarySearch.compare` does that:
 * first by bucket rank, then within a bucket using the sorter's own numeric /
 * string / complex comparison helpers.
 */

const {
  PrecisionSpecialValueSorter,
  SpecialValueType,
  Complex,
  Decimal,
  reprValue,
  reprArray,
} = require('./ultra_special_sort');

class PrecisionBinarySearch {
  constructor(options = {}) {
    // The searcher owns a sorter so the ordering policies (nan/none placement,
    // complex handling, precision mode) match between sort and search.
    this.options = options;
    this.sorter = new PrecisionSpecialValueSorter(options);
  }

  // ---- ordering consistent with the sorter's reconstructed array ----------

  // Bucket rank: lower comes first. Mirrors _precision_reconstruct_array().
  _rank(value) {
    const S = SpecialValueType;
    const s = this.sorter;
    const cls = s._ultraPreciseClassify(value);
    const nanAtStart = ['start', 'preserve_quiet_signaling'].includes(s.nanPolicy);
    const noneAtStart = s.nonePolicy === 'start';

    switch (cls) {
      case S.NONE:
        return noneAtStart ? 0 : 90;
      case S.SNAN:
      case S.NAN:
      case S.DECIMAL_NAN:
      case S.COMPLEX_NAN:
        return nanAtStart ? 5 : 80;
      case S.NEGATIVE_INFINITY:
        return 10;
      case S.SUBNORMAL:
      case S.NEGATIVE_ZERO:
      case S.POSITIVE_ZERO:
        return 20; // numeric bucket
      case S.REGULAR:
        if (value instanceof Complex) return 40;
        if (typeof value === 'string' && s._isNumericString(value)) return 30;
        if (s._isNumeric(value) && typeof value !== 'string') return 20;
        return 50; // other (non-numeric string / object)
      case S.POSITIVE_INFINITY:
      case S.DECIMAL_INF:
        return 60;
      case S.COMPLEX_INF:
        return 70;
      default:
        return 50;
    }
  }

  // Within-bucket comparison, reusing the sorter's helpers.
  _within(a, b, rank) {
    const s = this.sorter;
    if (rank === 20 || rank === 30) {
      // numbers / decimals / numeric strings
      return s._preciseNumericCompare(a, b);
    }
    if (rank === 40) {
      if (s.complexHandling === 'real_part') {
        const ka = a.real;
        const kb = b.real;
        return (ka > kb) - (ka < kb);
      }
      if (s.complexHandling === 'magnitude') {
        const ka = a.abs();
        const kb = b.abs();
        if (Number.isNaN(ka) || Number.isNaN(kb)) return 0;
        return (ka > kb) - (ka < kb);
      }
      return 0; // 'separate' keeps original order — not searchable by value
    }
    if (rank === 50) {
      const sa = String(a);
      const sb = String(b);
      return (sa > sb) - (sa < sb);
    }
    // inf / nan / none buckets: members are equivalent for search purposes
    return 0;
  }

  compare(a, b) {
    const ra = this._rank(a);
    const rb = this._rank(b);
    if (ra !== rb) return ra < rb ? -1 : 1;
    return this._within(a, b, ra);
  }

  // ---- sorting + searching -------------------------------------------------

  // Sort a copy with the underlying precision sorter.
  sort(arr) {
    const copy = arr.slice();
    this.sorter.precisionSort(copy);
    return copy;
  }

  /**
   * Binary search `sortedArr` (already ordered by this searcher / sorter) for a
   * value equivalent to `target`. Returns the index of a match, or -1.
   */
  search(sortedArr, target) {
    let lo = 0;
    let hi = sortedArr.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const c = this.compare(target, sortedArr[mid]);
      if (c === 0) return mid;
      if (c < 0) hi = mid - 1;
      else lo = mid + 1;
    }
    return -1;
  }

  contains(sortedArr, target) {
    return this.search(sortedArr, target) !== -1;
  }

  /** Leftmost index where `target` could be inserted while keeping order. */
  insertionIndex(sortedArr, target) {
    let lo = 0;
    let hi = sortedArr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.compare(sortedArr[mid], target) < 0) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Inclusive [first, last] index range of values equivalent to `target`. */
  searchRange(sortedArr, target) {
    const first = this.insertionIndex(sortedArr, target);
    if (first >= sortedArr.length || this.compare(sortedArr[first], target) !== 0) {
      return [-1, -1];
    }
    // upper bound
    let lo = first;
    let hi = sortedArr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.compare(sortedArr[mid], target) <= 0) lo = mid + 1;
      else hi = mid;
    }
    return [first, lo - 1];
  }

  /** Convenience: sort `arr`, then locate `target` in the sorted result. */
  sortAndSearch(arr, target) {
    const sorted = this.sort(arr);
    return { sorted, index: this.search(sorted, target) };
  }
}

// Module-level convenience wrappers ------------------------------------------
function precisionBinarySearch(sortedArr, target, options = {}) {
  return new PrecisionBinarySearch(options).search(sortedArr, target);
}

function sortAndSearch(arr, target, options = {}) {
  return new PrecisionBinarySearch(options).sortAndSearch(arr, target);
}

// ---------------------------------------------------------------------------
// Demonstration
// ---------------------------------------------------------------------------
function demonstrateBinarySearch() {
  const { cmplx } = require('./ultra_special_sort');
  const FLOAT_INFO = require('./ultra_special_sort').FLOAT_INFO;
  const subnormal = FLOAT_INFO.min / 2;

  console.log('PRECISION BINARY SEARCH (built on the special-value sorter)');
  console.log('='.repeat(60));

  const searcher = new PrecisionBinarySearch({ precision_mode: 'maximum', zero_distinction: true });

  const data = [
    NaN, -Infinity, 2.5, '1.5', null, 1.0, Infinity, -1.5,
    subnormal, 0.0, '3.25', 42, new Decimal('7.5'), '-2.75',
  ];

  const sorted = searcher.sort(data);
  console.log(`\nUnsorted: ${reprArray(data)}`);
  console.log(`Sorted:   ${reprArray(sorted)}`);

  const queries = [
    2.5,                 // number present
    3.3,                 // number absent
    Infinity,            // +inf
    -Infinity,           // -inf
    NaN,                 // any NaN
    null,                // None
    '1.5',               // numeric string present
    '9.9',               // numeric string absent
    new Decimal('7.5'),  // decimal present
    subnormal,           // subnormal present
    42,                  // integer present
  ];

  console.log('\nSearches:');
  for (const q of queries) {
    const idx = searcher.search(sorted, q);
    if (idx !== -1) {
      console.log(`  find ${reprValue(q).padEnd(24)} -> index ${idx}  (value: ${reprValue(sorted[idx])})`);
    } else {
      const ins = searcher.insertionIndex(sorted, q);
      console.log(`  find ${reprValue(q).padEnd(24)} -> NOT FOUND (would insert at index ${ins})`);
    }
  }

  // ---- consistency self-check: every element must be findable -------------
  console.log('\nConsistency check (every sorted element is findable):');
  let ok = true;
  for (let i = 0; i < sorted.length; i++) {
    const idx = searcher.search(sorted, sorted[i]);
    if (idx === -1 || searcher.compare(sorted[idx], sorted[i]) !== 0) {
      ok = false;
      console.log(`  ✗ element at ${i} (${reprValue(sorted[i])}) not found`);
    }
  }
  console.log(ok ? '  ✅ all elements found — comparator agrees with sorter ordering' : '  ❌ mismatch detected');

  // ---- classic numeric binary search --------------------------------------
  console.log('\nPlain numeric array:');
  const nums = [9, 3, 7, 1, 8, 2, 5, 4, 6, 0];
  const numSorted = searcher.sort(nums);
  console.log(`  sorted: ${reprArray(numSorted)}`);
  for (const t of [5, 0, 9, 10, -1]) {
    const idx = searcher.search(numSorted, t);
    console.log(`  find ${String(t).padStart(3)} -> ${idx === -1 ? 'NOT FOUND' : 'index ' + idx}`);
  }

  // ---- duplicate range search ---------------------------------------------
  console.log('\nRange search with duplicates:');
  const dupSorted = searcher.sort([5, 1, 5, 3, 5, 2, 5, 4]);
  console.log(`  sorted: ${reprArray(dupSorted)}`);
  const [lo, hi] = searcher.searchRange(dupSorted, 5);
  console.log(`  value 5 occupies index range [${lo}, ${hi}] (${hi - lo + 1} occurrences)`);

  console.log('\n' + '='.repeat(60));
}

module.exports = {
  PrecisionBinarySearch,
  precisionBinarySearch,
  sortAndSearch,
};

if (require.main === module) {
  demonstrateBinarySearch();
}
