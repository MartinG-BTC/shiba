'use strict';

const debug       = require('debug')('shiba:cmd:bust');
const BustParser = require('./BustParser').parser;
const Lib         = require('../Lib');
const Pg          = require('../Pg');

function Bust() {
}

Bust.prototype.handle = async function(client, msg, input) {
  let qry;
  try {
    qry = BustParser.parse(input);
  } catch(err) {
    client.doSay('wow. very usage failure. such retry', msg.channel);
    return;
  }

  debug('Bust parse result: ' + JSON.stringify(qry));

  let res;
  try {
    res = await Pg.getBust(qry);
  } catch(err) {
    console.error('[ERROR] onCmdBust', err.stack);
    client.doSay('wow. such database fail', msg.channel);
    return;
  }

  // Assume that we have never seen this crashpoint.
  if (res.length === 0) {
    client.doSay(
      'wow. such absence. never seen' + (qry.text || input),
      msg.channel
    );
    return;
  }

  res = res[0];
  let time = new Date(res.created);
  let diff = Date.now() - time;
  const { id } = client.game
  let line =
    'Seen ' + Lib.formatFactorShort(res.game_crash) +
    ' in #' + res.id +
    '. ' + (id - res.id) +
    ' games ago (' + Lib.formatTimeDiff(diff) +
    ')';
  client.doSay(line, msg.channel);
};

module.exports = exports = Bust;
