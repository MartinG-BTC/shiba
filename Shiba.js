'use strict';

const _             =  require('lodash');
const fs            =  require('fs');
const debug         =  require('debug')('shiba');
const debugautomute =  require('debug')('shiba:automute');

const profanity    =  require('./profanity');
const Unshort      =  require('./Util/Unshort');

const Config         =  require('./Config');
const BustabitClient =  require('./BustabitClient');
const Lib            =  require('./Lib');
const Pg             =  require('./Pg');

const CmdAutomute  =  require('./Cmd/Automute');
const CmdConvert   =  require('./Cmd/Convert');
const CmdBust      =  require('./Cmd/Bust');
const CmdMedian    =  require('./Cmd/Median');
const CmdProb      =  require('./Cmd/Prob');
const CmdProfit    =  require('./Cmd/Profit');
const CmdSql       =  require('./Cmd/Sql');
const CmdStreak    =  require('./Cmd/Streak');
const CmdUrban     =  require('./Cmd/Urban');
const CmdWagered   =  require('./Cmd/Wagered');

const mkCmdBlock     =  require('./Cmd/Block');
const mkAutomuteStore = require('./Store/Automute');
const mkChatStore     = require('./Store/Chat');
const mkGameStore     = require('./Store/Game');

// Make sure directories exist for the filesystem log
function ensureDirSync(dir) {
  try {
    fs.mkdirSync(dir);
  } catch(e) {
    if (e.code !== 'EEXIST') throw e;
  }
}
ensureDirSync('chatlogs');

// Command syntax
const cmdReg = /^\s*!([a-zA-z]*)\s*(.*)$/i;

function Shiba() {
  (async () => {
    // List of automute regexps
    this.automuteStore = await mkAutomuteStore()
    this.chatStore     = await mkChatStore()
    this.gameStore     = await mkGameStore()

    this.cmdAutomute = new CmdAutomute(this.automuteStore)
    this.cmdConvert  = new CmdConvert()
    this.cmdBlock    = await mkCmdBlock()
    this.cmdBust     = new CmdBust()
    this.cmdMedian   = new CmdMedian()
    this.cmdProb     = new CmdProb()
    this.cmdProfit   = new CmdProfit()
    this.cmdSql      = new CmdSql()
    this.cmdStreak   = new CmdStreak()
    this.cmdUrban    = new CmdUrban()
    this.cmdWagered  = new CmdWagered()

    // Connect to the API server.
    this.client = new BustabitClient(Config);

    // add missing games
    this.client.on("connected", () => this.gameStore.fillMissing(this.client))

    // record games as they end
    this.client.on("gameEnded", game => this.gameStore.addGame(game))

    // verify fairness
    this.client.on("gameEnded", () => {
      // TODO: ensure game's hash is part of chain
      const actual = this.client.game.bust
      const want = Lib.crashPoint(this.client.game.serverSeed, Config.CLIENT_SEED)
      const tolerance = want >= 1e6 ? 0.08 : 0
      const fair = Math.abs(want - actual) <= tolerance
      if (!fair) {
        this.client.doSay("wow. such scam. very hash failure.", "english")
      }
    })

    // Setup the chat bindings.
    this.client.on("connected", async () => {
      const history = await this.client.socket.send("joinChannels", require("./chat_channels.json"))
      try {
        await this.chatStore.mergeMessages(history)
      } catch (err) {
        console.error('Error importing history:', err, err.stack);
      }
    })
    this.client.socket.on("said", async data => {
      try {
        await this.chatStore.addSaid(data)
      } catch (err) {
        console.error('[ERROR] on said:', err.stack)
      }
    })
    // handle chat commands
    this.chatStore.on("msg", async message => {
      try {
        await this.onSay(message)
      } catch (err) {
        console.error('[Shiba.onMsg]', err && err.stack || err);
      }
    })

    this.cmdBlock.setClient(this.client);

    this.setupChatlogWriter();
  })().catch(err => {
    // Abort immediately when an exception is thrown on startup.
    console.error(err.stack)
    throw err
  })
}

Shiba.prototype.setupChatlogWriter = function() {
  let chatDate    = null;
  let chatStream  = null;

  this.chatStore.on('msg', msg => {
    // Write to the chatlog file. We create a file for each date.
    let now = new Date(Date.now());

    if (!chatDate || now.getUTCDay() !== chatDate.getUTCDay()) {
      // End the old write stream for the previous date.
      if (chatStream) chatStream.end();

      // Create new write stream for the current date.
      let chatFile =
        'chatlogs/' + now.getUTCFullYear() +
        ('0' + (now.getUTCMonth() + 1)).slice(-2) +
        ('0' + now.getUTCDate()).slice(-2) + '.log';
      chatDate   = now;
      chatStream = fs.createWriteStream(chatFile, {flags: 'a'});
    }
    chatStream.write(JSON.stringify(msg) + '\n');
  });
};

Shiba.prototype.checkAutomute = async function(msg) {
  // Don't bother checking messages from the spam channel.
  if (msg.channel === 'spam') return false;

  // Match entire message against the regular expressions.
  let automutes = this.automuteStore.get();
  if (automutes.find(r => msg.message.match(r)))
    return this.client.doMute(msg.uname, "wow. so disrespect. many mute", msg.channel);

  // Extract a list of URLs.
  // TODO: The regular expression could be made more intelligent.
  let urls  = msg.message.match(/https?:\/\/[^\s]+/ig) || [];
  let urls2 = msg.message.match(/(\s|^)(bit.ly|vk.cc|goo.gl)\/[^\s]+/ig) || [];
  urls2     = urls2.map(x => x.replace(/^\s*/, 'http://'));
  urls      = urls.concat(urls2);

  // No URLs found.
  if (urls.length === 0) return false;

  // Unshorten extracted URLs.
  try {
    urls2 = await Unshort.unshorts(urls);
    urls  = urls.concat(urls2 || []);
  } catch(e) {
    // Unshort failed. Just continue without it.
  }

  debugautomute('Url list: ' + JSON.stringify(urls));

  for (let url of urls) {
    debugautomute('Checking url: ' + url);

    // Run the regular expressions against the unshortened url.
    let automute = automutes.find(r => url.match(r));
    if (automute) {
      debugautomute('URL matched ' + automute);
      return this.client.doMute(msg.uname, "wow. so disrespect. many mute", msg.channel);
    }
  }

  return false;
};

Shiba.prototype.onSay = async function(msg) {
  if (msg.uname === this.client.username) return;

  if (await this.checkAutomute(msg)) return;

  // Everything checked out fine so far. Continue with the command
  // processing phase.
  let cmdMatch = msg.message.match(cmdReg);
  if (cmdMatch) await this.onCmd(msg, cmdMatch[1], _.trim(cmdMatch[2]));
};

Shiba.prototype.checkCmdRate = async function(msg) {
  let after    = new Date(Date.now() - 10 * 1000);
  let messages = this.chatStore.getChatMessages(msg.uname, after);

  let count = 0;
  messages.forEach(m => {
    if (m.message.match(cmdReg)) ++count;
  });

  debug('checkCmdRate', msg, messages.length, count);

  if (count >= 5) {
    return this.client.doMute(msg.uname, "wow. very spam. many mute", msg.channel);
  } else if (count >= 4) {
    this.client.doSay('bites ' + msg.uname, msg.channel);
    return true;
  }

  return false;
};

// Map command names to list of aliases:
let cmdAliases = {
  automute: [],
  block:    ['blck', 'blk', 'bl'],
  bust:     ['bst', 'bt'],
  convert:  ['conver', 'conv', 'cv', 'c'],
  custom:   [],
  fair:     ['scam'],
  help:     ['h','faq'],
  lick:     ['lck', 'lic', 'lik', 'lk'],
  nyan:     ['n', 'ny', 'na', 'nn', 'nya', 'nyn', 'nan'],
  median:   ['med'],
  prob:     ['prb', 'pob', 'pb', 'p'],
  profit:   ['prfit', 'profi', 'prof', 'prft', 'prf', 'prt'],
  seen:     ['sen', 'sn', 's'],
  sql:      [],
  streak:   [],
  urban:    ['ud', 'dict', 'urbandictionary', 'u', 'd', 'define', 'def'],
  wagered:  ['w', 'wager', 'wagerd', 'wagr', 'wagrd', 'wagred', 'wd',
             'wg', 'wgd', 'wger', 'wgerd', 'wgr', 'wgrd', 'wgred', 'wagered'
            ]
};

let mapAlias = {};
_.forEach(cmdAliases, (aliases, cmd) => {
  // Map each command to itself
  mapAlias[cmd] = cmd;

  // Map alises to command.
  _.forEach(aliases, alias => {
    mapAlias[alias] = cmd;
  });
});

// A list of commands not allows in the english channel.
let cmdBlacklist = [
  'bust', 'convert', 'median', 'prob', 'profit', 'streak', 'urban', 'wagered'
];

Shiba.prototype.onCmd = async function(msg, cmd, rest) {
  debug('Handling cmd %s', cmd);

  // Cmd rate limiter
  if (await this.checkCmdRate(msg)) return;

  // Lookup proper command name or be undefined.
  cmd = mapAlias[cmd.toLowerCase()];

  // Check if a blacklisted command is used in the english channel.
  if (msg.channel === 'english' &&
      cmdBlacklist.indexOf(cmd) >= 0 &&
      !Config.USER_WHITELIST.includes(msg.uname.toLowerCase()) &&
      msg.userKind !== 'ADMIN' &&
      msg.userKind !== 'TRUSTED') {
    this.client.doSay(
      '@' + msg.uname +
        ' Please use the SPAM channel for that command.',
      msg.channel
    );
    return;
  }

  switch(cmd) { // TODO
  case 'automute':
    this.cmdAutomute.handle(this.client, msg, rest);
    break;
  case 'block':
    this.cmdBlock.handle(this.client, msg, rest);
    break;
  case 'bust':
    this.cmdBust.handle(this.client, msg, rest);
    break;
  case 'convert':
    this.onCmdConvert(msg, rest);
    break;
  case 'custom':
    this.onCmdCustom(msg, rest);
    break;
  case 'fair':
    this.onCmdFair(msg, rest);
    break;
  case 'help':
    this.onCmdHelp(msg, rest);
    break;
  case 'lick':
    this.onCmdLick(msg, rest);
    break;
  case 'median':
    this.cmdMedian.handle(this.client, msg, rest);
    break;
  case 'nyan':
    this.cmdBust.handle(this.client, msg, '>= 1000');
    break;
  case 'prob':
    this.cmdProb.handle(this.client, msg, rest);
    break;
  case 'profit':
    this.cmdProfit.handle(this.client, msg, rest);
    break;
  case 'seen':
    this.onCmdSeen(msg, rest);
    break;
  case 'sql':
    this.cmdSql.handle(this.client, msg, rest);
    break;
  case 'streak':
    this.cmdStreak.handle(this.client, msg, rest);
    break;
  case 'urban':
    this.cmdUrban.handle(this.client, msg, rest);
    break;
  case 'wagered':
    this.cmdWagered.handle(this.client, msg, rest);
    break;
  }
};

Shiba.prototype.onCmdHelp = function(msg) {
  this.client.doSay(
      'very explanation. much insight: ' +
      'https://www.bustabit.com/faq ' +
      'https://github.com/moneypot/shiba/wiki/Commands', msg.channel);
};

Shiba.prototype.onCmdFair = function(msg) {
  this.client.doSay(
      'so fair. very proof: ' +
      'https://www.bustabit.com/faq/is-the-game-fair', msg.channel);
};

Shiba.prototype.onCmdCustom = async function(msg, rest) {
  if (msg.userKind !== 'ADMIN' &&
      msg.userKind !== 'TRUSTED') return;

  let customReg   = /^([a-z0-9_-]+)\s+(.*)$/i;
  let customMatch = rest.match(customReg);
  let doSay       = text => this.client.doSay(text, msg.channel);

  if (!customMatch) {
    doSay('wow. very usage failure. such retry');
    doSay('so example, very cool: !custom Ryan very dog lover');
    return;
  }

  let customUser  = customMatch[1];
  let customMsg   = customMatch[2];

  try {
    await Pg.putLick(customUser, customMsg, msg.uname);
    doSay('wow. so cool. very obedient');
  } catch(err) {
    console.error('[ERROR] onCmdCustom:', err.stack);
    doSay('wow. such database fail');
  }
};

Shiba.prototype.onCmdLick = async function(msg, user) {
  user = user.toLowerCase();

  // We're cultivated and don't lick ourselves.
  if (user === this.client.username.toLowerCase()) return;

  let doSay = text => this.client.doSay(text, msg.channel);
  if (profanity[user]) {
    this.client.doMute(msg.uname, "so trollol. very annoying. such mute", msg.channel);
    return;
  }

  try {
    // Get licks stored in the DB.
    let data     = await Pg.getLick(user);
    let username = data.username;
    let customs  = data.licks;

    // Add standard lick to the end.
    customs.push('licks ' + username);

    // Randomly pick a lick message with lower probability of the
    // standard one.
    let r = Math.random() * (customs.length - 0.8);
    let m = customs[Math.floor(r)];
    doSay(m);
  } catch(err) {
    switch (err) {
    case 'USER_DOES_NOT_EXIST':
      doSay('very stranger. never seen');
      break;
    case 'USERNAME_INVALID':
      doSay('name invalid. you trolling!?');
      break;
    default:
      console.error('[ERROR] onCmdLick:', err);
      break;
    }
  }
};

Shiba.prototype.onCmdSeen = async function(msg, user) {
  user = user.toLowerCase();

  let doSay = text => this.client.doSay(text, msg.channel);
  // Make sure the username is valid
  if (Lib.isInvalidUsername(user)) {
    doSay('such name. very invalid');
    return;
  }

  // In case a user asks for himself.
  if (user === msg.uname.toLowerCase()) {
    doSay('go find a mirror @' + msg.uname);
    return;
  }

  // Special treatment of block.
  if (user === 'block') {
    this.cmdBlock.handle(this.client, msg, user);
    return;
  }

  // Special treatment of rape.
  if (user === 'rape') {
    this.cmdBust.handle(this.client, msg, '< 1.05');
    return;
  }

  // Special treatment of nyan.
  if (user === 'nyan') {
    this.cmdBust.handle(this.client, msg, '>= 1000');
    return;
  }

  // Somebody asks us when we've seen ourselves.
  if (this.client.username && this.client.username.toLowerCase() === user) {
    doSay('strange loops. much confusion.');
    return;
  }

  if (profanity[user]) {
    this.client.doMute(msg.uname, "so trollol. very annoying. such mute", msg.channel);
    return;
  }

  let message;
  try {
    message = await Pg.getLastSeen(user);
  } catch(err) {
    if (err === 'USER_DOES_NOT_EXIST') {
      doSay('very stranger. never seen');
    } else {
      console.error('[ERROR] onCmdSeen:', err.stack);
      doSay('wow. such database fail');
    }
    return;
  }

  if (!message.time) {
    // User exists but hasn't said a word.
    doSay('very silent. never spoken');
    return;
  }

  let diff = Date.now() - message.time;
  let line;
  if (diff < 1000) {
    line = 'Seen ' + message.username + ' just now.';
  } else {
    line = 'Seen ' + message.username + ' ';
    line += Lib.formatTimeDiff(diff);
    line += ' ago.';
  }
  doSay(line);
};

Shiba.prototype.onCmdConvert = function(msg, conv) {
  this.cmdConvert.handle(this.client, msg, conv);
};

new Shiba()
