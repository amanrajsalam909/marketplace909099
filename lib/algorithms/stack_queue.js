'use strict';

/*
 * Stack (LIFO) and Queue (FIFO) built on top of the ultra-precision
 * special-value sorter (ultra_special_sort.js, used here as a module).
 *
 * The push/pop and enqueue/dequeue semantics are ordinary; the sorter adds
 * special-value-aware extras that a plain array can't do cleanly:
 *
 *   - toSorted()  -> a snapshot in the sorter's total order (-inf < numbers <
 *                    numeric-strings < ... < +inf < nan < None);
 *   - min()/max() -> the extremes of that order;
 *   - contains()  -> canonical equality via reprValue(), so NaN, value-equal
 *                    Decimals and structural Complex numbers match correctly.
 */

const {
  PrecisionSpecialValueSorter,
  reprValue,
  reprArray,
} = require('./ultra_special_sort');

// Shared sorter-powered helpers ---------------------------------------------
function sortedSnapshot(sorter, arr) {
  const copy = arr.slice();
  sorter.precisionSort(copy);
  return copy;
}

function containsValue(arr, value) {
  const k = reprValue(value);
  return arr.some((x) => reprValue(x) === k);
}

// ---------------------------------------------------------------------------
// Stack (LIFO)
// ---------------------------------------------------------------------------
class PrecisionStack {
  constructor(options = {}) {
    this.sorter = new PrecisionSpecialValueSorter(options);
    this._items = [];
  }

  push(value) { this._items.push(value); return this; }
  pop() { return this._items.pop(); }
  peek() { return this._items[this._items.length - 1]; }
  isEmpty() { return this._items.length === 0; }
  get size() { return this._items.length; }
  clear() { this._items = []; return this; }

  toArray() { return this._items.slice(); }          // bottom -> top
  contains(value) { return containsValue(this._items, value); }

  // sorter-powered views
  toSorted() { return sortedSnapshot(this.sorter, this._items); }
  min() { return this.isEmpty() ? undefined : this.toSorted()[0]; }
  max() { const s = this.toSorted(); return s.length ? s[s.length - 1] : undefined; }

  toString() { return `Stack(bottom->top) ${reprArray(this._items)}`; }
}

// ---------------------------------------------------------------------------
// Queue (FIFO) — linked list, O(1) enqueue/dequeue
// ---------------------------------------------------------------------------
class PrecisionQueue {
  constructor(options = {}) {
    this.sorter = new PrecisionSpecialValueSorter(options);
    this._head = null;
    this._tail = null;
    this._size = 0;
  }

  enqueue(value) {
    const node = { value, next: null };
    if (this._tail) this._tail.next = node;
    else this._head = node;
    this._tail = node;
    this._size++;
    return this;
  }

  dequeue() {
    if (!this._head) return undefined;
    const node = this._head;
    this._head = node.next;
    if (!this._head) this._tail = null;
    this._size--;
    return node.value;
  }

  front() { return this._head ? this._head.value : undefined; }
  back() { return this._tail ? this._tail.value : undefined; }
  isEmpty() { return this._size === 0; }
  get size() { return this._size; }
  clear() { this._head = this._tail = null; this._size = 0; return this; }

  toArray() {                                         // front -> back
    const out = [];
    for (let n = this._head; n; n = n.next) out.push(n.value);
    return out;
  }
  contains(value) { return containsValue(this.toArray(), value); }

  // sorter-powered views
  toSorted() { return sortedSnapshot(this.sorter, this.toArray()); }
  min() { return this.isEmpty() ? undefined : this.toSorted()[0]; }
  max() { const s = this.toSorted(); return s.length ? s[s.length - 1] : undefined; }

  toString() { return `Queue(front->back) ${reprArray(this.toArray())}`; }
}

// ---------------------------------------------------------------------------
// Demonstration
// ---------------------------------------------------------------------------
function demonstrateStackQueue() {
  const { Decimal, cmplx } = require('./ultra_special_sort');

  console.log('PRECISION STACK & QUEUE (special-value aware via the sorter)');
  console.log('='.repeat(60));

  // ---- Stack (LIFO) -------------------------------------------------------
  console.log('\nSTACK (LIFO):');
  const stack = new PrecisionStack({ precision_mode: 'maximum' });
  for (const v of [3, NaN, -Infinity, new Decimal('1.5'), Infinity, 2, '2.5']) stack.push(v);
  console.log(`  ${stack.toString()}`);
  console.log(`  peek: ${reprValue(stack.peek())}, size: ${stack.size}`);

  const popped = [];
  while (!stack.isEmpty()) popped.push(stack.pop());
  console.log(`  pop order (LIFO): ${reprArray(popped)}`);

  // refill to show the sorter-powered views
  for (const v of [3, NaN, -Infinity, new Decimal('1.5'), Infinity, 2, '2.5']) stack.push(v);
  console.log(`  toSorted(): ${reprArray(stack.toSorted())}`);
  console.log(`  min: ${reprValue(stack.min())}, max: ${reprValue(stack.max())}`);
  console.log(`  contains(new Decimal('1.5')): ${stack.contains(new Decimal('1.5'))}`);
  console.log(`  contains(NaN): ${stack.contains(NaN)}`);
  console.log(`  contains(99): ${stack.contains(99)}`);

  // ---- Queue (FIFO) -------------------------------------------------------
  console.log('\nQUEUE (FIFO):');
  const queue = new PrecisionQueue({ precision_mode: 'maximum' });
  for (const v of [3, NaN, -Infinity, cmplx(3, 4), Infinity, 2, null]) queue.enqueue(v);
  console.log(`  ${queue.toString()}`);
  console.log(`  front: ${reprValue(queue.front())}, back: ${reprValue(queue.back())}, size: ${queue.size}`);

  const drained = [];
  while (!queue.isEmpty()) drained.push(queue.dequeue());
  console.log(`  dequeue order (FIFO): ${reprArray(drained)}`);

  // refill for sorter-powered views
  for (const v of [3, NaN, -Infinity, cmplx(3, 4), Infinity, 2, null]) queue.enqueue(v);
  console.log(`  toSorted(): ${reprArray(queue.toSorted())}`);
  console.log(`  min: ${reprValue(queue.min())}, max: ${reprValue(queue.max())}`);
  console.log(`  contains(cmplx(3,4)): ${queue.contains(cmplx(3, 4))}`);
  console.log(`  contains(null): ${queue.contains(null)}`);

  // ---- round-trip / ordering sanity ---------------------------------------
  console.log('\n' + '-'.repeat(60));
  console.log('Behaviour check:');
  const s = new PrecisionStack();
  const q = new PrecisionQueue();
  for (let i = 1; i <= 5; i++) { s.push(i); q.enqueue(i); }
  const sOut = []; while (!s.isEmpty()) sOut.push(s.pop());
  const qOut = []; while (!q.isEmpty()) qOut.push(q.dequeue());
  console.log(`  stack reverses input: ${reprArray(sOut)}  (LIFO)`);
  console.log(`  queue preserves input: ${reprArray(qOut)}  (FIFO)`);

  console.log('\n' + '='.repeat(60));
}

module.exports = {
  PrecisionStack,
  PrecisionQueue,
};

if (require.main === module) {
  demonstrateStackQueue();
}
