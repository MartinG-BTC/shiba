'use strict';

const debug = require('debug')('shiba:cmd:sql');
const Pg    = require('../Pg');

function Sql() {
}

// TODO: Move somewhere else
function eligible(username, role) {
  if (role === 'ADMIN')
    return true;

  const whitelist = [
    "kungfuant",
    "Ryan",
    "MartinG",
    "Daniel"
  ]
  return whitelist.includes(username)
}

Sql.prototype.handle = async function(client, msg, input) {
  if (!eligible(msg.uname, msg.userKind))
    return;

  debug('Running query: %s', input);

  try {
    const result = await Pg.query(input, []);
    if (result.rows.length > 0)
      client.doSay(JSON.stringify(result.rows[0]), msg.channel);
    else
      client.doSay('0 rows', msg.channel);
  } catch(e) {
    console.log(e.stack || e);
    client.doSay(e.toString(), msg.channel);
  }
};

module.exports = exports = Sql;
