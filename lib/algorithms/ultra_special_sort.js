'use strict';

/*
 * Ultra-precision special value sorting algorithm — JavaScript port of
 * ultra_special_sort.py.
 *
 * JavaScript lacks Python's native `complex` and arbitrary-precision `decimal.Decimal`
 * types, so this file provides small `Complex` and BigInt-backed `Decimal` helper
 * classes sufficient to reproduce the Python behaviour. `None` is represented as
 * JavaScript `null`, `float('nan')`/`float('inf')` as `NaN`/`Infinity`, and all
 * JavaScript numbers are IEEE 754 binary64 (so every number is treated as a "float").
 */

// ---------------------------------------------------------------------------
// float_info equivalents (IEEE 754 binary64)
// ---------------------------------------------------------------------------
const FLOAT_INFO = {
  min: 2.2250738585072014e-308,      // smallest positive *normal* double
  max: 1.7976931348623157e+308,      // largest finite double
  epsilon: 2.220446049250313e-16,    // Number.EPSILON
};

// Mutable decimal context, mirroring Python's decimal.getcontext().prec
const DecimalContext = { prec: 28 };

// ---------------------------------------------------------------------------
// Helpers mimicking Python numeric semantics
// ---------------------------------------------------------------------------
function isInf(x) {
  return x === Infinity || x === -Infinity;
}

function isNegZero(x) {
  return x === 0 && 1 / x === -Infinity;
}

const _FLOAT_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

// Mimics Python's float(value): parses "inf"/"nan" strings, throws on garbage.
function pyFloat(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value !== 'string') {
    const n = Number(value);
    if (Number.isNaN(n) && String(value).trim().toLowerCase() !== 'nan') {
      throw new TypeError('could not convert to float');
    }
    return n;
  }
  const s = value.trim();
  const l = s.toLowerCase();
  if (['nan', '+nan', '-nan', 'nan()'].includes(l)) return NaN;
  if (['inf', 'infinity', '+inf', '+infinity'].includes(l)) return Infinity;
  if (['-inf', '-infinity'].includes(l)) return -Infinity;
  if (s === '' || !_FLOAT_RE.test(s)) throw new Error(`could not convert string to float: '${value}'`);
  return Number(s);
}

// ---------------------------------------------------------------------------
// Complex number (minimal)
// ---------------------------------------------------------------------------
class Complex {
  constructor(re, im) {
    this.re = re;
    this.im = im;
  }

  get real() { return this.re; }
  get imag() { return this.im; }

  abs() { return Math.hypot(this.re, this.im); }

  static parse(str) {
    let s = String(str).trim().toLowerCase().replace(/\s+/g, '');
    if (['nan', 'nan+nanj'].includes(s)) return new Complex(NaN, 0);
    if (['inf', 'infinity', '+inf', '+infinity'].includes(s)) return new Complex(Infinity, 0);
    if (['-inf', '-infinity'].includes(s)) return new Complex(-Infinity, 0);

    if (s.endsWith('j')) {
      const core = s.slice(0, -1);
      // Find the +/- that separates the real and imaginary parts (not an
      // exponent sign, not the leading sign).
      let idx = -1;
      for (let i = core.length - 1; i > 0; i--) {
        const c = core[i];
        if ((c === '+' || c === '-') && core[i - 1] !== 'e') { idx = i; break; }
      }
      if (idx <= 0) {
        let imStr = core;
        if (imStr === '' || imStr === '+') imStr = '1';
        else if (imStr === '-') imStr = '-1';
        return new Complex(0, pyFloat(imStr));
      }
      const re = pyFloat(core.slice(0, idx));
      let imStr = core.slice(idx);
      if (imStr === '+') imStr = '1';
      else if (imStr === '-') imStr = '-1';
      return new Complex(re, pyFloat(imStr));
    }
    return new Complex(pyFloat(s), 0);
  }

  toString() {
    const fmt = (x) => {
      if (Number.isNaN(x)) return 'nan';
      if (x === Infinity) return 'inf';
      if (x === -Infinity) return '-inf';
      return String(x);
    };
    const sign = (this.im < 0 || isNegZero(this.im)) ? '' : '+';
    return `(${fmt(this.re)}${sign}${fmt(this.im)}j)`;
  }
}

function cmplx(re, im) { return new Complex(re, im); }

// ---------------------------------------------------------------------------
// Arbitrary-precision Decimal (BigInt coefficient * 10^exp)
// ---------------------------------------------------------------------------
function bigIntSqrt(n) {
  if (n < 0n) throw new RangeError('sqrt of negative');
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

class Decimal {
  // special: null | 'nan' | 'inf'
  constructor(value) {
    if (value instanceof Decimal) {
      this.special = value.special;
      this.neg = value.neg;
      this.coeff = value.coeff;
      this.exp = value.exp;
      return;
    }
    this.special = null;
    this.neg = false;
    this.coeff = 0n;
    this.exp = 0;

    let s = (typeof value === 'number') ? numToDecimalString(value) : String(value);
    s = s.trim();
    const l = s.toLowerCase();
    if (['nan', '+nan', '-nan', 'snan'].includes(l)) { this.special = 'nan'; return; }
    if (['inf', 'infinity', '+inf', '+infinity'].includes(l)) { this.special = 'inf'; this.neg = false; return; }
    if (['-inf', '-infinity'].includes(l)) { this.special = 'inf'; this.neg = true; return; }

    const m = s.match(/^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/);
    if (!m || (m[2] === '' && (m[3] === undefined || m[3] === ''))) {
      throw new Error(`invalid Decimal literal: '${value}'`);
    }
    this.neg = m[1] === '-';
    const intPart = m[2] || '';
    const fracPart = m[3] || '';
    const expPart = m[4] ? parseInt(m[4], 10) : 0;
    const digits = (intPart + fracPart).replace(/^0+(?=\d)/, '') || '0';
    this.coeff = BigInt(digits);
    this.exp = expPart - fracPart.length;
  }

  static fromParts(neg, coeff, exp) {
    const d = new Decimal('0');
    d.neg = neg;
    d.coeff = coeff < 0n ? -coeff : coeff;
    d.exp = exp;
    return d;
  }

  isNan() { return this.special === 'nan'; }
  isInfinite() { return this.special === 'inf'; }

  gtZero() {
    if (this.special === 'nan') return false;
    if (this.special === 'inf') return !this.neg;
    return this.coeff !== 0n && !this.neg;
  }

  ltZero() {
    if (this.special === 'nan') return false;
    if (this.special === 'inf') return this.neg;
    return this.coeff !== 0n && this.neg;
  }

  // Round to `prec` significant digits, half-even.
  roundSig(prec) {
    if (this.special) return new Decimal(this);
    let s = this.coeff.toString();
    if (s === '0' || s.length <= prec) return Decimal.fromParts(this.neg, this.coeff, this.exp);

    const dropCount = s.length - prec;
    const keep = s.slice(0, prec);
    const dropped = s.slice(prec);
    let roundUp = false;
    const first = dropped[0];
    if (first > '5') roundUp = true;
    else if (first === '5') {
      const rest = dropped.slice(1).replace(/0+$/, '');
      if (rest.length > 0) roundUp = true;
      else roundUp = (parseInt(keep[keep.length - 1], 10) % 2 === 1);
    }
    let keepBig = BigInt(keep);
    let newExp = this.exp + dropCount;
    if (roundUp) {
      keepBig += 1n;
      if (keepBig.toString().length > prec) { keepBig /= 10n; newExp += 1; }
    }
    return Decimal.fromParts(this.neg, keepBig, newExp);
  }

  divide(other, prec = DecimalContext.prec) {
    const sign = this.neg !== other.neg;
    if (this.special || other.special) {
      if (this.isNan() || other.isNan()) return new Decimal('nan');
      if (this.isInfinite() && other.isInfinite()) return new Decimal('nan');
      if (this.isInfinite()) return Decimal.fromParts(sign, 0n, 0)._asInf(sign);
      return Decimal.fromParts(sign, 0n, 0); // finite / inf -> 0
    }
    if (other.coeff === 0n) {
      return this.coeff === 0n ? new Decimal('nan') : this._signedInf(sign);
    }
    const shift = BigInt(prec + 5);
    const num = this.coeff * (10n ** shift);
    let q = num / other.coeff;
    const rem = num % other.coeff;
    if (rem * 2n >= other.coeff) q += 1n;
    const exp = this.exp - other.exp - Number(shift);
    return Decimal.fromParts(sign, q, exp).roundSig(prec);
  }

  _signedInf(sign) { const d = new Decimal('inf'); d.neg = sign; return d; }
  _asInf(sign) { const d = new Decimal('inf'); d.neg = sign; return d; }

  // Exact addition (BigInt coefficients, no rounding).
  add(other) {
    if (this.special || other.special) {
      if (this.isNan() || other.isNan()) return new Decimal('nan');
      if (this.isInfinite() && other.isInfinite()) {
        return this.neg === other.neg ? this._signedInf(this.neg) : new Decimal('nan');
      }
      return this.isInfinite() ? this._signedInf(this.neg) : other._signedInf(other.neg);
    }
    const e = Math.min(this.exp, other.exp);
    const ca = (this.neg ? -1n : 1n) * this.coeff * (10n ** BigInt(this.exp - e));
    const cb = (other.neg ? -1n : 1n) * other.coeff * (10n ** BigInt(other.exp - e));
    let sum = ca + cb;
    const neg = sum < 0n;
    if (neg) sum = -sum;
    return Decimal.fromParts(neg, sum, e);
  }

  sqrt(prec = DecimalContext.prec) {
    if (this.special) return new Decimal(this);
    if (this.neg && this.coeff !== 0n) return new Decimal('nan');
    let coeff = this.coeff;
    let exp = this.exp;
    if (exp % 2 !== 0) { coeff *= 10n; exp -= 1; }
    const s = prec + 5;
    const A = coeff * (10n ** BigInt(2 * s));
    const r = bigIntSqrt(A);
    const newExp = exp / 2 - s;
    return Decimal.fromParts(false, r, newExp).roundSig(prec);
  }

  // Comparison rank: -inf < finite < +inf < nan (nan treated as largest, as in
  // the Python _sort_decimal_values key which maps nan -> Decimal('inf')).
  static compare(a, b) {
    const rank = (d) => {
      if (d.special === 'nan') return 3;
      if (d.special === 'inf') return d.neg ? -2 : 2;
      return 0;
    };
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra < rb ? -1 : 1;
    if (ra !== 0) return 0; // both same special class
    // both finite
    const e = Math.min(a.exp, b.exp);
    const ca = (a.neg ? -1n : 1n) * a.coeff * (10n ** BigInt(a.exp - e));
    const cb = (b.neg ? -1n : 1n) * b.coeff * (10n ** BigInt(b.exp - e));
    return ca < cb ? -1 : ca > cb ? 1 : 0;
  }

  cmp(other) { return Decimal.compare(this, other); }

  toNumber() {
    if (this.special === 'nan') return NaN;
    if (this.special === 'inf') return this.neg ? -Infinity : Infinity;
    return Number(this.toString());
  }

  toString() {
    if (this.special === 'nan') return 'NaN';
    if (this.special === 'inf') return this.neg ? '-Infinity' : 'Infinity';
    let digits = this.coeff.toString();
    let str;
    if (this.exp >= 0) {
      str = digits + '0'.repeat(this.exp);
    } else {
      const point = digits.length + this.exp;
      if (point <= 0) {
        str = '0.' + '0'.repeat(-point) + digits;
      } else {
        str = digits.slice(0, point) + '.' + digits.slice(point);
      }
      // trim trailing zeros in the fractional part
      str = str.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    }
    return (this.neg && this.coeff !== 0n ? '-' : (this.neg && this.special ? '-' : '')) + str;
  }
}

// Convert a JS number to a decimal string the Decimal parser understands
// (mirrors Python str(float) closely enough for construction).
function numToDecimalString(x) {
  if (Number.isNaN(x)) return 'nan';
  if (x === Infinity) return 'inf';
  if (x === -Infinity) return '-inf';
  return String(x);
}

// ---------------------------------------------------------------------------
// SpecialValueType enumeration
// ---------------------------------------------------------------------------
const SpecialValueType = Object.freeze({
  NEGATIVE_INFINITY: 'neg_inf',
  POSITIVE_INFINITY: 'pos_inf',
  NAN: 'nan',
  SNAN: 'signaling_nan',
  NONE: 'none',
  NEGATIVE_ZERO: 'neg_zero',
  POSITIVE_ZERO: 'pos_zero',
  SUBNORMAL: 'subnormal',
  REGULAR: 'regular',
  COMPLEX_NAN: 'complex_nan',
  COMPLEX_INF: 'complex_inf',
  DECIMAL_NAN: 'decimal_nan',
  DECIMAL_INF: 'decimal_inf',
});

class ValueMetrics {
  constructor(originalIndex, classification) {
    this.originalIndex = originalIndex;
    this.classification = classification;
    this.bitPattern = null;
    this.precisionLoss = false;
    this.conversionWarnings = [];
  }
}

// ---------------------------------------------------------------------------
// PrecisionSpecialValueSorter
// ---------------------------------------------------------------------------
class PrecisionSpecialValueSorter {
  constructor(options = {}) {
    this.nanPolicy = options.nan_policy ?? 'end';
    this.nonePolicy = options.none_policy ?? 'end';
    this.zeroDistinction = options.zero_distinction ?? true;
    this.subnormalHandling = options.subnormal_handling ?? 'preserve';
    this.precisionMode = options.precision_mode ?? 'maximum';
    this.bitAnalysis = options.bit_analysis ?? true;
    this.complexHandling = options.complex_handling ?? 'separate';
    this.decimalPrecision = options.decimal_precision ?? 50;

    DecimalContext.prec = this.decimalPrecision;

    this.valueMetrics = {};
    this.sortingStats = this._freshStats(0);
  }

  _freshStats(total) {
    return {
      total_elements: total,
      special_values: 0,
      regular_values: 0,
      comparisons: 0,
      bit_analyses: 0,
      precision_warnings: 0,
      classifications: {},
      subnormal_count: 0,
      complex_count: 0,
      decimal_count: 0,
    };
  }

  precisionSort(arr) {
    if (!arr || arr.length === 0) return;
    this._initializeSortingSession(arr);
    const analyzed = this._deepValueAnalysis(arr);
    const grouped = this._precisionGroupByType(analyzed);
    const sortedGroups = this._precisionSortGroups(grouped);
    this._precisionReconstructArray(arr, sortedGroups);
    this._validatePrecisionOrdering(arr);
  }

  _initializeSortingSession(arr) {
    this.sortingStats = this._freshStats(arr.length);
    this.sortingStats.start_time = performance.now();
    this.valueMetrics = {};
  }

  _deepValueAnalysis(arr) {
    const analyzed = [];
    for (let i = 0; i < arr.length; i++) {
      const value = arr[i];
      const metrics = new ValueMetrics(i, this._ultraPreciseClassify(value));

      if (this.bitAnalysis && typeof value === 'number') {
        metrics.bitPattern = this._analyzeFloatBits(value);
        this.sortingStats.bit_analyses += 1;
      }

      if (this.precisionMode === 'maximum') {
        this._checkPrecisionIssues(value, metrics);
      }

      analyzed.push([value, metrics]);
      this.valueMetrics[i] = metrics;
      this._updateClassificationStats(metrics.classification);
    }
    return analyzed;
  }

  _ultraPreciseClassify(value) {
    if (value === null || value === undefined) return SpecialValueType.NONE;

    if (value instanceof Complex) {
      if (Number.isNaN(value.real) || Number.isNaN(value.imag)) return SpecialValueType.COMPLEX_NAN;
      if (isInf(value.real) || isInf(value.imag)) return SpecialValueType.COMPLEX_INF;
      return SpecialValueType.REGULAR;
    }

    if (value instanceof Decimal) {
      this.sortingStats.decimal_count += 1;
      if (value.isNan()) return SpecialValueType.DECIMAL_NAN;
      if (value.isInfinite()) {
        return value.gtZero() ? SpecialValueType.DECIMAL_INF : SpecialValueType.NEGATIVE_INFINITY;
      }
      return SpecialValueType.REGULAR;
    }

    try {
      let floatVal;
      if (typeof value === 'string') {
        const lower = value.toLowerCase().trim();
        if (['nan', 'nan()', 'nan(ind)', 'nan(snan)'].includes(lower)) return SpecialValueType.NAN;
        if (['inf', 'infinity', '+inf', '+infinity'].includes(lower)) return SpecialValueType.POSITIVE_INFINITY;
        if (['-inf', '-infinity'].includes(lower)) return SpecialValueType.NEGATIVE_INFINITY;
        floatVal = pyFloat(value);
      } else {
        floatVal = pyFloat(value);
      }

      if (Number.isNaN(floatVal)) {
        if (this.bitAnalysis) {
          const bitPattern = this._analyzeFloatBits(floatVal);
          if (bitPattern && this._isSignalingNan(bitPattern)) return SpecialValueType.SNAN;
        }
        return SpecialValueType.NAN;
      }

      if (isInf(floatVal)) {
        return floatVal > 0 ? SpecialValueType.POSITIVE_INFINITY : SpecialValueType.NEGATIVE_INFINITY;
      }

      if (this._isSubnormal(floatVal)) {
        this.sortingStats.subnormal_count += 1;
        return SpecialValueType.SUBNORMAL;
      }

      if (floatVal === 0 && this.zeroDistinction) {
        return isNegZero(floatVal) ? SpecialValueType.NEGATIVE_ZERO : SpecialValueType.POSITIVE_ZERO;
      }

      return SpecialValueType.REGULAR;
    } catch (e) {
      // Non-numeric values — treat as regular for string/object sorting
      return SpecialValueType.REGULAR;
    }
  }

  _analyzeFloatBits(value) {
    try {
      // JavaScript numbers are always IEEE 754 binary64 (double precision).
      const buf = new ArrayBuffer(8);
      const dv = new DataView(buf);
      dv.setFloat64(0, Number(value)); // big-endian
      const bits = dv.getBigUint64(0);
      return bits.toString(2).padStart(64, '0');
    } catch (e) {
      return null;
    }
  }

  _isSignalingNan(bitPattern) {
    if (!bitPattern || bitPattern.length < 32) return false;

    // Signaling NaN: exponent all 1s, quiet bit (MSB of mantissa) = 0,
    // and at least one other mantissa bit set. Highly platform dependent.
    if (bitPattern.length === 32) {
      const exponent = bitPattern.slice(1, 9);
      const mantissaMsb = bitPattern[9];
      return exponent === '11111111' && mantissaMsb === '0' &&
        [...bitPattern.slice(10)].some((b) => b === '1');
    }

    if (bitPattern.length === 64) {
      const exponent = bitPattern.slice(1, 12);
      const mantissaMsb = bitPattern[12];
      return exponent === '11111111111' && mantissaMsb === '0' &&
        [...bitPattern.slice(13)].some((b) => b === '1');
    }

    return false;
  }

  _isSubnormal(value) {
    if (value === 0 || Number.isNaN(value) || isInf(value)) return false;
    const absVal = Math.abs(value);
    return absVal < FLOAT_INFO.min && absVal > 0;
  }

  _checkPrecisionIssues(value, metrics) {
    try {
      if (typeof value === 'number') {
        // NaN/inf are not "precision loss" (nan !== nan is always true).
        if (Number.isNaN(value) || isInf(value)) return;
        const strRepr = String(value);
        const reconstructed = Number(strRepr);
        if (reconstructed !== value) {
          metrics.precisionLoss = true;
          metrics.conversionWarnings.push('Float precision loss in string conversion');
          this.sortingStats.precision_warnings += 1;
        }
      } else if (typeof value === 'string') {
        try {
          const floatVal = pyFloat(value);
          if (!(Number.isNaN(floatVal) || isInf(floatVal))) {
            const backToStr = String(floatVal);
            if (value !== backToStr && Number(backToStr) !== floatVal) {
              metrics.conversionWarnings.push('String-float conversion instability');
              this.sortingStats.precision_warnings += 1;
            }
          }
        } catch (e) { /* ignore */ }
      }
    } catch (e) {
      metrics.conversionWarnings.push(`Precision check failed: ${e.message}`);
    }
  }

  _updateClassificationStats(classification) {
    const typeName = classification;
    this.sortingStats.classifications[typeName] = (this.sortingStats.classifications[typeName] || 0) + 1;
    if (classification === SpecialValueType.REGULAR) {
      this.sortingStats.regular_values += 1;
    } else {
      this.sortingStats.special_values += 1;
    }
  }

  _precisionGroupByType(analyzedValues) {
    const groups = new Map();
    for (const [value, metrics] of analyzedValues) {
      const classification = metrics.classification;
      if (!groups.has(classification)) groups.set(classification, []);
      groups.get(classification).push([value, metrics]);
    }
    return groups;
  }

  _precisionSortGroups(groupedValues) {
    const sortedGroups = new Map();
    for (const [valueType, valueList] of groupedValues) {
      const values = valueList.map(([v]) => v);

      if (valueType === SpecialValueType.REGULAR) {
        sortedGroups.set(valueType, this._ultraPreciseSortRegular(values));
      } else if (valueType === SpecialValueType.SUBNORMAL) {
        sortedGroups.set(valueType, this._sortSubnormalValues(values));
      } else if (valueType === SpecialValueType.COMPLEX_NAN || valueType === SpecialValueType.COMPLEX_INF) {
        sortedGroups.set(valueType, this._sortComplexValues(values));
      } else if (valueType === SpecialValueType.DECIMAL_NAN || valueType === SpecialValueType.DECIMAL_INF) {
        sortedGroups.set(valueType, this._sortDecimalValues(values));
      } else {
        // Maintain original order for other special values (stable)
        sortedGroups.set(valueType, values);
      }
    }
    return sortedGroups;
  }

  _ultraPreciseSortRegular(values) {
    const compare = (a, b) => {
      this.sortingStats.comparisons += 1;
      try {
        if (this._isNumeric(a) && this._isNumeric(b)) {
          return this._preciseNumericCompare(a, b);
        } else if (typeof a === 'string' && typeof b === 'string') {
          return this._preciseStringCompare(a, b);
        } else {
          return this._preciseMixedCompare(a, b);
        }
      } catch (e) {
        try {
          const strA = String(a);
          const strB = String(b);
          return (strA > strB) - (strA < strB);
        } catch (e2) {
          return 0;
        }
      }
    };
    return values.slice().sort(compare);
  }

  _isNumeric(value) {
    return typeof value === 'number' || value instanceof Decimal || value instanceof Complex ||
      (typeof value === 'string' && this._isNumericString(value));
  }

  _isNumericString(value) {
    try {
      pyFloat(value);
      return true;
    } catch (e) {
      return false;
    }
  }

  _preciseNumericCompare(a, b) {
    try {
      if (this.precisionMode === 'maximum') {
        try {
          let decA;
          let decB;
          if (a instanceof Complex || b instanceof Complex) {
            const magA = a instanceof Complex ? a.abs() : Math.abs(pyFloat(a));
            const magB = b instanceof Complex ? b.abs() : Math.abs(pyFloat(b));
            decA = new Decimal(numToDecimalString(magA));
            decB = new Decimal(numToDecimalString(magB));
          } else {
            decA = a instanceof Decimal ? a : new Decimal(numToDecimalString(pyFloat(a)));
            decB = b instanceof Decimal ? b : new Decimal(numToDecimalString(pyFloat(b)));
          }
          // numeric strings should keep full precision
          if (typeof a === 'string') decA = new Decimal(a);
          if (typeof b === 'string') decB = new Decimal(b);
          const c = Decimal.compare(decA, decB);
          if (c !== 0) return c < 0 ? -1 : 1;
          return 0;
        } catch (e) { /* fall through */ }
      }

      const floatA = this._safeFloatConversion(a);
      const floatB = this._safeFloatConversion(b);

      if (Number.isNaN(floatA) && Number.isNaN(floatB)) return 0;
      if (Number.isNaN(floatA)) return 1;
      if (Number.isNaN(floatB)) return -1;

      if (isInf(floatA) || isInf(floatB)) {
        return (floatA > floatB) - (floatA < floatB);
      }

      let epsilon;
      if (Math.abs(floatA) < 1e-100 || Math.abs(floatB) < 1e-100) {
        epsilon = FLOAT_INFO.epsilon;
      } else {
        epsilon = FLOAT_INFO.epsilon * Math.max(Math.abs(floatA), Math.abs(floatB), 1.0);
      }

      if (Math.abs(floatA - floatB) <= epsilon) return 0;
      return (floatA > floatB) - (floatA < floatB);
    } catch (e) {
      return 0;
    }
  }

  _safeFloatConversion(value) {
    if (value instanceof Complex) return value.abs();
    if (value instanceof Decimal) return value.toNumber();
    return pyFloat(value);
  }

  _preciseStringCompare(a, b) {
    if (this._isNumericString(a) && this._isNumericString(b)) {
      try {
        return this._preciseNumericCompare(a, b);
      } catch (e) { /* fall through */ }
    }
    return (a > b) - (a < b);
  }

  _preciseMixedCompare(a, b) {
    const typePriority = (value) => {
      if (value === null || value === undefined) return 0;
      if (this._isNumeric(value)) return 1;
      if (typeof value === 'string') return 2;
      return 3;
    };
    const pa = typePriority(a);
    const pb = typePriority(b);
    if (pa !== pb) return pa - pb;
    try {
      const strA = String(a);
      const strB = String(b);
      return (strA > strB) - (strA < strB);
    } catch (e) {
      return 0;
    }
  }

  _sortSubnormalValues(values) {
    if (this.subnormalHandling === 'normalize') {
      return values.slice().sort((a, b) => {
        const ka = typeof a === 'number' ? a : 0;
        const kb = typeof b === 'number' ? b : 0;
        return ka - kb;
      });
    }
    return this._ultraPreciseSortRegular(values);
  }

  _sortComplexValues(values) {
    if (this.complexHandling === 'real_part') {
      return values.slice().sort((a, b) => {
        const ka = a instanceof Complex ? a.real : 0;
        const kb = b instanceof Complex ? b.real : 0;
        return (ka > kb) - (ka < kb);
      });
    } else if (this.complexHandling === 'magnitude') {
      return values.slice().sort((a, b) => {
        const ka = a instanceof Complex ? a.abs() : 0;
        const kb = b instanceof Complex ? b.abs() : 0;
        if (Number.isNaN(ka) || Number.isNaN(kb)) return 0;
        return (ka > kb) - (ka < kb);
      });
    }
    return values;
  }

  _sortDecimalValues(values) {
    const key = (x) => {
      if (x instanceof Decimal) {
        if (x.isNan()) return new Decimal('inf');
        return x;
      }
      return new Decimal('0');
    };
    return values.slice().sort((a, b) => Decimal.compare(key(a), key(b)));
  }

  _precisionReconstructArray(arr, sortedGroups) {
    arr.length = 0;

    let numericValues = [];
    let stringNumericValues = [];
    let complexValues = [];
    let otherValues = [];

    if (sortedGroups.has(SpecialValueType.REGULAR)) {
      for (const value of sortedGroups.get(SpecialValueType.REGULAR)) {
        if (value instanceof Complex) {
          complexValues.push(value);
        } else if (typeof value === 'string' && this._isNumericString(value)) {
          stringNumericValues.push(value);
        } else if (this._isNumeric(value) && typeof value !== 'string') {
          numericValues.push(value);
        } else {
          otherValues.push(value);
        }
      }
    }

    if (sortedGroups.has(SpecialValueType.SUBNORMAL)) {
      if (this.subnormalHandling !== 'group') {
        numericValues.push(...sortedGroups.get(SpecialValueType.SUBNORMAL));
      }
    }

    if (sortedGroups.has(SpecialValueType.NEGATIVE_ZERO)) {
      numericValues.push(...sortedGroups.get(SpecialValueType.NEGATIVE_ZERO));
    }
    if (sortedGroups.has(SpecialValueType.POSITIVE_ZERO)) {
      numericValues.push(...sortedGroups.get(SpecialValueType.POSITIVE_ZERO));
    }

    if (numericValues.length) numericValues = this._ultraPreciseSortRegular(numericValues);
    if (stringNumericValues.length) stringNumericValues = this._ultraPreciseSortRegular(stringNumericValues);
    if (complexValues.length) complexValues = this._sortComplexValues(complexValues);
    if (otherValues.length) otherValues = this._ultraPreciseSortRegular(otherValues);

    const nanAtStart = ['start', 'preserve_quiet_signaling'].includes(this.nanPolicy);
    const noneAtStart = this.nonePolicy === 'start';

    const extend = (type) => { if (sortedGroups.has(type)) arr.push(...sortedGroups.get(type)); };

    // 1. start policies
    if (noneAtStart) extend(SpecialValueType.NONE);
    if (nanAtStart) {
      extend(SpecialValueType.SNAN);
      extend(SpecialValueType.NAN);
      extend(SpecialValueType.DECIMAL_NAN);
      extend(SpecialValueType.COMPLEX_NAN);
    }

    // 2. negative infinity
    extend(SpecialValueType.NEGATIVE_INFINITY);
    if (sortedGroups.has(SpecialValueType.DECIMAL_INF)) {
      const negDecInf = sortedGroups.get(SpecialValueType.DECIMAL_INF)
        .filter((x) => x instanceof Decimal && x.ltZero());
      arr.push(...negDecInf);
    }

    // 3. numeric values
    arr.push(...numericValues);
    // 4. string numerics
    arr.push(...stringNumericValues);
    // 5. complex
    arr.push(...complexValues);
    // 6. other
    arr.push(...otherValues);

    // 7. grouped subnormals
    if (this.subnormalHandling === 'group' && sortedGroups.has(SpecialValueType.SUBNORMAL)) {
      arr.push(...sortedGroups.get(SpecialValueType.SUBNORMAL));
    }

    // 8. positive infinity
    extend(SpecialValueType.POSITIVE_INFINITY);
    if (sortedGroups.has(SpecialValueType.DECIMAL_INF)) {
      const posDecInf = sortedGroups.get(SpecialValueType.DECIMAL_INF)
        .filter((x) => x instanceof Decimal && x.gtZero());
      arr.push(...posDecInf);
    }
    extend(SpecialValueType.COMPLEX_INF);

    // 9. end policies
    if (!nanAtStart) {
      extend(SpecialValueType.NAN);
      extend(SpecialValueType.SNAN);
      extend(SpecialValueType.DECIMAL_NAN);
      extend(SpecialValueType.COMPLEX_NAN);
    }
    if (!noneAtStart) extend(SpecialValueType.NONE);
  }

  _validatePrecisionOrdering(arr) {
    const validationIssues = [];
    const numericPositions = [];
    const stringNumericPositions = [];
    const complexPositions = [];

    for (let i = 0; i < arr.length; i++) {
      const val = arr[i];
      if (val === null || val === undefined) continue;
      if (val instanceof Complex) {
        if (!(Number.isNaN(val.real) || Number.isNaN(val.imag) || isInf(val.real) || isInf(val.imag))) {
          complexPositions.push([i, val.abs()]);
        }
      } else if (typeof val === 'string' && this._isNumericString(val)) {
        try { stringNumericPositions.push([i, pyFloat(val)]); } catch (e) { /* */ }
      } else if (this._isNumeric(val) && typeof val !== 'string') {
        try {
          const floatVal = this._safeFloatConversion(val);
          if (!(Number.isNaN(floatVal) || isInf(floatVal))) numericPositions.push([i, floatVal]);
        } catch (e) { /* */ }
      }
    }

    const checkOrdering = (positions, categoryName) => {
      for (let j = 0; j < positions.length - 1; j++) {
        const [pos1, val1] = positions[j];
        const [pos2, val2] = positions[j + 1];
        let epsilon;
        if (Math.abs(val1) < 1e-100 || Math.abs(val2) < 1e-100) {
          epsilon = FLOAT_INFO.epsilon;
        } else {
          epsilon = FLOAT_INFO.epsilon * Math.max(Math.abs(val1), Math.abs(val2), 1.0) * 10;
        }
        if (val1 > val2 && Math.abs(val1 - val2) > epsilon) {
          validationIssues.push(
            `${categoryName} ordering violation: ${val1.toExponential(6)} > ${val2.toExponential(6)} ` +
            `at positions ${pos1}-${pos2}`);
        }
      }
    };

    checkOrdering(numericPositions, 'Numeric');
    checkOrdering(stringNumericPositions, 'String-numeric');
    checkOrdering(complexPositions, 'Complex magnitude');

    const nanPositions = [];
    const infPositions = [];
    const nonePositions = [];
    for (let i = 0; i < arr.length; i++) {
      if (this._isNanValue(arr[i])) nanPositions.push(i);
      if (this._isInfValue(arr[i])) infPositions.push(i);
      if (arr[i] === null || arr[i] === undefined) nonePositions.push(i);
    }

    if (nanPositions.length) {
      if (this.nanPolicy === 'start' && Math.max(...nanPositions) > nanPositions.length) {
        validationIssues.push('NaN values not properly positioned at start');
      } else if (this.nanPolicy === 'end') {
        let expectedStart = arr.length - nanPositions.length;
        if (nonePositions.length && this.nonePolicy === 'end') expectedStart -= nonePositions.length;
        if (Math.min(...nanPositions) < expectedStart) {
          validationIssues.push('NaN values not properly positioned at end');
        }
      }
    }

    this.sortingStats.validation_issues = validationIssues.length;
    this.sortingStats.validation_details = validationIssues.slice(0, 10);
    this.sortingStats.ordering_precision = {
      numeric_sequences: numericPositions.length,
      string_numeric_sequences: stringNumericPositions.length,
      complex_sequences: complexPositions.length,
      special_value_positions: {
        nan_count: nanPositions.length,
        inf_count: infPositions.length,
        none_count: nonePositions.length,
      },
    };
  }

  _isNanValue(value) {
    try {
      if (value === null || value === undefined) return false;
      if (value instanceof Complex) return Number.isNaN(value.real) || Number.isNaN(value.imag);
      if (value instanceof Decimal) return value.isNan();
      return Number.isNaN(pyFloat(value));
    } catch (e) {
      return false;
    }
  }

  _isInfValue(value) {
    try {
      if (value === null || value === undefined) return false;
      if (value instanceof Complex) return isInf(value.real) || isInf(value.imag);
      if (value instanceof Decimal) return value.isInfinite();
      return isInf(pyFloat(value));
    } catch (e) {
      return false;
    }
  }

  getComprehensiveStats() {
    const endTime = performance.now();
    const totalTimeMs = endTime - (this.sortingStats.start_time ?? endTime);
    const totalTimeS = totalTimeMs / 1000;
    return {
      performance: {
        total_time_ms: totalTimeMs,
        elements_per_second: this.sortingStats.total_elements / Math.max(totalTimeS, 1e-9),
        comparisons: this.sortingStats.comparisons,
        bit_analyses: this.sortingStats.bit_analyses,
      },
      elements: {
        total: this.sortingStats.total_elements,
        special_values: this.sortingStats.special_values,
        regular_values: this.sortingStats.regular_values,
        subnormal_count: this.sortingStats.subnormal_count,
        complex_count: this.sortingStats.complex_count,
        decimal_count: this.sortingStats.decimal_count,
      },
      precision: {
        precision_warnings: this.sortingStats.precision_warnings,
        validation_issues: this.sortingStats.validation_issues ?? 0,
        precision_mode: this.precisionMode,
        decimal_precision: this.decimalPrecision,
      },
      classifications: this.sortingStats.classifications,
      policies: {
        nan_policy: this.nanPolicy,
        none_policy: this.nonePolicy,
        zero_distinction: this.zeroDistinction,
        subnormal_handling: this.subnormalHandling,
        complex_handling: this.complexHandling,
        bit_analysis: this.bitAnalysis,
      },
      validation: this.sortingStats.validation_details ?? [],
    };
  }
}

// ---------------------------------------------------------------------------
// Pretty-printing helpers (Python-like repr for arrays)
// ---------------------------------------------------------------------------
function reprValue(value) {
  if (value === null || value === undefined) return 'None';
  if (value instanceof Complex) return value.toString();
  if (value instanceof Decimal) {
    if (value.isNan()) return "Decimal('NaN')";
    if (value.isInfinite()) return value.neg ? "Decimal('-Infinity')" : "Decimal('Infinity')";
    return `Decimal('${value.toString()}')`;
  }
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'nan';
    if (value === Infinity) return 'inf';
    if (value === -Infinity) return '-inf';
    if (isNegZero(value)) return '-0.0';
    return String(value);
  }
  if (typeof value === 'string') return `'${value}'`;
  return String(value);
}

function reprArray(arr) {
  return '[' + arr.map(reprValue).join(', ') + ']';
}

// ---------------------------------------------------------------------------
// Convenience functions
// ---------------------------------------------------------------------------
function ultraPrecisionSort(arr, options = {}) {
  const result = arr.slice();
  const sorter = new PrecisionSpecialValueSorter(options);
  sorter.precisionSort(result);
  return result;
}

function analyzeValuePrecision(value) {
  const sorter = new PrecisionSpecialValueSorter({ precision_mode: 'maximum', bit_analysis: true });
  const classification = sorter._ultraPreciseClassify(value);
  const metrics = {
    classification,
    is_numeric: sorter._isNumeric(value),
    bit_pattern: null,
    is_subnormal: false,
    precision_loss: false,
  };
  if (typeof value === 'number') {
    metrics.bit_pattern = sorter._analyzeFloatBits(value);
    metrics.is_subnormal = sorter._isSubnormal(value);
    try { metrics.precision_loss = Number(String(value)) !== value && !Number.isNaN(value); } catch (e) { /* */ }
  }
  return metrics;
}

// ---------------------------------------------------------------------------
// Demonstrations
// ---------------------------------------------------------------------------
function createSubnormal() { return FLOAT_INFO.min / 2; }

function demonstratePrecisionSorting() {
  console.log('ULTRA-PRECISION SPECIAL VALUE SORTING ALGORITHM');
  console.log('='.repeat(60));

  const createDecimalValues = () => [
    new Decimal('1.2345678901234567890123456789'),
    new Decimal('1.2345678901234567890123456788'),
    new Decimal('nan'),
    new Decimal('inf'),
    new Decimal('-inf'),
  ];

  const testCases = [
    {
      name: 'IEEE 754 Ultra-Precision Test',
      data: [1.0, -0.0, 0.0, Infinity, -Infinity, NaN, createSubnormal(), -1.5, 2.5, FLOAT_INFO.epsilon],
      options: { zero_distinction: true, precision_mode: 'maximum', bit_analysis: true },
    },
    {
      name: 'High-Precision Decimal Test',
      data: [...createDecimalValues(), 1.1, 2.2, null],
      options: { precision_mode: 'maximum', decimal_precision: 100 },
    },
    {
      name: 'Complex Numbers with Special Values',
      data: [cmplx(1, 2), Complex.parse('nan'), Complex.parse('inf'), cmplx(3, 4), Complex.parse('-inf'), cmplx(2, 1)],
      options: { complex_handling: 'magnitude', precision_mode: 'maximum' },
    },
    {
      name: 'Subnormal Number Handling',
      data: [1.0, createSubnormal(), -createSubnormal(), FLOAT_INFO.min, 0.0, 2.0],
      options: { subnormal_handling: 'preserve', precision_mode: 'maximum' },
    },
    {
      name: 'Mixed Ultra-Precision Dataset',
      data: [
        new Decimal('1.23456789012345678901234567890'),
        1.2345678901234567,
        '1.23456789012345678901234567890',
        Complex.parse('1.23456789+2.34567890j'),
        NaN,
        null,
        new Decimal('inf'),
        createSubnormal(),
      ],
      options: { precision_mode: 'maximum', bit_analysis: true, decimal_precision: 50 },
    },
    {
      name: 'Bit-Level Analysis Test',
      data: [1.0000000000000002, 1.0000000000000001, 1.0, NaN, Infinity, -0.0, 0.0],
      options: { bit_analysis: true, precision_mode: 'maximum', zero_distinction: true },
    },
    {
      name: 'String Numeric Precision Test',
      data: ['1.2345678901234567890', '1.2345678901234567891', '1.234567890123456789', 1.2345678901234567, null, NaN],
      options: { precision_mode: 'maximum' },
    },
    {
      name: 'Extreme Value Stress Test',
      data: [
        FLOAT_INFO.max,
        -FLOAT_INFO.max,
        FLOAT_INFO.min,
        -FLOAT_INFO.min,
        FLOAT_INFO.epsilon,
        1 + FLOAT_INFO.epsilon,
        1 - FLOAT_INFO.epsilon / 2,
        NaN,
        Infinity,
        -Infinity,
      ],
      options: { precision_mode: 'maximum', bit_analysis: true },
    },
  ];

  for (const test of testCases) {
    console.log(`\n${test.name}:`);
    console.log('-'.repeat(test.name.length + 1));
    console.log(`Original: ${reprArray(test.data)}`);
    console.log(`Options: ${JSON.stringify(test.options)}`);

    const sorter = new PrecisionSpecialValueSorter(test.options);
    const arrCopy = test.data.slice();
    sorter.precisionSort(arrCopy);

    console.log(`Sorted: ${reprArray(arrCopy)}`);

    const stats = sorter.getComprehensiveStats();

    console.log(`\nPerformance Metrics:`);
    console.log(`  Time: ${stats.performance.total_time_ms.toFixed(6)}ms`);
    console.log(`  Speed: ${stats.performance.elements_per_second.toFixed(0)} elements/sec`);
    console.log(`  Comparisons: ${stats.performance.comparisons}`);
    console.log(`  Bit analyses: ${stats.performance.bit_analyses}`);

    console.log(`\nPrecision Analysis:`);
    console.log(`  Special values: ${stats.elements.special_values}/${stats.elements.total}`);
    console.log(`  Subnormal count: ${stats.elements.subnormal_count}`);
    console.log(`  Complex count: ${stats.elements.complex_count}`);
    console.log(`  Decimal count: ${stats.elements.decimal_count}`);
    console.log(`  Precision warnings: ${stats.precision.precision_warnings}`);
    console.log(`  Validation issues: ${stats.precision.validation_issues}`);

    console.log(`\nClassifications:`);
    for (const [classification, count] of Object.entries(stats.classifications)) {
      console.log(`  ${classification}: ${count}`);
    }

    if (stats.validation.length) {
      console.log(`\nValidation Issues:`);
      for (const issue of stats.validation) console.log(`  ⚠️  ${issue}`);
    } else {
      console.log(`\n✅ Perfect precision ordering achieved`);
    }

    console.log('='.repeat(50));
  }
}

function uniform(a, b) { return a + Math.random() * (b - a); }
function choice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function precisionPerformanceAnalysis() {
  console.log('\n' + '='.repeat(60));
  console.log('PRECISION PERFORMANCE ANALYSIS');
  console.log('='.repeat(60));

  const precisionModes = ['fast', 'standard', 'maximum'];
  const testSizes = [100, 500, 1000];
  const specialRatios = [0.1, 0.5, 0.9];

  for (const mode of precisionModes) {
    console.log(`\nPrecision Mode: ${mode}`);
    console.log('-'.repeat(30));

    for (const size of testSizes) {
      for (const ratio of specialRatios) {
        const specialCount = Math.floor(size * ratio);
        const regularCount = size - specialCount;
        const testData = [];

        for (let i = 0; i < Math.floor(regularCount / 2); i++) testData.push(uniform(-1000, 1000));
        for (let i = 0; i < Math.floor(regularCount / 4); i++) testData.push(new Decimal(numToDecimalString(uniform(-100, 100))));
        for (let i = 0; i < Math.floor(regularCount / 4); i++) testData.push(uniform(-10, 10).toFixed(20));

        const specialTypes = [
          NaN, Infinity, -Infinity, null,
          createSubnormal(), -createSubnormal(),
          Complex.parse('nan'), Complex.parse('inf'),
          new Decimal('nan'), new Decimal('inf'),
        ];
        for (let i = 0; i < specialCount; i++) testData.push(choice(specialTypes));

        shuffle(testData);

        const sorter = new PrecisionSpecialValueSorter({
          precision_mode: mode,
          bit_analysis: mode === 'maximum',
          decimal_precision: mode === 'maximum' ? 50 : 28,
        });

        const dataCopy = testData.slice();
        sorter.precisionSort(dataCopy);
        const stats = sorter.getComprehensiveStats();

        console.log(`  ${String(size).padStart(4)} elements, ${String(Math.round(ratio * 100)).padStart(2)}% special:`);
        console.log(`    Time: ${stats.performance.total_time_ms.toFixed(3).padStart(8)}ms`);
        console.log(`    Speed: ${stats.performance.elements_per_second.toFixed(0).padStart(8)} elem/sec`);
        console.log(`    Precision warnings: ${String(stats.precision.precision_warnings).padStart(3)}`);
        console.log(`    Validation issues: ${String(stats.precision.validation_issues).padStart(3)}`);
      }
    }
  }
}

function advancedPrecisionFeatures() {
  console.log('\n' + '='.repeat(60));
  console.log('ADVANCED PRECISION FEATURES');
  console.log('='.repeat(60));

  // 1. Bit-level NaN analysis
  console.log('\n1. Bit-Level Float Analysis:');
  const nanValues = [NaN, NaN, NaN];
  const sorter = new PrecisionSpecialValueSorter({ bit_analysis: true, precision_mode: 'maximum' });
  nanValues.forEach((val, i) => {
    const classification = sorter._ultraPreciseClassify(val);
    const bitPattern = sorter._analyzeFloatBits(val);
    console.log(`   NaN #${i + 1}: ${classification}`);
    console.log(`   Bit pattern: ${bitPattern}`);
    console.log(`   Is signaling: ${bitPattern ? sorter._isSignalingNan(bitPattern) : 'Unknown'}`);
  });

  // 2. Subnormal detection
  console.log('\n2. Subnormal Number Detection:');
  const testValues = [FLOAT_INFO.min, createSubnormal(), FLOAT_INFO.min / 1e10, 0.0, 1e-320];
  for (const val of testValues) {
    const isSub = sorter._isSubnormal(val);
    console.log(`   Value: ${val.toExponential(6)} -> ${isSub ? 'Subnormal' : 'Normal/Zero'}`);
  }

  // 3. High-precision decimal arithmetic
  console.log('\n3. High-Precision Decimal Arithmetic:');
  DecimalContext.prec = 100;
  const highPrecisionValues = [
    new Decimal('1').divide(new Decimal('3'), 100),
    new Decimal('1').divide(new Decimal('7'), 100),
    new Decimal('2').sqrt(100),
    new Decimal('22').divide(new Decimal('7'), 100),
  ];
  const sorterHp = new PrecisionSpecialValueSorter({ precision_mode: 'maximum', decimal_precision: 100 });
  sorterHp.precisionSort(highPrecisionValues);
  console.log('   Sorted high-precision decimals:');
  for (const val of highPrecisionValues) console.log(`   ${val.toString()}`);

  // 4. Mixed precision comparison
  console.log('\n4. Mixed Precision Comparison Test:');
  const mixedPrecisionTest = [
    1.1,
    new Decimal('1.1'),
    '1.1',
    new Decimal('11').divide(new Decimal('10'), 100),
  ];
  console.log(`   Before sorting: ${reprArray(mixedPrecisionTest)}`);
  const sorterMixed = new PrecisionSpecialValueSorter({ precision_mode: 'maximum' });
  sorterMixed.precisionSort(mixedPrecisionTest);
  console.log(`   After sorting:  ${reprArray(mixedPrecisionTest)}`);
  const stats = sorterMixed.getComprehensiveStats();
  console.log(`   Precision warnings: ${stats.precision.precision_warnings}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  demonstratePrecisionSorting();
  precisionPerformanceAnalysis();
  advancedPrecisionFeatures();

  console.log('\n' + '='.repeat(60));
  console.log('ULTRA-PRECISION SPECIAL VALUE SORTING FEATURES:');
  console.log('✅ IEEE 754 ultra-compliance with bit-level analysis');
  console.log('✅ Signaling vs. Quiet NaN detection');
  console.log('✅ Subnormal (denormalized) number handling');
  console.log('✅ High-precision decimal arithmetic (configurable precision)');
  console.log('✅ Complex number sorting with multiple strategies');
  console.log('✅ Mixed-type ultra-precise comparison');
  console.log('✅ Comprehensive precision loss detection');
  console.log('✅ Configurable precision modes (fast/standard/maximum)');
  console.log('✅ Advanced zero sign distinction (-0.0 vs +0.0)');
  console.log('✅ Bit-pattern analysis for floating-point values');
  console.log('✅ String-to-numeric precision validation');
  console.log('✅ Ultra-comprehensive statistics and validation');
  console.log('✅ Stable sorting within special value groups');
  console.log('✅ Performance optimized for high special value density');
  console.log('='.repeat(60));
}

module.exports = {
  Complex,
  cmplx,
  Decimal,
  DecimalContext,
  SpecialValueType,
  ValueMetrics,
  PrecisionSpecialValueSorter,
  ultraPrecisionSort,
  analyzeValuePrecision,
  FLOAT_INFO,
  reprValue,
  reprArray,
};

if (require.main === module) {
  main();
}
