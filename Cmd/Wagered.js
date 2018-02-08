'use strict';

const debug         = require('debug')('shiba:cmd:wagered');
const WageredParser = require('./WageredParser').parser;
const Pg            = require('../Pg');

function Wagered() {
}

Wagered.prototype.handle = async function(client, msg, rawInput) {
  debug('Handling wagered: %s', JSON.stringify(rawInput));

  let input;
  try {
    input = WageredParser.parse(rawInput.replace(/^\s+|\s+$/g, ''));
  } catch(err) {
    client.doSay('wow. very usage failure. such retry', msg.channel);
    throw err;
  }

  let result = input.time ?
    await Pg.getWageredTime(input.time) :
    await Pg.getWageredGames(input.games);
  let response = (result / 100).toFixed(2) + ' bits';

  client.doSay(response, msg.channel);
};

module.exports = exports = Wagered;
