CREATE EXTENSION IF NOT EXISTS plv8;


CREATE TABLE users (
  id bigserial NOT NULL PRIMARY KEY,
  username text NOT NULL,
  wagered bigint DEFAULT 0 NOT NULL,
  cashed_out bigint DEFAULT 0 NOT NULL,
  num_played bigint DEFAULT 0 NOT NULL,
  -- The timestamp indicates when we have seen the user for the first time.
  created timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE licks (
  id bigserial NOT NULL PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id),
  message text NOT NULL,
  creator_id bigint NOT NULL REFERENCES users(id),
  created timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TYPE UserClassEnum AS ENUM ('MEMBER', 'TRUSTED', 'ADMIN');

CREATE TABLE chats (
  id bigint NOT NULL PRIMARY KEY, -- set by server, not us
  user_id bigint NOT NULL REFERENCES users(id),
  channel text NOT NULL,
  message text NOT NULL,
  is_notification boolean NOT NULL,
  created timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX unique_chats_user_created ON chats USING btree (user_id, created);

CREATE TABLE games (
  id bigint NOT NULL PRIMARY KEY,
  game_crash bigint NOT NULL,
  seed text,
  created timestamp with time zone DEFAULT now() NOT NULL,
  started timestamp with time zone NULL,
  wagered bigint DEFAULT 0 NOT NULL,
  cashed_out bigint DEFAULT 0 NOT NULL,
  num_played bigint DEFAULT 0 NOT NULL
);

CREATE TABLE plays (
  id bigserial NOT NULL PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id),
  cash_out bigint,
  game_id bigint NOT NULL REFERENCES games(id),
  bet bigint NOT NULL
);

CREATE INDEX licks_user_id_idx ON licks USING btree (user_id);
CREATE INDEX licks_creator_id_idx ON licks USING btree (creator_id);
CREATE INDEX chats_user_id_idx ON chats USING btree (user_id, created DESC);
CREATE INDEX plays_game_id_idx ON plays USING btree (game_id);
CREATE INDEX plays_user_id_idx ON plays USING btree (user_id, id DESC);
CREATE UNIQUE INDEX unique_username ON users USING btree (lower(username));
CREATE INDEX user_id_idx ON users USING btree (id);
CREATE UNIQUE INDEX unique_plays_game_user ON plays USING btree (user_id, game_id);

-- Game crash table

-- This is derived data to have fast lookups of game crashes without
-- doing a linear scan through the games table. Fill this table
-- initially with
--   INSERT INTO game_crashes
--     (SELECT game_crash,MAX(id)
--        FROM games
--        GROUP BY game_crash);

CREATE TABLE game_crashes (
  game_crash bigint NOT NULL PRIMARY KEY,
  id bigint NOT NULL REFERENCES games(id)
);

CREATE UNIQUE INDEX game_crashes_crash_idx
  ON game_crashes
  USING btree (game_crash);

CREATE UNIQUE INDEX game_crashes_id_idx
  ON game_crashes
  USING btree (id DESC);


CREATE FUNCTION game_crash_trigger() RETURNS trigger AS
$$
BEGIN
  LOOP
    -- First try to update the key.
    UPDATE game_crashes
      SET id = CASE WHEN NEW.id > id
                 THEN NEW.id
                 ELSE id
               END
      WHERE game_crash = NEW.game_crash;
    IF found THEN RETURN NEW; END IF;
    -- Not there, so try to insert the key. If someone else inserts
    -- the same key concurrently, we could get a unique-key failure.
    BEGIN
      INSERT INTO game_crashes(game_crash,id) VALUES (NEW.game_crash, NEW.id);
      RETURN NEW;
    EXCEPTION WHEN unique_violation THEN
    -- Do nothing, and loop to try the UPDATE again.
    END;
  END LOOP;
END;
$$
LANGUAGE plpgsql;

CREATE TRIGGER game_crash_trigger
  AFTER INSERT ON games
  FOR EACH ROW EXECUTE PROCEDURE game_crash_trigger();

CREATE TABLE automutes (
  id bigserial NOT NULL PRIMARY KEY,
  creator_id bigint NOT NULL REFERENCES users(id),
  created timestamp with time zone DEFAULT now() NOT NULL,
  regexp text NOT NULL,
  enabled boolean DEFAULT true NOT NULL
);

CREATE TABLE blocks (
  height integer NOT NULL,
  hash text NOT NULL,
  confirmation timestamp with time zone DEFAULT now() NOT NULL,
  notification timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE ONLY blocks
  ADD CONSTRAINT bv_blocks_pkey
  PRIMARY KEY (height, hash);

CREATE TABLE blocknotifications (
  username text NOT NULL,
  channel_name text NOT NULL
);
ALTER TABLE blocknotifications
  ADD CONSTRAINT bv_blocknotifications_pkey
  PRIMARY KEY (username, channel_name);

CREATE TABLE userstats (
  user_id bigint NOT NULL,
  timespan timestamp WITHOUT time zone NOT NULL,
  wagered bigint DEFAULT 0 NOT NULL,
  cashed_out bigint DEFAULT 0 NOT NULL,
  num_played bigint DEFAULT 0 NOT NULL,
  PRIMARY KEY (user_id, timespan)
);

CREATE OR REPLACE FUNCTION plays_userstats_trigger() RETURNS trigger AS $$
  if (TG_OP === 'UPDATE' && OLD.user_id !== NEW.user_id)
    throw new Error('Update of user_id not allowed');

  var userId, wagered = 0, cashedOut = 0, numPlayed = 0;
  var now = new Date();

  // Add new values.
  if (NEW) {
    userId     = NEW.user_id;
    wagered   += NEW.bet;
    cashedOut += NEW.cash_out || 0;
    numPlayed += 1;
  }

  // Subtract old values
  if (OLD) {
    userId     = OLD.user_id;
    wagered   -= OLD.bet;
    cashedOut -= OLD.cash_out || 0;
    numPlayed -= 1;
  }

  for (var i = 1; i <= 10; ++i) {
    try{
      plv8.subtransaction(function() {
        // First try to update the stats row.
        var numRow = plv8.execute(
          "UPDATE userstats " +
          "  SET wagered    = wagered + $1, " +
          "      cashed_out = cashed_out + $2, " +
          "      num_played = num_played + $3 " +
          "  WHERE user_id = $4 " +
          "  AND timespan = date_trunc('week', $5::timestamp without time zone)",
          [wagered, cashedOut, numPlayed, userId, now]
        );

        if (numRow > 0)
          return; // Update successful, so stop here.

        // Row doesnt exist, so try to insert it. If someone else inserts
        // the same key concurrently, we could get a unique-key exception.
        plv8.execute(
          "INSERT INTO userstats(user_id, timespan, wagered, cashed_out, num_played)" +
          "  VALUES ($1, date_trunc('week', $2::timestamp without time zone), $3, $4, $5)",
          [userId, now, wagered, cashedOut, numPlayed]
        );
      });
      // Upserting successful so break out of the loop.
      break;
    } catch(e) {
      var err = e && e.stack && e.stack.toString() || e && e.toString() || e;
      plv8.elog(WARNING, "Failed upserting userstats. Restarting" + e);
      if (i === 10) throw e;
    }
  }

  plv8.execute(
    'UPDATE users ' +
    '  SET wagered    = wagered + $1, ' +
    '      cashed_out = cashed_out + $2, ' +
    '      num_played = num_played + $3 ' +
    '  WHERE id = $4',
    [wagered, cashedOut, numPlayed, userId]
  );
$$ LANGUAGE plv8 VOLATILE;

CREATE TRIGGER plays_userstats_trigger
AFTER INSERT OR UPDATE OR DELETE ON plays
    FOR EACH ROW EXECUTE PROCEDURE plays_userstats_trigger();

CREATE TABLE sitestats (
  timespan timestamp WITHOUT time zone NOT NULL,
  wagered bigint DEFAULT 0 NOT NULL,
  cashed_out bigint DEFAULT 0 NOT NULL,
  num_played bigint DEFAULT 0 NOT NULL,
  PRIMARY KEY (timespan)
);

CREATE OR REPLACE FUNCTION games_sitestats_trigger() RETURNS trigger AS $$
  if (TG_OP === 'UPDATE' && OLD.id !== NEW.id)
    throw new Error('Update of game id not allowed');

  var wagered = 0, cashedOut = 0, numPlayed = 0;
  var created = new Date(NEW.created || OLD.created);

  // Add new values.
  if (NEW) {
    wagered   += NEW.wagered || 0;
    cashedOut += NEW.cashed_out || 0;
    numPlayed += NEW.num_played || 0;
  }

  // Subtract old values
  if (OLD) {
    wagered   -= OLD.wagered || 0;
    cashedOut -= OLD.cashed_out || 0;
    numPlayed -= OLD.num_played || 0;
  }

  for (var i = 1; i <= 10; ++i) {
    try{
      plv8.subtransaction(function() {
        // First try to update the stats row.
        var numRow = plv8.execute(
          "UPDATE sitestats " +
          "  SET wagered    = wagered + $1, " +
          "      cashed_out = cashed_out + $2, " +
          "      num_played = num_played + $3 " +
          "  WHERE timespan = date_trunc('hour', $4::timestamp without time zone)",
          [wagered, cashedOut, numPlayed, created]
        );

        if (numRow > 0)
          return; // Update successful, so stop here.

        // Row doesnt exist, so try to insert it. If someone else inserts
        // the same key concurrently, we could get a unique-key exception.
        plv8.execute(
          "INSERT INTO sitestats(timespan, wagered, cashed_out, num_played)" +
          "  VALUES (date_trunc('hour', $1::timestamp without time zone), $2, $3, $4)",
          [created, wagered, cashedOut, numPlayed]
        );
      });
      // Upserting successful so break out of the loop.
      break;
    } catch(e) {
      if (i === 10) throw e;
      var err = e && e.stack && e.stack.toString() || e && e.toString() || e;
      plv8.elog(WARNING, "Failed upserting sitestats. Restarting" + e);
    }
  }
$$ LANGUAGE plv8 VOLATILE;

CREATE TRIGGER games_sitestats_trigger
AFTER INSERT OR UPDATE OR DELETE ON games
    FOR EACH ROW EXECUTE PROCEDURE games_sitestats_trigger();

CREATE OR REPLACE FUNCTION userIdOf(text) RETURNS bigint AS $$
  SELECT id FROM users WHERE lower(username) = lower($1)
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION usernameOf(bigint) RETURNS text AS $$
  SELECT username FROM users WHERE id = $1
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION
  siteprofittime(timestamp with time zone)
RETURNS numeric AS $$
  SELECT
    COALESCE((
      SELECT SUM(wagered) - SUM(cashed_out)
      FROM games WHERE created >= $1 AND
       created < date_trunc('hour', $1::timestamp without time zone) +
                   '1 hour'::interval), 0) +
    COALESCE((
      SELECT SUM(wagered) - SUM(cashed_out)
      FROM sitestats WHERE timespan > $1), 0)
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION
  siteprofitgames(bigint)
RETURNS numeric AS $$
  SELECT siteprofittime((
    SELECT created FROM games
       WHERE id > (SELECT MAX(id) FROM games) - $1
       ORDER BY id ASC LIMIT 1
  ))
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION
  sitewageredtime(timestamp with time zone)
RETURNS numeric AS $$
  SELECT
    COALESCE((
      SELECT SUM(wagered)
      FROM games WHERE created >= $1 AND
       created < date_trunc('hour', $1::timestamp without time zone) +
                   '1 hour'::interval), 0) +
    COALESCE((
      SELECT SUM(wagered)
      FROM sitestats WHERE timespan > $1), 0)
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION
  sitewageredgames(bigint)
RETURNS numeric AS $$
  SELECT sitewageredtime((
    SELECT created FROM games
       WHERE id > (SELECT MAX(id) FROM games) - $1
       ORDER BY id ASC LIMIT 1
  ))
$$ LANGUAGE SQL STABLE;
