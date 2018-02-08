'use strict';

const debug   = require('debug')('shiba:oxr');
const request = require('request-promise');

const API     = 'http://openexchangerates.org/api/';

async function getRates(opts, ep) {
  debug('Fetching openexchangerates');

  let appId = opts.appId;
  if (!appId)
    throw new Error('OpenExchangeRate app id needed');

  // Compose the final URL.
  let url = API + ep + '?app_id=' + appId;
  debug('oxr url: %s', url);

  // Fetch the data
  let req = await request(url);
  let res = JSON.parse(req);

  res.timestamp *= 1000;

  return res;
}

exports.getLatest = function(opts) {
  return getRates(opts, 'latest.json');
};

exports.getHistorical = function(opts, date) {
  return getRates(opts, 'historical/' + date + '.json');
};
