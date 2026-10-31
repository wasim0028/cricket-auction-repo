const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const pool = require('../db');
const { asyncHandler, HttpError } = require('../utils');

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

const schema = z.object({ username: z.string().min(1), password: z.string().min(1) });

router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { username, password } = schema.parse(req.body);
    const { rows } = await pool.query('SELECT * FROM admins WHERE username = $1', [username]);
    const admin = rows[0];
    const ok = admin && (await bcrypt.compare(password, admin.password_hash));
    if (!ok) throw new HttpError(401, 'Invalid username or password');
    const token = jwt.sign({ role: 'admin', id: admin.id, username: admin.username }, process.env.JWT_SECRET, {
      expiresIn: '12h',
    });
    res.json({ token, username: admin.username });
  })
);

const teamSchema = z.object({ team: z.string().min(1).max(10), passcode: z.string().min(1).max(64) });

// Team owners sign in with the team's short name and the passcode the admin generated
router.post(
  '/team-login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { team, passcode } = teamSchema.parse(req.body);
    const { rows } = await pool.query(
      'SELECT id, name, short_name, color, access_hash FROM teams WHERE short_name = $1',
      [team.toUpperCase()]
    );
    const t = rows[0];
    const ok = t && t.access_hash && (await bcrypt.compare(passcode.trim().toUpperCase(), t.access_hash));
    if (!ok) throw new HttpError(401, 'Invalid team or passcode');
    const token = jwt.sign({ role: 'team', teamId: t.id, shortName: t.short_name }, process.env.JWT_SECRET, {
      expiresIn: '12h',
    });
    res.json({ token, team: { id: t.id, name: t.name, short_name: t.short_name, color: t.color } });
  })
);

module.exports = router;
