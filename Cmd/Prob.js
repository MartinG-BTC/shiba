'use strict';

const debug      = require('debug')('shiba:cmd:prob');
const BustParser = require('./BustParser').parser;
const Lib        = require('../Lib');

function Prob() {
}

Prob.prototype.handle = function*(client, msg, input) {

  let qry;
  try {
    qry = BustParser.parse(input);
  } catch(err) {
    client.doSay('wow. very usage failure. such retry');
    return;
  }

  debug('Prob parse result: ' + JSON.stringify(qry));

  let res = 1;
  if (qry.hasOwnProperty('min') && qry.min > 0)
    res = Lib.winProb(qry.min);
  if (qry.hasOwnProperty('max'))
    res -= Lib.winProb(qry.max ? qry.max+1 : 100);
  res *= 100;

  let line =
    'Probability of ' + (qry.text || input) +
    ': ' + res.toFixed(6) + '%';
  client.doSay(line);
};

module.exports = exports = Prob;