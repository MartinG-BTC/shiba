'use strict';

const debug = require('debug')('shiba:cmd:urban');
const request = require('request-promise');
const wrap = require('word-wrap');
const _ = require('lodash');

const API       = 'http://api.urbandictionary.com/v0/';
const WRAP_OPT  = {width: 495, trim: true, indent:''};

function Urban() {
}

async function define(term) {
  debug('Fetching definition');

  // Compose the final URL.
  let url = API + 'define?term=' + encodeURIComponent(term)
  debug('ud url: %s', url);

  // Fetch the data
  let req = await request(url);
  let res = JSON.parse(req);

  return res;
}

function layout(text) {
  return _.split(wrap(text.replace(/\s+/g, " "), WRAP_OPT), '\n');
}

Urban.prototype.handle = async function(client, msg, input) {

  let result;
  try {
    result = await define(input);
    if (!result || !result.result_type) {
      client.doSay('wow. such dictionary fail. very concerning', msg.channel);
      return;
    }
  } catch(e) {
    console.log(e.stack || e);
    client.doSay(e.toString(), msg.channel);
  }

  switch(result.result_type) {
  case 'exact': {
    let entry = result.list[0];

    // Keep track how much we said.
    let numChars = 0;

    // Output definition
    let defLines = layout("Definition: " + entry.definition.trim());

    for (let line of defLines) {
      if (numChars + line.length <= 800) {
        client.doSay(line, msg.channel);
        numChars += line.length;
      } else {
        const url =
          'http://urbandictionary.com/define.php?term=' +
          encodeURIComponent(input);
        client.doSay(line + ' ...', msg.channel);
        client.doSay('Full definition: ' + url, msg.channel);
        return;
      }
    }

    // See if example exists
    if (!entry.example || entry.example === "") return;

    // Output example
    let exampleLines = layout("Example: " + entry.example.trim());
    let exampleLength = exampleLines.join('').length;

    // Only say it if it's not too long.
    if (numChars + exampleLength <= 800) {
      for (let line of exampleLines)
        client.doSay(line, msg.channel);
    }

    break;
  }
  case 'no_results':
    client.doSay('such lolcat. speak doge ffs!', msg.channel);
    break;
  default:
    console.log('UD returned', result);
    break;
  }
};

module.exports = exports = Urban;
