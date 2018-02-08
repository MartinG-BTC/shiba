'use strict';

const debug       = require('debug')('shiba:cmd:block');
const debugnotify = require('debug')('shiba:blocknotify');
const Pg          = require('../Pg');
const Blockchain  = require('../Util/Blockchain');
const Lib         = require('../Lib');

function CmdBlock(block, blockNotify) {
  this.block       = block;
  // Map 'channel': ['user1', 'user2', ...]
  this.blockNotify = blockNotify;
  this.client      = null;

  this.blockchain  = new Blockchain();
  this.blockchain.on('block', this.onBlock.bind(this));
}

CmdBlock.prototype.setClient = function(client) {
  this.client = client;
};

CmdBlock.prototype.onBlock = async function(block) {
  let newBlock = {
    height: block.height,
    hash: block.hash,
    confirmation: new Date(block.time * 1000),
    notification: new Date()
  };

  try {
    await Pg.putBlock(newBlock);

    // Check if block is indeed new and only signal in this case.
    if (newBlock.height > this.block.height) {
      this.block = newBlock;

      if (this.client && this.blockNotify.size > 0) {
        for (let channel of this.blockNotify.keys()) {
          let userList = this.blockNotify.get(channel);
          let users = userList.map(s => '@' + s).join(', ') + ': ';
          let line = users + 'Block #' + newBlock.height + ' mined.';
          this.client.doSay(line, channel);
        }

        this.blockNotify.clear();
        await Pg.clearBlockNotifications();
      }
    }
  } catch (err) {
    console.error('[ERROR] onBlock:', err)
  }
};

/* eslint no-unused-vars: 0 */
CmdBlock.prototype.handle = async function(client, msg, input) {
  debug('Handling cmd block for user: %s', msg.uname);

  let time  = this.block.notification;
  let diff  = Date.now() - time;

  let line = 'Seen block #' + this.block.height;
  if (diff < 1000) {
    line += ' just now.';
  } else {
    line += ' ';
    line += Lib.formatTimeDiff(diff);
    line += ' ago.';
  }

  let channel = this.blockNotify.get(msg.channel);
  if (!channel) {
    debugnotify(
      "Creating notification for channel '%s' with user '%s'",
      msg.channel, msg.uname
    );
    this.blockNotify.set(msg.channel, [msg.uname]);
    await Pg.putBlockNotification(msg.uname, msg.channel);
  } else if (channel.indexOf(msg.uname) < 0) {
    debugnotify(
      "Adding user '%s' to the channel '%s'",
      msg.uname, msg.channel
    );
    channel.push(msg.uname);
    await Pg.putBlockNotification(msg.uname, msg.channel);
  } else {
    debugnotify(
      "Already notifying user '%s' on channel '%s'",
      msg.uname, msg.channel
    );
    line += ' ' + msg.uname + ': Have patience!';
  }

  this.client.doSay(line, msg.channel);
};

async function mkCmdBlock() {
  // Last received block information.
  let block = await Pg.getLatestBlock()

  // Awkward name for an array that holds names of users which
  // will be notified when a new block has been mined.
  let blockNotifyUsers = await Pg.getBlockNotifications()

  return new CmdBlock(block, blockNotifyUsers);
}

module.exports = exports = mkCmdBlock;
