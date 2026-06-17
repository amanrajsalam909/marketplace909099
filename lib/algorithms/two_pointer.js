'use strict';

/*
 * Two-pointer technique built on top of the ultra-precision special-value
 * sorter (ultra_special_sort.js, used here as a module).
 *
 * Two-pointer algorithms require a sorted input and repeated compare / sum
 * operations. Both come from the precision layer:
 *
 *   - prepareNumeric() filters to finite numbers / Decimals and sorts them with
 *     PrecisionSpecialValueSorter (numbers and Decimals interleave by value);
 *   - pointer sums use Decimal.add() (exact — so 0.1 + 0.2 is exactly 0.3); and
 *   - all comparisons use the sorter's _preciseNumericCompare.
 *
 * Generic two-pointer utilities (reverse / isPalindrome / dedup) use the
 * sorter's canonical reprValue() for equality, so NaN, value-equal Decimals and
 * structural Complex numbers behave correctly.
 */

const {
  PrecisionSpecialValueSorter,
  Decimal,
  reprValue,
  reprArray,
} = require('./ultra_special_sort');

// Local Decimal helpers (negation / abs for distance math) -------------------
function negate(d) {
  const n = new Decimal(d);
  if (!n.special || n.special === 'inf') n.neg = !d.neg;
  return n;
}
function absDecimal(d) {
  const n = new Decimal(d);
  n.neg = false;
  return n;
}

class TwoPointer {
  constructor(options = {}) {
    this.sorter = new PrecisionSpecialValueSorter(options);
  }

  _toDecimal(v) { return v instanceof Decimal ? v : new Decimal(v); }
  _cmp(a, b) { return this.sorter._preciseNumericCompare(a, b); }

  _isFiniteNumeric(v) {
    return (typeof v === 'number' && Number.isFinite(v)) ||
      (v instanceof Decimal && !v.special);
  }

  // Filter to finite numerics and sort them with the precision sorter.
  prepareNumeric(arr) {
    const nums = arr.filter((v) => this._isFiniteNumeric(v));
    this.sorter.precisionSort(nums);
    return nums;
  }

  // --- classic two-pointer problems (input must be sorted) -----------------

  /** First pair (a, b) with a + b == target (exact), or null. */
  twoSum(sorted, target) {
    const t = this._toDecimal(target);
    let l = 0;
    let r = sorted.length - 1;
    while (l < r) {
      const sum = this._toDecimal(sorted[l]).add(this._toDecimal(sorted[r]));
      const c = this._cmp(sum, t);
      if (c === 0) return [sorted[l], sorted[r]];
      if (c < 0) l++;
      else r--;
    }
    return null;
  }

  /** All distinct-value pairs summing exactly to target. */
  allPairsWithSum(sorted, target) {
    const t = this._toDecimal(target);
    const res = [];
    let l = 0;
    let r = sorted.length - 1;
    while (l < r) {
      const dl = this._toDecimal(sorted[l]);
      const dr = this._toDecimal(sorted[r]);
      const c = this._cmp(dl.add(dr), t);
      if (c === 0) {
        res.push([sorted[l], sorted[r]]);
        l++; r--;
        while (l < r && this._cmp(this._toDecimal(sorted[l]), dl) === 0) l++;
        while (l < r && this._cmp(this._toDecimal(sorted[r]), dr) === 0) r--;
      } else if (c < 0) l++;
      else r--;
    }
    return res;
  }

  /** Pair whose sum is closest to target (by exact Decimal distance). */
  closestPairSum(sorted, target) {
    const t = this._toDecimal(target);
    let l = 0;
    let r = sorted.length - 1;
    let best = null;
    let bestDiff = null;
    while (l < r) {
      const sum = this._toDecimal(sorted[l]).add(this._toDecimal(sorted[r]));
      const diff = absDecimal(sum.add(negate(t)));
      if (bestDiff === null || this._cmp(diff, bestDiff) < 0) {
        bestDiff = diff;
        best = [sorted[l], sorted[r]];
      }
      const c = this._cmp(sum, t);
      if (c === 0) break;
      if (c < 0) l++;
      else r--;
    }
    return { pair: best, sum: best ? this._toDecimal(best[0]).add(this._toDecimal(best[1])) : null };
  }

  /** All distinct triples summing exactly to target (default 0). */
  threeSum(sorted, target = 0) {
    const res = [];
    const n = sorted.length;
    for (let i = 0; i < n - 2; i++) {
      if (i > 0 && this._cmp(this._toDecimal(sorted[i]), this._toDecimal(sorted[i - 1])) === 0) continue;
      const need = this._toDecimal(target).add(negate(this._toDecimal(sorted[i])));
      let l = i + 1;
      let r = n - 1;
      while (l < r) {
        const dl = this._toDecimal(sorted[l]);
        const dr = this._toDecimal(sorted[r]);
        const c = this._cmp(dl.add(dr), need);
        if (c === 0) {
          res.push([sorted[i], sorted[l], sorted[r]]);
          l++; r--;
          while (l < r && this._cmp(this._toDecimal(sorted[l]), dl) === 0) l++;
          while (l < r && this._cmp(this._toDecimal(sorted[r]), dr) === 0) r--;
        } else if (c < 0) l++;
        else r--;
      }
    }
    return res;
  }

  // --- generic two-pointer utilities (canonical equality) ------------------

  /** Reverse in place using two pointers. */
  reverse(arr) {
    let l = 0;
    let r = arr.length - 1;
    while (l < r) {
      [arr[l], arr[r]] = [arr[r], arr[l]];
      l++; r--;
    }
    return arr;
  }

  /** Palindrome check via converging pointers (canonical equality). */
  isPalindrome(arr) {
    let l = 0;
    let r = arr.length - 1;
    while (l < r) {
      if (reprValue(arr[l]) !== reprValue(arr[r])) return false;
      l++; r--;
    }
    return true;
  }

  /** Remove consecutive duplicates from a sorted array (slow/fast pointers). */
  dedupSorted(sorted) {
    if (sorted.length === 0) return [];
    const out = [sorted[0]];
    for (let fast = 1; fast < sorted.length; fast++) {
      if (reprValue(sorted[fast]) !== reprValue(out[out.length - 1])) out.push(sorted[fast]);
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Demonstration
// ---------------------------------------------------------------------------
function demonstrateTwoPointer() {
  console.log('TWO-POINTER TECHNIQUE (precision sums via the sorter)');
  console.log('='.repeat(60));

  const tp = new TwoPointer({ precision_mode: 'maximum' });

  // Mixed input with special values that get filtered out of numeric work.
  const raw = [4, 1, 0.2, 3, NaN, 0.1, 2, Infinity, 0.3, 5, -Infinity];
  const sorted = tp.prepareNumeric(raw);
  console.log(`\nRaw input: ${reprArray(raw)}`);
  console.log(`Finite numerics, sorted: ${reprArray(sorted)}`);

  // Exact-sum win: 0.1 + 0.2 == 0.3 (float can't).
  console.log('\nExact pair sum (float 0.1 + 0.2 = ' + (0.1 + 0.2) + '):');
  console.log(`  twoSum(target = 0.3): ${reprArray(tp.twoSum(sorted, 0.3))}`);

  console.log('\nMore queries:');
  console.log(`  twoSum(target = 7):        ${reprArray(tp.twoSum(sorted, 7))}`);
  console.log(`  twoSum(target = 100):      ${tp.twoSum(sorted, 100) === null ? 'no pair' : ''}`);
  console.log(`  allPairsWithSum(5):        ${tp.allPairsWithSum(sorted, 5).map(reprArray).join(', ')}`);

  const closest = tp.closestPairSum(sorted, 5.15);
  console.log(`  closestPairSum(5.15):      ${reprArray(closest.pair)} (sum ${closest.sum.toString()})`);

  console.log(`  threeSum(target = 6):      ${tp.threeSum(sorted, 6).map(reprArray).join(', ')}`);

  // threeSum == 0 with negatives
  const sym = tp.prepareNumeric([-3, -1, 0, 1, 2, 3, -2, 4]);
  console.log(`\nthreeSum(target = 0) on ${reprArray(sym)}:`);
  console.log(`  ${tp.threeSum(sym, 0).map(reprArray).join(', ')}`);

  // Generic utilities
  console.log('\n' + '-'.repeat(60));
  console.log('Generic two-pointer utilities (canonical equality):');
  console.log(`  reverse([1,2,3,4,5]): ${reprArray(tp.reverse([1, 2, 3, 4, 5]))}`);
  console.log(`  isPalindrome([1, 2, NaN, 2, 1]): ${tp.isPalindrome([1, 2, NaN, 2, 1])}`);
  console.log(`  isPalindrome([1, 2, 3]):         ${tp.isPalindrome([1, 2, 3])}`);

  const dupInput = tp.prepareNumeric([1, 1, 2, 2, 2, 3, new Decimal('3'), 4, 4]);
  console.log(`  dedupSorted(${reprArray(dupInput)}):`);
  console.log(`    -> ${reprArray(tp.dedupSorted(dupInput))}`);

  console.log('\n' + '='.repeat(60));
}

module.exports = {
  TwoPointer,
};

if (require.main === module) {
  demonstrateTwoPointer();
}
