'use strict';

const EventEmitter = require('events').EventEmitter;
const inherits     = require('util').inherits;
const debug        = require('debug')('shiba:store:game');
const debugv       = require('debug')('verbose:store:game');
const Config       = require('../Config');
const Pg           = require('../Pg');

function GameStore(store) {
  debug('Initializing game store');
  debugv('Initial store: %s', JSON.stringify(store, null, ' '));

  EventEmitter.call(this);

  // This array holds all the game infos sorted from old to new.
  this.store = store || [];
}

inherits(GameStore, EventEmitter);

GameStore.prototype.addGame = async function(game) {
  debug('Adding game: ' + JSON.stringify(game));

  // Try up to 5 times to log the game
  for (let i = 1; i <= 5; ++i) {
    try {
      await Pg.putGame(game);
      break;
    } catch(err) {
      console.error(`Failed to log game: ${game.game_id} try: ${i}`);
      console.error(`Error: ${err && err.stack || err}`);
    }
  }

  if (this.store.length > Config.GAME_HISTORY)
    this.store.shift();

  this.store.push(game);
  this.emit('game', game);
};

GameStore.prototype.importGame = async function(client, id) {
  debug('Importing game: %d', id);
  let info;
  try {
    info = await client.getGameInfo(Number(id))
  } catch(err) {
    console.error('Downloading game #' + id, 'failed');
    throw err;
  }

  // Try up to 5 times to import the game
  for (let i = 1; i <= 5; ++i) {
    try {
      await Pg.putGame(info);
      break;
    } catch(err) {
      if (i == 5) {
        console.error('Importing game #' + info.game_id, 'failed');
        throw err;
      }
    }
  }
};

GameStore.prototype.fillMissing = async function(client) {
  const { game } = client
  debug('Checking for missing games before: %d', game.id);

  let maxGameId = game.state === 'GAME_ENDED' ? game.id : game.id - 1;

  // Get ids of missing games. TODO: move this constants
  let ids = await Pg.getMissingGames(1, maxGameId);

  // Import them from the web.
  for (let id of ids) {
    debug('Importing missing id: %d', id);
    try {
      await this.importGame(client, id);
    } catch(err) {
      // Message error but continue. Could be an unterminated game.
      console.error('Error while importing game %d:', id, err.stack || err);
    }
    // eslint-disable-next-line promise/avoid-new
    await new Promise(resolve => setTimeout(resolve, 1500))
  }

  // Finally replace the store with the current games. TODO: Yes, there is a
  // race condition here, but this store isn't really used anyway...
  this.store = await Pg.getLastGames();
};

async function make() {
  debug('Create game store');
  const games = await Pg.getLastGames()
  return new GameStore(games);
}

module.exports = exports = make;
