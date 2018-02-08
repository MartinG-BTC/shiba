'use strict';

const debug = require('debug')('shiba:store:automute');
const Pg    = require('../Pg');

function Automute(store) {
  debug('Initializing automute store:');
  for (let mute of store)
    debug(String(mute));

  this.store = store;
}

Automute.prototype.add = async function(username, regexp) {
  debug('Adding automute: ' + regexp);
  console.assert(regexp instanceof RegExp);

  await Pg.addAutomute(username, regexp);
  this.store.push(regexp);
};

Automute.prototype.get = function() {
  return this.store;
};

async function make() {
  debug('Create automute store');
  return new Automute(await Pg.getAutomutes())
}

module.exports = exports = make;
