'use strict';

const crypto =  require('crypto');

module.exports = {
  isInvalidUsername:
    /* eslint no-multi-spaces: 0 */
    function(input) {
      if (typeof input !== 'string')      return 'NOT_STRING';
      if (input.length === 0)             return 'NOT_PROVIDED';
      if (input.length < 3)               return 'TOO_SHORT';
      if (input.length > 20)              return 'TOO_LONG';
      if (!/^[a-z0-9_-]*$/i.test(input))  return 'INVALID_CHARS';
      if (input === '__proto__')          return 'INVALID_CHARS';
      return false;
    },
  formatTimeDiff:
    function(diff) {
      diff = Math.floor(diff / 1000);

      let s = diff % 60; diff = Math.floor(diff / 60);
      let m = diff % 60; diff = Math.floor(diff / 60);
      let h = diff % 24; diff = Math.floor(diff / 24);
      let d = diff;

      // Show a maximum of 2 elements, e.g. days and hours or minutes and
      // seconds.
      let words = [];
      let elems = 0;
      if (d > 0) {
        words.push(d + 'd');
        ++elems;
      }
      if (h > 0) {
        words.push(h + 'h');
        ++elems;
      }
      if (elems >= 2)
        return words.join(' ');

      if (m > 0) {
        words.push(m + 'm');
        ++elems;
      }
      if (elems >= 2)
        return words.join(' ');

      if (s > 0) {
        words.push(s + 's');
        ++elems;
      }
      return words.join(' ');
    },
  formatFactorShort:
    function(factor) {
      if (factor === 0) return '0';

      let f = factor / 100

      // Calculate the exponent that would be used in scientific
      // notation. We apply some selective rounding to overcome
      // numerical errors in calculating the base 10 log.
      let e = Math.log(f) / Math.LN10;
      e = Math.round(1e8 * e) / 1e8;
      e = Math.floor(e);

      // The modifier that we want to use, e.g. k or m.
      let mod;

      if (e < 4) {
        mod = '';
      } else if (e < 6) {
        mod = 'k';
        f /= 1e3;
        e -= 3;
      } else {
        mod = 'M';
        f /= 1e6;
        e -= 6;
      }

      // The number of decimal places right to the decimal point in
      // scientific notation that we wish to keep.
      let places;
      switch (e) {
      case 0: places = 4; break;
      case 1: places = 3; break;
      case 2: places = 4; break;
      case 3: places = 5; break;
      default: places = 0; break;
      }

      e = Math.min(e, places);
      f = Math.round(f / Math.pow(10, e - places));
      /* Make sure that the exponent is positive during rescaling. */
      f = e - places >= 0 ?
            f * Math.pow(10, e - places) :
            f / Math.pow(10, places - e);
      f = f.toFixed(Math.max(0, places - e));
      /* Remove unnecessary zeroes. */
      f = f.replace(/(\.[0-9]*[1-9])0*$|\.0*$/, '$1');

      return f + mod;
    },
  duration:
    function(cp) {
      return Math.ceil(this.inverseGrowth(cp + 1));
    },
  growthFunc:
    function(ms) {
      let r = 0.00006;
      return Math.floor(100 * Math.pow(Math.E, r * ms));
    },
  inverseGrowth:
    function(result) {
      let c = 16666.66666667;
      return c * Math.log(0.01 * result);
    },
  crashPoint:
    function(seed, clientSeed) {
      console.assert(typeof seed === 'string');
      seed = Buffer.from(seed, "hex")

      const nBits = 52 // number of most significant bits to use

      // 1. HMAC_SHA256(key=salt, message=seed)
      const hmac = crypto.createHmac("sha256", clientSeed)
      hmac.update(seed)
      seed = hmac.digest("hex")

      // 2. r = 52 most significant bits
      seed = seed.slice(0, nBits/4)
      const r = parseInt(seed, 16)

      // 3. X = r / 2^52
      let X = r / Math.pow(2, nBits) // uniformly distributed in [0; 1)

      // 4. X = 99 / (1-X)
      X = 99 / (1 - X)

      // 5. return max(trunc(X), 100)
      const result = Math.floor(X)
      return Math.max(1, result / 100)
    },
  winProb:
    function(factor) {
      return 99 / factor
    },
};
