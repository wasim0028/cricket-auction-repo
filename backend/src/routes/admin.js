const router = require('express').Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const live = require('../live');
const pool = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { getSettings, setSetting } = require('../settings');
const { teamsWithStats } = require('../teams');
const { asyncHandler, HttpError, ROLES, BASE_PRICE_SLABS } = require('../utils');

router.use(requireAdmin);

// Admin can only see the registered-player data once the window is closed.
const requireWindowClosed = asyncHandler(async (req, res, next) => {
  const s = await getSettings();
  if (s.registrationOpen) {
    throw new HttpError(403, 'Player data is available only after the registration window closes', {
      code: 'REGISTRATION_OPEN',
    });
  }
  next();
});

/* ---------------------------- Settings & stats ---------------------------- */

router.get(
  '/settings',
  asyncHandler(async (req, res) => res.json(await getSettings()))
);

const settingsSchema = z.object({
  registrationOpen: z.boolean().optional(),
  registrationDeadline: z.string().datetime().nullable().optional(),
  auctionDate: z.string().nullable().optional(),
  bidTimerSeconds: z.number().int().min(5).max(120).optional(),
});

router.put(
  '/settings',
  asyncHandler(async (req, res) => {
    const d = settingsSchema.parse(req.body);
    if (d.registrationOpen !== undefined) await setSetting('registration_open', d.registrationOpen);
    if (d.registrationDeadline !== undefined) await setSetting('registration_deadline', d.registrationDeadline || '');
    if (d.auctionDate !== undefined) await setSetting('auction_date', d.auctionDate || '');
    if (d.bidTimerSeconds !== undefined) await setSetting('bid_timer_seconds', d.bidTimerSeconds);
    res.json(await getSettings());
  })
);

// Counts only (safe to show while registration is still open)
router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS total,
              (COUNT(*) FILTER (WHERE reg_status='PENDING'))::int AS pending,
              (COUNT(*) FILTER (WHERE reg_status='APPROVED'))::int AS approved,
              (COUNT(*) FILTER (WHERE reg_status='REJECTED'))::int AS rejected,
              (COUNT(*) FILTER (WHERE auction_status='SOLD'))::int AS sold,
              (COUNT(*) FILTER (WHERE auction_status='UNSOLD'))::int AS unsold
         FROM players`
    );
    res.json(rows[0]);
  })
);

/* -------------------------------- Players -------------------------------- */

function playerFilter(q) {
  const where = [];
  const params = [];
  const push = (v) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (ROLES.includes(q.role)) where.push(`p.role = ${push(q.role)}`);
  if (q.capped === 'true' || q.capped === 'false') where.push(`p.is_capped = ${push(q.capped === 'true')}`);
  if (['PENDING', 'APPROVED', 'REJECTED'].includes(q.reg_status)) where.push(`p.reg_status = ${push(q.reg_status)}`);
  if (['AVAILABLE', 'SOLD', 'UNSOLD'].includes(q.auction_status))
    where.push(`p.auction_status = ${push(q.auction_status)}`);
  if (q.q) {
    const ph = push(`%${String(q.q).slice(0, 80)}%`);
    where.push(`(p.full_name ILIKE ${ph} OR p.email ILIKE ${ph})`);
  }
  return { clause: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

// explicit column list so the (large) photo is never sent with list queries
const PLAYER_SELECT = `SELECT p.id, p.full_name, p.email, p.phone, p.date_of_birth, p.state, p.nationality,
                              p.is_overseas, p.role, p.batting_style, p.bowling_style, p.is_capped,
                              p.matches_played, p.runs, p.batting_avg, p.strike_rate, p.wickets, p.economy,
                              p.achievements, p.base_price_lakh, p.reg_status, p.auction_status, p.team_id,
                              p.sold_price_lakh, p.created_at, (p.photo IS NOT NULL) AS has_photo,
                              t.short_name AS team_short
                         FROM players p LEFT JOIN teams t ON t.id = p.team_id`;

router.get(
  '/players',
  requireWindowClosed,
  asyncHandler(async (req, res) => {
    const { clause, params } = playerFilter(req.query);
    const { rows } = await pool.query(
      `${PLAYER_SELECT} ${clause} ORDER BY p.is_capped DESC, p.role, p.full_name`,
      params
    );
    res.json(rows);
  })
);

router.get(
  '/players.csv',
  requireWindowClosed,
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(`${PLAYER_SELECT} ORDER BY p.is_capped DESC, p.role, p.full_name`);
    const cols = [
      'id', 'full_name', 'email', 'phone', 'date_of_birth', 'state', 'nationality', 'is_overseas', 'role',
      'batting_style', 'bowling_style', 'is_capped', 'matches_played', 'achievements', 'base_price_lakh',
      'reg_status', 'auction_status', 'team_short', 'sold_price_lakh', 'created_at',
    ];
    const esc = (v) => {
      if (v === null || v === undefined) return '';
      let s = v instanceof Date ? v.toISOString() : String(v);
      if (/^[=+\-@]/.test(s)) s = "'" + s; // neutralise CSV/Excel formula injection
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="players.csv"');
    res.send(csv);
  })
);

router.post(
  '/players/approve-all',
  requireWindowClosed,
  asyncHandler(async (req, res) => {
    const r = await pool.query(`UPDATE players SET reg_status='APPROVED' WHERE reg_status='PENDING'`);
    res.json({ approved: r.rowCount });
  })
);

const patchSchema = z.object({
  reg_status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  base_price_lakh: z.number().int().refine((v) => BASE_PRICE_SLABS.includes(v), 'Invalid base price slab').optional(),
  is_capped: z.boolean().optional(),
  role: z.enum(ROLES).optional(),
});

router.patch(
  '/players/:id',
  requireWindowClosed,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const d = patchSchema.parse(req.body);
    const { rows: cur } = await pool.query('SELECT auction_status FROM players WHERE id = $1', [id]);
    if (!cur[0]) throw new HttpError(404, 'Player not found');
    if (cur[0].auction_status === 'SOLD') throw new HttpError(409, 'Undo the sale before editing a sold player');

    const sets = [];
    const params = [];
    for (const [k, v] of Object.entries(d)) {
      params.push(v);
      sets.push(`${k} = $${params.length}`);
    }
    if (!sets.length) throw new HttpError(400, 'Nothing to update');
    params.push(id);
    const { rows } = await pool.query(
      `UPDATE players SET ${sets.join(', ')} WHERE id = $${params.length}
       RETURNING id, reg_status, base_price_lakh, is_capped, role`,
      params
    );
    res.json(rows[0]);
  })
);

/* --------------------------------- Teams --------------------------------- */

router.get(
  '/teams',
  asyncHandler(async (req, res) => res.json(await teamsWithStats()))
);

const teamSchema = z.object({
  name: z.string().trim().min(2).max(60),
  short_name: z.string().trim().min(2).max(5).transform((s) => s.toUpperCase()),
  purse_lakh: z.number().int().min(100).max(100000).default(12000),
  max_squad: z.number().int().min(1).max(40).default(25),
  max_overseas: z.number().int().min(0).max(15).default(8),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colour must look like #1d6fd6').default('#0b5d3b'),
  owner_name: z.string().trim().max(60).default(''),
});

router.post(
  '/teams',
  asyncHandler(async (req, res) => {
    const d = teamSchema.parse(req.body);
    try {
      const { rows } = await pool.query(
        `INSERT INTO teams (name, short_name, purse_lakh, max_squad, max_overseas, color, owner_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [d.name, d.short_name, d.purse_lakh, d.max_squad, d.max_overseas, d.color, d.owner_name]
      );
      res.status(201).json((await teamsWithStats(pool, rows[0].id))[0]);
    } catch (e) {
      if (e.code === '23505') throw new HttpError(409, 'Team name or short name already exists');
      throw e;
    }
  })
);

router.put(
  '/teams/:id',
  asyncHandler(async (req, res) => {
    const d = teamSchema.parse(req.body);
    const id = Number(req.params.id);
    try {
      const r = await pool.query(
        `UPDATE teams SET name=$1, short_name=$2, purse_lakh=$3, max_squad=$4, max_overseas=$5, color=$6, owner_name=$7
          WHERE id=$8`,
        [d.name, d.short_name, d.purse_lakh, d.max_squad, d.max_overseas, d.color, d.owner_name, id]
      );
      if (!r.rowCount) throw new HttpError(404, 'Team not found');
    } catch (e) {
      if (e.code === '23505') throw new HttpError(409, 'Team name or short name already exists');
      throw e;
    }
    res.json((await teamsWithStats(pool, id))[0]);
  })
);

// Generate (or reset) the passcode a team owner uses to bid. Shown once; only a hash is stored.
const PASSCODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
router.post(
  '/teams/:id/passcode',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const passcode = Array.from({ length: 8 }, () => PASSCODE_ALPHABET[crypto.randomInt(PASSCODE_ALPHABET.length)]).join('');
    const hash = await bcrypt.hash(passcode, 10);
    const r = await pool.query('UPDATE teams SET access_hash = $1 WHERE id = $2', [hash, id]);
    if (!r.rowCount) throw new HttpError(404, 'Team not found');
    res.json({ passcode });
  })
);

router.delete(
  '/teams/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { rowCount } = await pool.query(`SELECT 1 FROM players WHERE team_id = $1 LIMIT 1`, [id]);
    if (rowCount) throw new HttpError(409, 'Team has players; undo their sales first');
    await pool.query('DELETE FROM teams WHERE id = $1', [id]);
    res.json({ ok: true });
  })
);

/* -------------------------------- Auction -------------------------------- */

router.use('/auction', requireWindowClosed);
router.use('/live', requireWindowClosed);

// The player currently on the live block must be finished through the live controls
async function assertNotOnBlock(playerId) {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM auction_state WHERE id = 1 AND status <> 'IDLE' AND player_id = $1`,
    [playerId]
  );
  if (rowCount) throw new HttpError(409, 'This player is on the live block. Use the live auction controls.');
}

// Per-category counts (approved players only)
router.get(
  '/auction/categories',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT role, is_capped,
              COUNT(*)::int AS total,
              (COUNT(*) FILTER (WHERE auction_status='AVAILABLE'))::int AS available,
              (COUNT(*) FILTER (WHERE auction_status='SOLD'))::int AS sold,
              (COUNT(*) FILTER (WHERE auction_status='UNSOLD'))::int AS unsold
         FROM players WHERE reg_status='APPROVED'
        GROUP BY role, is_capped`
    );
    res.json(rows);
  })
);

router.get(
  '/auction/players',
  asyncHandler(async (req, res) => {
    const { clause, params } = playerFilter({ ...req.query, reg_status: 'APPROVED' });
    const { rows } = await pool.query(
      `${PLAYER_SELECT} ${clause} ORDER BY p.base_price_lakh DESC, p.matches_played DESC, p.full_name`,
      params
    );
    res.json(rows);
  })
);

const sellSchema = z.object({
  playerId: z.number().int(),
  teamId: z.number().int(),
  priceLakh: z.number().int().positive(),
});

router.post(
  '/auction/sell',
  asyncHandler(async (req, res) => {
    const d = sellSchema.parse(req.body);
    await assertNotOnBlock(d.playerId);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: pr } = await client.query('SELECT * FROM players WHERE id = $1 FOR UPDATE', [d.playerId]);
      const player = pr[0];
      if (!player) throw new HttpError(404, 'Player not found');
      if (player.reg_status !== 'APPROVED') throw new HttpError(409, 'Player registration is not approved');
      if (player.auction_status === 'SOLD') throw new HttpError(409, 'Player already sold');

      const { rowCount } = await client.query('SELECT id FROM teams WHERE id = $1 FOR UPDATE', [d.teamId]);
      if (!rowCount) throw new HttpError(404, 'Team not found');
      const team = (await teamsWithStats(client, d.teamId))[0];

      if (d.priceLakh < player.base_price_lakh)
        throw new HttpError(400, `Price is below the base price (${player.base_price_lakh} lakh)`);
      if (d.priceLakh > team.remaining_lakh)
        throw new HttpError(409, `${team.short_name} has only ${team.remaining_lakh} lakh left in the purse`);
      if (team.squad_size >= team.max_squad)
        throw new HttpError(409, `${team.short_name} already has a full squad (${team.max_squad})`);
      if (player.is_overseas && team.overseas_count >= team.max_overseas)
        throw new HttpError(409, `${team.short_name} already has ${team.max_overseas} overseas players`);

      await client.query(
        `UPDATE players SET auction_status='SOLD', team_id=$1, sold_price_lakh=$2 WHERE id=$3`,
        [d.teamId, d.priceLakh, d.playerId]
      );
      await client.query(
        `INSERT INTO auction_log (player_id, team_id, action, price_lakh, admin) VALUES ($1,$2,'SOLD',$3,$4)`,
        [d.playerId, d.teamId, d.priceLakh, req.admin.username]
      );
      await client.query('COMMIT');
      res.json({ ok: true, team: (await teamsWithStats(pool, d.teamId))[0] });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  })
);

const playerOnly = z.object({ playerId: z.number().int() });

router.post(
  '/auction/unsold',
  asyncHandler(async (req, res) => {
    const { playerId } = playerOnly.parse(req.body);
    await assertNotOnBlock(playerId);
    const r = await pool.query(
      `UPDATE players SET auction_status='UNSOLD'
        WHERE id=$1 AND reg_status='APPROVED' AND auction_status='AVAILABLE' RETURNING id`,
      [playerId]
    );
    if (!r.rowCount) throw new HttpError(409, 'Only an available, approved player can be marked unsold');
    await pool.query(`INSERT INTO auction_log (player_id, action, admin) VALUES ($1,'UNSOLD',$2)`, [
      playerId,
      req.admin.username,
    ]);
    res.json({ ok: true });
  })
);

// Undo a sale or an unsold mark -> back to AVAILABLE
router.post(
  '/auction/undo',
  asyncHandler(async (req, res) => {
    const { playerId } = playerOnly.parse(req.body);
    const r = await pool.query(
      `UPDATE players SET auction_status='AVAILABLE', team_id=NULL, sold_price_lakh=NULL
        WHERE id=$1 AND auction_status <> 'AVAILABLE' RETURNING id`,
      [playerId]
    );
    if (!r.rowCount) throw new HttpError(409, 'Nothing to undo for this player');
    await pool.query(`INSERT INTO auction_log (player_id, action, admin) VALUES ($1,'UNDO',$2)`, [
      playerId,
      req.admin.username,
    ]);
    res.json({ ok: true });
  })
);

// Accelerated round: put all UNSOLD players of a category back in the pool
const accelSchema = z.object({ role: z.enum(ROLES), isCapped: z.boolean() });
router.post(
  '/auction/accelerate',
  asyncHandler(async (req, res) => {
    const d = accelSchema.parse(req.body);
    const r = await pool.query(
      `UPDATE players SET auction_status='AVAILABLE'
        WHERE reg_status='APPROVED' AND auction_status='UNSOLD' AND role=$1 AND is_capped=$2
        RETURNING id`,
      [d.role, d.isCapped]
    );
    for (const row of r.rows) {
      await pool.query(`INSERT INTO auction_log (player_id, action, admin) VALUES ($1,'ACCELERATE',$2)`, [
        row.id,
        req.admin.username,
      ]);
    }
    res.json({ reopened: r.rowCount });
  })
);

router.get(
  '/auction/log',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT l.id, l.action, l.price_lakh, l.at, l.admin, p.full_name, t.short_name AS team
         FROM auction_log l
         JOIN players p ON p.id = l.player_id
         LEFT JOIN teams t ON t.id = l.team_id
        ORDER BY l.id DESC LIMIT 50`
    );
    res.json(rows);
  })
);

/* ----------------------------- Live auction ------------------------------ */

const startSchema = z.object({ playerId: z.number().int() });
const nextSchema = z.object({ role: z.enum(ROLES).optional(), isCapped: z.boolean().optional() });

router.post('/live/start', asyncHandler(async (req, res) => {
  res.json(await live.startPlayer(startSchema.parse(req.body).playerId));
}));
router.post('/live/next', asyncHandler(async (req, res) => {
  res.json(await live.startNext(nextSchema.parse(req.body || {})));
}));
router.post('/live/pause', asyncHandler(async (req, res) => res.json(await live.pause())));
router.post('/live/resume', asyncHandler(async (req, res) => res.json(await live.resume())));
router.post('/live/extend', asyncHandler(async (req, res) => {
  const { seconds } = z.object({ seconds: z.number().int().min(1).max(60).default(10) }).parse(req.body || {});
  res.json(await live.extend(seconds));
}));
router.post('/live/finalize', asyncHandler(async (req, res) => res.json(await live.finalize(req.admin.username))));
router.post('/live/cancel', asyncHandler(async (req, res) => res.json(await live.cancel())));

module.exports = router;
