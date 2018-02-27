'use strict';

const EventEmitter = require('events').EventEmitter;
const inherits     = require('util').inherits;
const debug        = require('debug')('shiba:store:chat');
const debugv       = require('debug')('verbose:store:chat');
const _            = require('lodash');
const Config       = require('../Config');
const Pg           = require('../Pg');

function ChatStore(store) {
  debug('Initializing chat store');
  EventEmitter.call(this);

  // This array holds all the chat messages sorted from
  // old to new.
  this.store = store || [];
}

inherits(ChatStore, EventEmitter);

ChatStore.prototype.mergeMessages = async function(history) {
  // first, add all messages to the db and the store
  for (const channel of Object.keys(history)) {
    for (const message of history[channel]) {
      if (message.kind === "said") {
        await Pg.putMsg(message)
        this.store.push(Object.assign({ channel }, message))
      }
    }
  }
  // sort the messages in the store by ID, which is guaranteed to be strictly increasing
  this.store.sort((a, b) => a.id - b.id)
  // remove all but Config.CHAT_HISTORY messages
  while (this.store.length > Config.CHAT_HISTORY) {
    this.store.shift()
  }
}


ChatStore.prototype.addSaid = async function(msg) {
  debug('Adding message: ' + JSON.stringify(msg));

  try {
    await Pg.putMsg(msg);
  } catch(err) {
    console.error('Failed to log msg:', msg, '\nError:', err);
  }

  if (this.store.length > Config.CHAT_HISTORY)
    this.store.shift();

  this.store.push(msg);
  this.emit('msg', msg);
};

ChatStore.prototype.getChatMessages = function(username, after) {
  let messages = [];
  for (let msg of this.store) {
    let then = new Date(msg.date);

      debug('getChatMessages', msg.date, msg.uname, msg.type, username, after, then);

    if (after <= then &&
        msg.type === 'say' &&
        msg.uname === username)
      messages.push(msg);
  }
  return messages;
};

ChatStore.prototype.get = function() {
  return this.store;
};

async function make() {
  debug('Create chat store');
  const msgs = await Pg.getLastMessages()
  debug('Got %d old messages', msgs.length);
  _.forEach(msgs, msg => {
    debugv('Old message: %s', JSON.stringify(msg));
  });
  return new ChatStore(msgs);
}

module.exports = exports = make;
