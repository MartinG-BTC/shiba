'use strict';

const debug        = require('debug')('shiba:cmd:profit');
const ProfitParser = require('./ProfitParser').parser;
const Pg           = require('../Pg');

function Profit() {
}

Profit.prototype.handle = async function(client, msg, rawInput) {
  debug('Handling profit: %s', JSON.stringify(rawInput));

  let input;
  try {
    input = ProfitParser.parse(rawInput.replace(/^\s+|\s+$/g, ''));
  } catch(err) {
    client.doSay('wow. very usage failure. such retry', msg.channel);
    throw err;
  }

  try {
    let username = input.user ? input.user : msg.uname;
    // TODO: Move this constant.
    let isOwner  = username.toLowerCase() === 'daniel';
    let result;
    if (isOwner && input.time)
      result = await Pg.getSiteProfitTime(input.time);
    else if (isOwner)
      result = await Pg.getSiteProfitGames(input.games);
    else if (input.time)
      result = await Pg.getProfitTime(username, input.time);
    else
      result = await Pg.getProfitGames(username, input.games);

    let response = (result / 100).toFixed(2) + ' bits';
    client.doSay(response, msg.channel);
  } catch(err) {
    client.doSay('wow. such database fail', msg.channel);
    console.error('ERROR:', err && err.stack || err);
    throw err;
  }
};

module.exports = exports = Profit;
