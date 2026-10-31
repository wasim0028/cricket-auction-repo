// Live auction engine.
// State lives in one DB row (auction_state) and every change happens in a transaction that
// locks that row, so bids are serialised correctly even with several API instances.
// Changes are announced with pg NOTIFY; each instance LISTENs and pushes snapshots to its
// WebSocket clients (see ws.js).
const pool = require('./db');
const { teamsWithStats } = require('./teams');
const { getSettings } = require('./settings');
const { HttpError } = require('./utils');

const CHANNEL = 'auction_event';
const ROLE_ORDER = `array_position(ARRAY['BATSMAN','BOWLER','WICKETKEEPER','ALLROUNDER'], p.role)`;

// Bid increments in lakh, by current price (IPL-style slabs)
function increment(price) {
  if (price < 100) return 5;
  if (price < 200) return 10;
  if (price < 500) return 20;
  return 25;
}
const nextPriceOf = (st) =>
  st.leading_team_id ? st.current_price_lakh + increment(st.current_price_lakh) : st.current_price_lakh;

async function withTx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

const lockState = async (c) =>
  (
    await c.query(
      `SELECT *, (timer_ends_at IS NOT NULL AND timer_ends_at <= now()) AS expired
         FROM auction_state WHERE id = 1 FOR UPDATE`
    )
  ).rows[0];

const notify = (c) => c.query('SELECT pg_notify($1, $2)', [CHANNEL, '1']);

/* ------------------------------ admin actions ----------------------------- */

async function startPlayer(playerId) {
  const { bidTimerSeconds } = await getSettings();
  return withTx(async (c) => {
    const st = await lockState(c);
    if (st.status !== 'IDLE') throw new HttpError(409, 'A player is already on the block. Sell or cancel first.');
    const { rows } = await c.query(
      'SELECT id, base_price_lakh, reg_status, auction_status FROM players WHERE id = $1 FOR UPDATE',
      [playerId]
    );
    const p = rows[0];
    if (!p) throw new HttpError(404, 'Player not found');
    if (p.reg_status !== 'APPROVED') throw new HttpError(409, 'Player registration is not approved');
    if (p.auction_status !== 'AVAILABLE') throw new HttpError(409, 'Player is not available');

    await c.query('DELETE FROM bids WHERE player_id = $1', [playerId]); // fresh start if re-run
    // opening window is twice the normal timer so owners have time to react to a new player
    await c.query(
      `UPDATE auction_state
          SET status = 'BIDDING', player_id = $1, current_price_lakh = $2, leading_team_id = NULL,
              timer_ends_at = now() + make_interval(secs => $3::double precision),
              paused_remaining_ms = NULL, last_result = NULL, version = version + 1, updated_at = now()
        WHERE id = 1`,
      [playerId, p.base_price_lakh, bidTimerSeconds * 2]
    );
    await notify(c);
    return { ok: true, playerId };
  });
}

async function startNext({ role, isCapped } = {}) {
  const where = [`p.reg_status = 'APPROVED'`, `p.auction_status = 'AVAILABLE'`];
  const params = [];
  if (role) {
    params.push(role);
    where.push(`p.role = $${params.length}`);
  }
  if (typeof isCapped === 'boolean') {
    params.push(isCapped);
    where.push(`p.is_capped = $${params.length}`);
  }
  const { rows } = await pool.query(
    `SELECT p.id FROM players p WHERE ${where.join(' AND ')}
      ORDER BY p.is_capped DESC, ${ROLE_ORDER}, p.base_price_lakh DESC, p.matches_played DESC, p.id
      LIMIT 1`,
    params
  );
  if (!rows[0]) throw new HttpError(404, 'No available players left in this set');
  return startPlayer(rows[0].id);
}

async function finalizeLocked(c, st, who) {
  const { rows } = await c.query(
    'SELECT id, full_name, role, auction_status FROM players WHERE id = $1 FOR UPDATE',
    [st.player_id]
  );
  const pl = rows[0];
  let result;
  if (pl.auction_status !== 'AVAILABLE') {
    result = { result: 'CANCELLED', playerId: pl.id, playerName: pl.full_name, role: pl.role };
  } else if (st.leading_team_id) {
    await c.query(
      `UPDATE players SET auction_status = 'SOLD', team_id = $1, sold_price_lakh = $2 WHERE id = $3`,
      [st.leading_team_id, st.current_price_lakh, pl.id]
    );
    await c.query(
      `INSERT INTO auction_log (player_id, team_id, action, price_lakh, admin) VALUES ($1,$2,'SOLD',$3,$4)`,
      [pl.id, st.leading_team_id, st.current_price_lakh, who]
    );
    const t = (await c.query('SELECT short_name, name, color FROM teams WHERE id = $1', [st.leading_team_id])).rows[0];
    result = {
      result: 'SOLD', playerId: pl.id, playerName: pl.full_name, role: pl.role,
      team: t.short_name, teamName: t.name, teamColor: t.color, priceLakh: st.current_price_lakh,
    };
  } else {
    await c.query(`UPDATE players SET auction_status = 'UNSOLD' WHERE id = $1`, [pl.id]);
    await c.query(`INSERT INTO auction_log (player_id, action, admin) VALUES ($1,'UNSOLD',$2)`, [pl.id, who]);
    result = { result: 'UNSOLD', playerId: pl.id, playerName: pl.full_name, role: pl.role };
  }
  await c.query(
    `UPDATE auction_state
        SET status = 'IDLE', player_id = NULL, current_price_lakh = NULL, leading_team_id = NULL,
            timer_ends_at = NULL, paused_remaining_ms = NULL, last_result = $1::jsonb,
            version = version + 1, updated_at = now()
      WHERE id = 1`,
    [JSON.stringify({ ...result, at: new Date().toISOString() })]
  );
  await notify(c);
  return result;
}

// Admin: close bidding now (sold to the leader, or unsold if nobody bid)
const finalize = (who) =>
  withTx(async (c) => {
    const st = await lockState(c);
    if (st.status === 'IDLE') throw new HttpError(409, 'No player is on the block');
    return finalizeLocked(c, st, who);
  });

const pause = () =>
  withTx(async (c) => {
    const st = await lockState(c);
    if (st.status !== 'BIDDING') throw new HttpError(409, 'Bidding is not running');
    await c.query(
      `UPDATE auction_state
          SET status = 'PAUSED',
              paused_remaining_ms = GREATEST(0, (EXTRACT(EPOCH FROM (timer_ends_at - now())) * 1000)::int),
              timer_ends_at = NULL, version = version + 1, updated_at = now()
        WHERE id = 1`
    );
    await notify(c);
    return { ok: true };
  });

const resume = () =>
  withTx(async (c) => {
    const st = await lockState(c);
    if (st.status !== 'PAUSED') throw new HttpError(409, 'Auction is not paused');
    await c.query(
      `UPDATE auction_state
          SET status = 'BIDDING',
              timer_ends_at = now() + make_interval(secs => GREATEST(paused_remaining_ms, 3000) / 1000.0),
              paused_remaining_ms = NULL, version = version + 1, updated_at = now()
        WHERE id = 1`
    );
    await notify(c);
    return { ok: true };
  });

const extend = (seconds) =>
  withTx(async (c) => {
    const st = await lockState(c);
    if (st.status !== 'BIDDING') throw new HttpError(409, 'Bidding is not running');
    await c.query(
      `UPDATE auction_state
          SET timer_ends_at = GREATEST(timer_ends_at, now()) + make_interval(secs => $1::double precision),
              version = version + 1, updated_at = now()
        WHERE id = 1`,
      [seconds]
    );
    await notify(c);
    return { ok: true };
  });

// Admin: take the player off the block without a result (player stays available)
const cancel = () =>
  withTx(async (c) => {
    const st = await lockState(c);
    if (st.status === 'IDLE') throw new HttpError(409, 'No player is on the block');
    await c.query('DELETE FROM bids WHERE player_id = $1', [st.player_id]);
    await c.query(
      `UPDATE auction_state
          SET status = 'IDLE', player_id = NULL, current_price_lakh = NULL, leading_team_id = NULL,
              timer_ends_at = NULL, paused_remaining_ms = NULL, last_result = NULL,
              version = version + 1, updated_at = now()
        WHERE id = 1`
    );
    await notify(c);
    return { ok: true };
  });

/* ------------------------------- team bidding ----------------------------- */

async function placeBid(teamId, expectedPrice) {
  const { bidTimerSeconds } = await getSettings();
  return withTx(async (c) => {
    const st = await lockState(c);
    if (st.status === 'PAUSED') throw new HttpError(409, 'Auction is paused');
    if (st.status !== 'BIDDING') throw new HttpError(409, 'Bidding is not open');
    if (st.expired) throw new HttpError(409, 'Time is up for this player');
    if (st.leading_team_id === teamId) throw new HttpError(409, 'You already hold the highest bid');

    const price = nextPriceOf(st);
    if (expectedPrice !== undefined && expectedPrice !== price)
      throw new HttpError(409, 'The price just changed. Check the new bid and try again.', { code: 'PRICE_CHANGED' });

    const team = (await teamsWithStats(c, teamId))[0];
    if (!team) throw new HttpError(404, 'Team not found');
    if (price > team.remaining_lakh) throw new HttpError(409, 'Not enough purse left for this bid');
    if (team.squad_size >= team.max_squad) throw new HttpError(409, 'Your squad is already full');
    const pl = (await c.query('SELECT is_overseas FROM players WHERE id = $1', [st.player_id])).rows[0];
    if (pl.is_overseas && team.overseas_count >= team.max_overseas)
      throw new HttpError(409, 'Overseas player limit reached');

    await c.query('INSERT INTO bids (player_id, team_id, price_lakh) VALUES ($1,$2,$3)', [st.player_id, teamId, price]);
    await c.query(
      `UPDATE auction_state
          SET current_price_lakh = $1, leading_team_id = $2,
              timer_ends_at = now() + make_interval(secs => $3::double precision),
              version = version + 1, updated_at = now()
        WHERE id = 1`,
      [price, teamId, bidTimerSeconds]
    );
    await notify(c);
    return { ok: true, priceLakh: price };
  });
}

/* ---------------------------------- timer --------------------------------- */

async function tick() {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM auction_state WHERE id = 1 AND status = 'BIDDING' AND timer_ends_at <= now()`
  );
  if (!rowCount) return;
  await withTx(async (c) => {
    const st = await lockState(c);
    if (st.status === 'BIDDING' && st.expired) await finalizeLocked(c, st, 'auto-timer');
  });
}

function startTicker() {
  let busy = false;
  return setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await tick();
    } catch (e) {
      console.error('auction tick failed:', e.message);
    } finally {
      busy = false;
    }
  }, 500);
}

/* -------------------------------- snapshot -------------------------------- */

async function snapshot() {
  const [{ rows: sr }, settings, teams, { rows: recent }] = await Promise.all([
    pool.query(
      `SELECT *, (EXTRACT(EPOCH FROM (timer_ends_at - now())) * 1000)::int AS remaining_ms
         FROM auction_state WHERE id = 1`
    ),
    getSettings(),
    teamsWithStats(),
    pool.query(
      `SELECT l.id, l.action, l.price_lakh, l.at, p.full_name, p.role, t.short_name AS team, t.color AS team_color
         FROM auction_log l
         JOIN players p ON p.id = l.player_id
         LEFT JOIN teams t ON t.id = l.team_id
        WHERE l.action IN ('SOLD','UNSOLD')
        ORDER BY l.id DESC LIMIT 10`
    ),
  ]);
  const st = sr[0];

  let player = null;
  let history = [];
  if (st.player_id) {
    const [{ rows: pr }, { rows: hr }] = await Promise.all([
      pool.query(
        `SELECT id, full_name, role, nationality, is_overseas, is_capped, batting_style, bowling_style,
                matches_played, runs, batting_avg, strike_rate, wickets, economy, base_price_lakh, state,
                achievements, (photo IS NOT NULL) AS has_photo
           FROM players WHERE id = $1`,
        [st.player_id]
      ),
      pool.query(
        `SELECT b.id, b.price_lakh, b.at, t.short_name AS team, t.color AS team_color
           FROM bids b JOIN teams t ON t.id = b.team_id
          WHERE b.player_id = $1 ORDER BY b.id DESC LIMIT 12`,
        [st.player_id]
      ),
    ]);
    const p = pr[0];
    player = {
      ...p,
      batting_avg: Number(p.batting_avg),
      strike_rate: Number(p.strike_rate),
      economy: Number(p.economy),
    };
    history = hr;
  }

  const live = st.status !== 'IDLE';
  return {
    serverTime: Date.now(),
    timerSeconds: settings.bidTimerSeconds,
    state: {
      status: st.status,
      version: st.version,
      player,
      currentPriceLakh: st.current_price_lakh,
      nextPriceLakh: live ? nextPriceOf(st) : null,
      incrementLakh: live ? (st.leading_team_id ? increment(st.current_price_lakh) : 0) : null,
      leadingTeamId: st.leading_team_id,
      remainingMs: st.status === 'BIDDING' ? Math.max(0, st.remaining_ms) : st.paused_remaining_ms,
      history,
      lastResult: st.last_result,
    },
    teams,
    recent,
  };
}

module.exports = {
  CHANNEL, increment, startPlayer, startNext, finalize, pause, resume, extend, cancel,
  placeBid, startTicker, snapshot,
};
