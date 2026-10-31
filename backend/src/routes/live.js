const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const pool = require('../db');
const { requireTeam } = require('../middleware/auth');
const { snapshot, placeBid } = require('../live');
const { asyncHandler } = require('../utils');

// Polling fallback for browsers that cannot hold a WebSocket
router.get(
  '/state',
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await snapshot());
  })
);

const bidLimiter = rateLimit({
  windowMs: 10 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `team-${req.team.teamId}`,
  message: { error: 'Slow down: too many bids in a short time' },
});

router.post(
  '/bid',
  requireTeam,
  bidLimiter,
  asyncHandler(async (req, res) => {
    const { expectedPrice } = z.object({ expectedPrice: z.number().int().optional() }).parse(req.body);
    res.json(await placeBid(req.team.teamId, expectedPrice));
  })
);

// Player photo (only for approved players)
router.get(
  '/photo/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).end();
    const { rows } = await pool.query(
      `SELECT photo FROM players WHERE id = $1 AND reg_status = 'APPROVED' AND photo IS NOT NULL`,
      [id]
    );
    const m = rows[0] && /^data:image\/jpeg;base64,(.+)$/.exec(rows[0].photo);
    if (!m) return res.status(404).end();
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=300');
    res.send(Buffer.from(m[1], 'base64'));
  })
);

module.exports = router;
