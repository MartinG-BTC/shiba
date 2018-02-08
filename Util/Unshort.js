'use strict';

const request  = require('request-promise');
const debug    = require('debug')('shiba:unshort');
const Cache    = require('./Cache');

const headers = {
  'Accept':          'text/html,application/xhtml+xml',
  'Accept-Encoding': 'gzip, deflate',
  'Accept-Language': 'en-US,en',
  'Cache-Control':   'no-cache',
  'Pragma':          'no-cache',
  'User-Agent':      'Mozilla/5.0'
};

const unshortCache = new Cache({
  // Cache a maximum of 100 elements
  max: 100,
  // for maximally 10 hours.
  maxAge: 1000 * 60 * 60 * 10,
  load:
    async function(url) {
      debug("Loading '%s'", url);
      let opt = {url: url, headers: headers, resolveWithFullResponse: true };
      let res = await request(opt);

      // Return the URL after following all redirects.
      return res.request.href;
    }
});

async function unshort(url) {
  try {
    let res = await unshortCache.get(url);
    debug('Unshortened "%s" -> "%s"', url, res);
    return res;
  } catch(err) {
    console.error('[ERROR] Unshort: ' + err);
    console.error('Url was:', JSON.stringify(url));
    throw err;
  }
}

function unshorts(urls) {
  return Promise.all(urls.map(unshort))
}

module.exports.unshort  = unshort;
module.exports.unshorts = unshorts;
