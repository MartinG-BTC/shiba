'use strict';

const debug      = require('debug')('shiba:cmd:prob');
const BustParser = require('./BustParser').parser;
const Lib        = require('../Lib');

function Prob() {
}

Prob.prototype.handle = function(client, msg, input) {
  let qry;
  try {
    qry = BustParser.parse(input);
  } catch(err) {
    client.doSay('wow. very usage failure. such retry', msg.channel);
    return;
  }

  debug('Prob parse result: ' + JSON.stringify(qry));

  let res = 1;
  // The winProb function gives us the probability for ≥. We
  // combine the probabilities of the lower and upper bound.
  if (qry.hasOwnProperty('min') && qry.min > 0) {
    // Make sure to handle gap between 0x and 1x is handled correctly.
    var min = Math.max(qry.min, 100);
    res = Lib.winProb(min);
  }

  // Subtract the probability of the upper bound. This has a
  // corner case: The parser allows as input <0.
  if (qry.hasOwnProperty('max')) { /* eslint curly: 0 */
    res = qry.max < 0 ? 0 :
            res -= Lib.winProb(qry.max ? qry.max + 1 : 100);
  }
  res *= 100;

  let line =
    'Probability of ' + (qry.text || input) +
    ': ' + res.toFixed(6) + '%';
  client.doSay(line, msg.channel);
};

module.exports = exports = Prob;
