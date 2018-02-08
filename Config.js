
let packageJson = require('./package.json');

/* eslint no-process-env: 0 */
module.exports =
{
  ENV:            process.env.NODE_ENV || 'development',
  VERSION:        packageJson.version,
  CLIENT_SEED:
    process.env.BUSTABIT_CLIENTSEED ||
    '0000000000000000004d6ec16dafe9d8370958664c1dc422f452892264c59526',
  API_SERVER:     process.env.BUSTABIT_API_SERVER || "wss://bb.apservices.bz/ws",
  API_KEY:        process.env.BUSTABIT_API_KEY,
  OXR_APP_ID:     process.env.OXR_APP_ID,
  SESSION:        process.env.SHIBA_SESSION,
  DATABASE:       process.env.SHIBA_DATABASE || 'postgres://localhost/shibadb',
  CHAT_HISTORY:   process.env.SHIBA_CHAT_HISTORY || 2000,
  GAME_HISTORY:   process.env.SHIBA_GAME_HISTORY || 200,
  /* keep in lowercase */
  USER_WHITELIST: [
    "daniel",
    "kungfuant",
    "ryan",
    "steve",
  ]
};
