'use strict';

const debug         = require('debug')('shiba:cmd:convert');
const ConvertParser = require('./ConvertParser').parser;
const ExchangeRate  = require('../Util/ExchangeRate');

function Convert() {
}

Convert.prototype.handle = async function(client, msg, input) {
  debug('Handling conversion "%s"', input);
  let conv;
  try {
    conv = input.replace(/^\s+|\s+$/g, '');
    conv = ConvertParser.parse(conv);
  } catch(err) {
    client.doSay('wow. very usage failure. such retry', msg.channel);
    throw err;
  }

  debug('Convert parse result: %s', JSON.stringify(conv));

  let result;
  try {
    result = await ExchangeRate.convert(
      conv.fromiso, conv.toiso, conv.amount);
    result *= modFactor(conv.frommod);
    result /= modFactor(conv.tomod);
  } catch(err) {
    client.doSay('wow. such exchange rate fail', msg.channel);
    throw err;
  }

  /* Pretty print source. We reuse the original amount string for
     grouping.
  */
  const prettySource = pretty(conv.fromiso, conv.str, conv.frommod);

  /* Pretty print the converted amount. */
  /* We strip off some places because they only clutter the output:
        93473434.4234345  ->  93473434
        0.000243456487    ->  0.00024346
   */

  if (result !== 0) {
    /* Scale using the exponent, but not more than 5 integral places. */
    let e  = Math.min(Math.floor(Math.log(Math.abs(result)) / Math.LN10), 5);
    result = Math.round(result / Math.pow(10, e - 5));
    /* Make sure that the exponent is positive during rescaling. */
    result = e - 5 >= 0 ?
               result * Math.pow(10, e - 5) :
               result / Math.pow(10, 5 - e);
    let prec = Math.max(0, 5 - e);

    result = prec > 15 ?
      // Really small number and lots of places to show. Instead of printing
      // them all we rather accept scientific notation. We are already more
      // liberal than the generic toString() conversion.
      String(result) :
      result.toFixed(prec);

    /* Remove unnecessary zeroes. */
    result = result.replace(/(\.[0-9]*[1-9])0*$|\.0*$/, '$1');
  }
  const prettyResult = pretty(conv.toiso, result, conv.tomod);

  /* Send everything to the chat. */
  client.doSay(prettySource + ' is ' + prettyResult, msg.channel);
};

/* Pretty print an amount. We try to make it as pretty as
   possible by replacing ISO codes with currency symbols.
*/
function pretty(iso, num, mod) { /* eslint complexity: 0 */
  /* In case somebody specifically asked for milli we
     only print the ISO code variant.
  */
  if (mod === 'm')
    return num + ' m' + iso;

  let mod1 = modFactor(mod) === 1;
  switch (iso) {
  case 'EUR': return '€' + num + mod;
  case 'GBP': return '£' + num + mod;
  case 'IDR': return 'Rp ' + num + mod;
  case 'INR': return '₹' + num + mod;
  case 'KRW': return '₩' + num + mod;
  case 'USD': return '$' + num + mod;
  case 'PHP': return '₱' + num + mod;
  case 'BIT': return num === 1 && mod1 ? '1 Bit' : num + mod + ' Bits';
  case 'SAT': return num + mod + ' satoshi';
  case 'KOINU': return num + mod + ' 子犬';
  /* Use suffix symbols for these if no modifier is
   * provided. Otherwise use the ISO code. */
  case 'PLN': return mod1 ? num + 'zł' : num + mod + ' PLN';
  case 'VND': return mod1 ? num + '₫' : num + mod + ' VND';
  case 'XAG': return mod1 ? num + ' oz. tr. of silver' : num + mod + ' XAG';
  case 'XAU': return mod1 ? num + ' oz. tr. of gold' : num + mod + ' XAU';
  default:
    return num + mod + ' ' + iso;
  }
}

function modFactor(mod) {
  switch (mod) {
  case 'm':
    return 1e-3;
  case 'k':
  case 'K':
    return 1e3;
  case 'M':
    return 1e6;
  default:
    return 1;
  }
}

module.exports = exports = Convert;
