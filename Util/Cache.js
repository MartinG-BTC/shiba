'use strict';

const AsyncCache = require('async-cache');
const { callbackify, promisify } = require("util")


function Cache(opts) {
  const self = this;
  self.opts = opts;

  // Create an opts object for async-cache with a callback-based load function.
  let acopts = Object.assign({}, opts, {
    load: (key, cb) => callbackify(opts.load)(key, cb)
  });

  self.cache = new AsyncCache(acopts);
}

Cache.prototype.get = function(key) {
  return promisify(this.cache.get.bind(this.cache))(key)
}

module.exports = Cache;
