const assert = require("assert")
const pg     = require("pg")

const Config = require('./Config');
const Lib    = require('./Lib');
const Cache  = require('./Util/Cache');

const debug    = require('debug')('shiba:db');
const debugpg  = require('debug')('verbose:db:pg');


// set up pg
pg.types.setTypeParser(20, val => val === null ? null : parseInt(val, 10))


const pool = new pg.Pool({
    connectionString: Config.DATABASE,

    // configuration taken from previous version of file
    max: 3,
    idleTimeoutMillis: 500000,
})

let querySeq = 0
async function query(sql, params) {
    const qid = querySeq++
    debugpg(`[${qid}] Executing query "${sql}"`)
    if (params) debugpg(`[${qid}] Parameters ${JSON.stringify(params)}`)
    else params = []

    const result = await pool.query(sql, params)
    debugpg(`[${qid}] Finished query`)
    return result
}

/**
 * Runs a session and retries if it deadlocks.
 *
 * @param {String} runner A generator expecting a query function.
 * @return {?} Session result.
 * @api private
 */
async function withClient(runner) {
    const client = await pool.connect()
    try {
        const result = await runner(async (sql, params) => {
            const qid = querySeq++
            debugpg(`[${qid}] Executing query "${sql}"`)
            if (params) debugpg(`[${qid}] Parameters ${JSON.stringify(params)}`)
            else params = []

            const result = await client.query(sql, params)
            debugpg(`[${qid}] Finished query`)
            return result
        })
        client.release()
        return result
    } catch (error) {
        if (error.code === "40P01") {
            console.warn("Deadlock detected. Retrying..")
            client.release()
            return withClient(runner)
        }
        console.error(error)
        console.error(error.stack)
        if (error.removeFromPool) {
            console.error("[ERROR] withClient: removing connection from pool")
            client.release(true)
        } else {
            client.release()
        }
        throw error
    }
}

let txSeq = 0
/**
 * Runs a single transaction and retry if it deadlocks. This function
 * takes care of BEGIN and COMMIT. The session runner should never
 * perform these queries itself.
 *
 * @param {String} runner A generator expecting a query function.
 * @return {?} Transaction result.
 * @api private
 */
async function withTransaction(runner) {
    return withClient(async query => {
        const txid = txSeq++
        try {
            debugpg(`[${txid}] Starting transaction`)
            await query("BEGIN")
            const result = await runner(query)
            debugpg(`[${txid}] Committing transaction`)
            await query("COMMIT")
            debugpg(`[${txid}] Finished transaction`)
            return result
        } catch (error) {
            try {
                await query("ROLLBACK")
            } catch (error) {
                error.removeFromPool = true
                throw error
            }
            throw error
        }
    })
}


const userCache = new Cache({
    // Cache users for 1 day.
    maxAge: 1000 * 60 * 60 * 24,
    max: 10000,
    load : getOrCreateUser
});

async function getOrCreateUser(username) {
    debug(`GetOrCreateUser user: ${username}`);

    const user = await withTransaction(async function(query) {
        let res = await query(
            'SELECT username, id FROM users WHERE lower(username) = lower($1)',
            [username]
        );

        if (res.rows.length > 0) {
            // User exists. Return the first (and only) row.
            assert(res.rows.length === 1);
            return res.rows[0];
        }

        // Create new user.
        res = await query(
            'INSERT INTO users(username) VALUES($1) RETURNING username, id',
            [username]
        );

        assert(res.rows.length === 1);
        return res.rows[0];
    });

    debugpg(`GetOrCreateUser "${username}": ${JSON.stringify(user)}`);
    return user;
}

async function getUser(username) {
    if (Lib.isInvalidUsername(username))
        throw 'USERNAME_INVALID';

    try {
        const user = await userCache.get(username)
        assert(user.username.toLowerCase() === username.toLowerCase());
        assert(Number.isInteger(user.id));
        return user;
    } catch(err) {
        console.error('[Pg.getUser] ERROR:', err && err.stack || err);
        throw err;
    }
}

async function getExistingUser(username) {
    debug(`Getting user: ${username}`);

    if (Lib.isInvalidUsername(username))
      throw 'USERNAME_INVALID';

    let res = await query(
      'SELECT * FROM users WHERE lower(username) = lower($1)',
      [username]
    );

    if (res.rows.length <= 0)
      throw 'USER_DOES_NOT_EXIST';

    // User exists. Return the first (and only) row.
    assert(res.rows.length === 1);
    return res.rows[0];
}


const Pg = {
    query,

    // Cmd/Block.js
    clearBlockNotifications() {
        debug('Clearing block notification list');
        return query('DELETE FROM blocknotifications');
    },
    async getBlockNotifications() {
        debug('Getting block notification list');
        const data = await query(
            `SELECT channel_name, array_agg(username) AS users
                FROM blocknotifications GROUP BY channel_name`
        );

        let map = new Map();
        data.rows.forEach(val => map.set(val.channel_name, val.users));
        return map;
    },
    async getLatestBlock() {
        debug('Getting last block from DB');
        const data = await query('SELECT * FROM blocks ORDER BY height DESC LIMIT 1')
        return data.rows[0];
    },
    async putBlock(block) {
        try {
            await query(
              'INSERT INTO blocks(height, hash) VALUES($1, $2)',
              [block.height, block.hash]
            );
          } catch(err) {
            // Ignore unique_violation code 23505.
            if (err.code === 23505 || err.code === '23505')
              debugpg('Block database entry already exists');
            else
              throw err;
          }
    },
    async putBlockNotification(user, channel) {
        debug(`Adding ${user} to block notification list on channel ${channel}`);

        try {
          await query(
            `INSERT INTO blocknotifications(username, channel_name) VALUES($1, $2)`,
            [user, channel]
          );
        } catch(err) {
          // Ignore unique_violation code 23505.
          if (err.code !== 23505 && err.code !== '23505') throw err;
        }
    },

    // Cmd/Bust.js
    async getBust(qry) {
        debug(`Getting last bust: ${JSON.stringify(qry)}`);

        let sql;
        if (qry === 'MAX') {
          sql = `SELECT * FROM games WHERE id =
                  (SELECT id FROM game_crashes
                   ORDER BY game_crash DESC LIMIT 1)`;
        } else {
          let min   = qry.hasOwnProperty('min') ?
                        ' AND game_crash >= ' + qry.min : '';
          let max   = qry.hasOwnProperty('max') ?
                        ' AND game_crash <= ' + qry.max : '';
          sql = `SELECT * FROM games WHERE id =
                  (SELECT id FROM game_crashes
                    WHERE TRUE ${min} ${max}
                    ORDER BY id DESC LIMIT 1)`;
        }

        try {
          let data = await query(sql);
          return data.rows;
        } catch(err) {
          console.error(err);
          throw err;
        }
    },

    // Cmd/Median.js
    async getGameCrashMedian(numGames) {
        debug('Retrieving game crash median');

        let data = await query(
          `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY game_crash) AS median,
             COUNT(*)
           FROM (SELECT game_crash FROM games ORDER BY id DESC LIMIT $1) t`,
          [numGames]
        );
        return data.rows[0];
    },

    // Cmd/Profit.js
    async getProfitGames(username, games) {
        let res = await query(
            `SELECT SUM(COALESCE(cash_out,0) - bet) AS profit
            FROM (SELECT * FROM plays WHERE user_id = userIdOf($1)
            ORDER BY game_id DESC LIMIT $2) t`,
        [username, games]
        );
        return res.rows[0].profit;
    },
    async getProfitTime(username, time) {
        let res = await query(
            `SELECT SUM(COALESCE(cash_out,0) - bet) AS profit
            FROM plays WHERE user_id = userIdOf($1) AND game_id >= (
            SELECT id FROM games WHERE created >= $2 ORDER BY id ASC LIMIT 1)`,
        [username, new Date(Date.now() - time)]
        );
        return res.rows[0].profit;
    },
    async getSiteProfitGames(games) {
        let res = await query(
            'SELECT siteprofitgames($1) AS profit',
        [games]
        );
        return res.rows[0].profit;
    },
    async getSiteProfitTime(time) {
        let res = await query(
            'SELECT siteprofittime($1) AS profit',
        [new Date(Date.now() - time)]
        );
        return res.rows[0].profit;
    },

    // Cmd/Streak.js
    async getLastStreak(count, op, bound) {
        debug('Retrieving last streak');

        let data = await query(
          `WITH
             t1 AS
               (SELECT
                  id,
                  CASE WHEN id IS DISTINCT FROM (lag(id) OVER (ORDER BY id)) + 1
                    THEN id
                  END AS id_start
                FROM games WHERE game_crash ${op} $1),
             t2 AS (SELECT id, max(id_start) OVER (ORDER BY id) AS id_group FROM t1),
             best AS
               (SELECT id_group, COUNT(*) FROM t2 GROUP BY id_group
                HAVING count(*) >= $2 ORDER BY id_group DESC LIMIT 1)
           SELECT id game_id, game_crash game_crash FROM games, best
           WHERE id >= best.id_group AND id < best.id_group + best.count
           ORDER BY id`,
          [bound, count]
        );

        return data.rows;
    },
    async getMaxStreak(op, bound) {
        debug('Retrieving max streak');

        let data = await query(
          `WITH
             t1 AS
               (SELECT
                  id,
                  CASE WHEN id IS DISTINCT FROM (lag(id) OVER (ORDER BY id)) + 1
                    THEN id
                  END AS id_start
                FROM games
                WHERE game_crash ${op} $1),
             t2 AS
               (SELECT id, max(id_start) OVER (ORDER BY id) AS id_group
                FROM t1),
             best AS
               (SELECT id_group, COUNT(*) AS count
                FROM t2
                GROUP BY id_group
                ORDER BY count DESC LIMIT 1)
           SELECT id game_id, game_crash game_crash
           FROM games, best
           WHERE id >= best.id_group AND id < best.id_group + best.count
           ORDER BY id`,
          [bound]
        );

        return data.rows;
    },

    // Cmd/Wagered.js
    async getWageredGames(games) {
        let res = await query(
            'SELECT sitewageredgames($1) AS wagered',
        [games]
        );
        return res.rows[0].wagered;
    },
    async getWageredTime(time) {
        let res = await query(
            'SELECT sitewageredtime($1) AS wagered',
        [new Date(Date.now() - time)]
        );
        return res.rows[0].wagered;
    },

    // Shiba.js
    async getLastSeen(username) {
        debug(`Getting last chat message of user ${username}`);

        let user = await getExistingUser(username);
        let data = await query(
          `SELECT created FROM chats WHERE user_id = $1
             ORDER BY created DESC LIMIT 1`,
          [user.id]
        );

        return data.rows.length > 0 ?
          // Return the first (and only) row.
          {
            username: user.username,
            time:     new Date(data.rows[0].created)
          } :
          // User never said anything.
          {
            username: user.username
          };
    },
    async getLick(username) {
        debug('Getting custom lick messages for user: ' + username);
        const user = await getExistingUser(username);
        const res  = await query('SELECT message FROM licks WHERE user_id = $1',
          [user.id]
        );

        return {
          username: user.username,
          licks: res.rows.map(row => row.message)
        };
    },
    async putLick(username, message, creatorname) {
        debug('Recording custom lick message for user: ' + username);

        const [ user, creator ] = await Promise.all([username, creatorname].map(getUser))

        await query(
          'INSERT INTO licks(user_id, message, creator_id) VALUES ($1, $2, $3)',
          [user.id, message, creator.id]
        );
    },

    // Store/Automute.js
    async addAutomute(creator, regex) {
        debug(`Adding automute ${regex}`);

        try {
          let user = await getUser(creator);
          await query(
            'INSERT INTO automutes(creator_id, regexp) VALUES($1, $2)',
            [user.id, regex.toString()]
          );
        } catch(err) {
          console.error(err);
          throw err;
        }
    },
    async getAutomutes() {
        debug('Getting automute list.');

        const data = await query('SELECT regexp FROM automutes WHERE enabled')
        const reg = /^\/(.*)\/([gi]*)$/;
        const res = data.rows.map(row => {
          const match = row.regexp.match(reg);
          return new RegExp(match[1], match[2]);
        });

        return res;
    },

    // Store/Chat.js
    async getLastMessages() {
        debug('Retrieving last chat messages');
        const { rows } = await query(`
            SELECT
                'message' AS kind,
                id,
                usernameOf(user_id) AS uname,
                channel,
                message,
                is_notification,
                created
            FROM chats ORDER BY id DESC LIMIT $1
        `, [ Config.CHAT_HISTORY ])
        return rows.reverse()
    },
    async putMsg({ id, uname, channel, message, isNotification, created }) {
        debug(`Recording chat message. User: ${uname}`);
        const user = await getUser(uname);

        try {
            await query(`
                INSERT INTO chats(id, user_id, channel, message, is_notification, created)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT DO NOTHING
            `, [ id, user.id, channel, message, isNotification, created ])
        } catch(err) {
            console.log('ARGUMENTS:', arguments);
            if (err instanceof Error)
            console.error('[Pg.putChat] ERROR:', err.stack);
            else
            console.error('[Pg.putChat] ERROR:', err);
        }
    },

    // Store/Game.js
    async getLastGames() {
        debug('Retrieving last games');

        const res = await query(
          `SELECT * FROM (
             SELECT id AS game_id, game_crash, created, seed AS hash
             FROM games ORDER BY id DESC LIMIT $1) t
            ORDER BY game_id`,
          [Config.GAME_HISTORY]
        );
        return res.rows;
    },
    async getMissingGames(beg, end) {
        // Retrieve missing games
        let missing = await query(
            `SELECT array_agg(s.missing) AS missing FROM (
            SELECT num AS missing FROM generate_series($1::bigint, $2::bigint) t(num)
            LEFT JOIN games ON (t.num = games.id) WHERE games.id IS NULL) s`,
            [beg, end]
        );

        return missing.rows[0].missing || []
    },
    async putGame(game) {
        let wagered   = 0;
        let cashedOut = 0;
        let numPlayed = 0;
        const playsInserts = []

        for (const { uname, wager, cashedAt } of game.cashedOut) {
            wagered += wager
            cashedOut += Math.round(wager * cashedAt)
            numPlayed++

            const { id } = await getUser(uname)
            playsInserts.push({ id, uname, wager, cashedOut: Math.round(wager * cashedAt) })
        }

        for (const uname of Object.keys(game.playing)) {
            const { wager } = game.playing[uname]
            wagered += wager
            numPlayed++

            const { id } = await getUser(uname)
            playsInserts.push({ id, uname, wager, cashedOut: null })
        }


        debug('Recording info for game #' + game.id);

        await withTransaction(async function(query) {
            debugpg(`Inserting game data for game #${game.id}`);
            await query(
                `INSERT INTO games (id, game_crash, seed, started, wagered, cashed_out, num_played)
                VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [ game.id, Math.round(game.bust * 100), game.serverSeed, new Date(game.created), wagered, cashedOut, numPlayed ])

            for (const { id, uname, wager, cashedOut } of playsInserts) {
                debugpg(`Inserting play for ${uname}`);
                await query(
                    `INSERT INTO plays(user_id, cash_out, game_id, bet)
                    VALUES ($1, $2, $3, $4)`,
                [ id, cashedOut, game.id, wager ])
            }
        })
    }
}
module.exports = Pg
