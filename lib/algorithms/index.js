// Barrel module for the precision-algorithms toolkit.
//
// Everything is built on ultra_special_sort.js — a comparator engine that
// gives a *total order* over values JS normally chokes on (NaN, ±Infinity,
// signed zero, IEEE-754 subnormals, arbitrary-precision Decimal, Complex).
// The data structures and algorithms below reuse that ordering so sums,
// lookups and rankings stay exact even with money / odd inputs.
//
//   const { TwoPointer, Decimal, PrecisionBinarySearch } = require('../lib/algorithms');
//
// Each source file still runs its own demo when executed directly
// (`node lib/algorithms/<file>.js`); requiring it here does NOT run the demo.

const core = require('./ultra_special_sort');
const { PrecisionBinarySearch, precisionBinarySearch, sortAndSearch } = require('./binary_search');
const { WeightedPrecisionGraph } = require('./dijkstra');
const { PrecisionGraph } = require('./graph_traversal');
const { PrecisionHashMap } = require('./hash_table');
const { SlidingWindow } = require('./sliding_window');
const { PrecisionStack, PrecisionQueue } = require('./stack_queue');
const { TwoPointer } = require('./two_pointer');

module.exports = {
  // --- core engine ---
  Complex: core.Complex,
  cmplx: core.cmplx,
  Decimal: core.Decimal,
  DecimalContext: core.DecimalContext,
  SpecialValueType: core.SpecialValueType,
  ValueMetrics: core.ValueMetrics,
  PrecisionSpecialValueSorter: core.PrecisionSpecialValueSorter,
  ultraPrecisionSort: core.ultraPrecisionSort,
  analyzeValuePrecision: core.analyzeValuePrecision,
  FLOAT_INFO: core.FLOAT_INFO,
  reprValue: core.reprValue,
  reprArray: core.reprArray,

  // --- data structures ---
  PrecisionHashMap,
  PrecisionStack,
  PrecisionQueue,

  // --- algorithms ---
  PrecisionBinarySearch,
  precisionBinarySearch,
  sortAndSearch,
  WeightedPrecisionGraph,
  PrecisionGraph,
  SlidingWindow,
  TwoPointer,

  // Run every module's built-in demo in sequence.
  runAllDemos() {
    const files = [
      'ultra_special_sort', 'binary_search', 'two_pointer', 'sliding_window',
      'stack_queue', 'hash_table', 'graph_traversal', 'dijkstra',
    ];
    const { execFileSync } = require('child_process');
    const path = require('path');
    for (const f of files) {
      console.log(`\n╔${'═'.repeat(58)}`);
      console.log(`║ DEMO: ${f}`);
      console.log(`╚${'═'.repeat(58)}`);
      execFileSync(process.execPath, [path.join(__dirname, `${f}.js`)], { stdio: 'inherit' });
    }
  },
};

if (require.main === module) {
  module.exports.runAllDemos();
}
