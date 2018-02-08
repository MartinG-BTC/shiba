'use strict';

const debug = require('debug')('shiba:cmd:automute');

function Automute(store) {
  this.store = store;
}

Automute.prototype.handle = async function (client, msg, input) {
  if (msg.userKind !== 'ADMIN' &&
      msg.userKind !== 'TRUSTED') return;

  debug('Parsing regex: %s', input);
  let regex;
  try {
    let match = input.match(/^\/(.*)\/([gi]*)$/);
    regex = new RegExp(match[1], match[2]);
  } catch (err) {
    debug('Parse failed');
    client.doSay('regex compile file: ' + err.message, msg.channel);
    return;
  }

  try {
    debug('Adding automute to DB');
    await this.store.add(msg.uname, regex);
  } catch(err) {
    client.doSay('failed adding automute to database.', msg.channel);
    return;
  }

  client.doSay('wow. so cool. very obedient', msg.channel);
};

module.exports = exports = Automute;
