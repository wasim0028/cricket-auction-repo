const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const pool = require('../db');
const { getSettings } = require('../settings');
const { teamsWithStats } = require('../teams');
const { asyncHandler, HttpError, ROLES } = require('../utils');

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registrations from this network. Try again later.' },
});

const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(150),
  phone: z.string().trim().regex(/^[0-9+\-\s]{8,15}$/, 'Enter a valid phone number'),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  state: z.string().trim().max(60).optional().default(''),
  nationality: z.string().trim().min(2).max(60).default('India'),
  role: z.enum(ROLES),
  battingStyle: z.enum(['RIGHT_HAND', 'LEFT_HAND']).optional(),
  bowlingStyle: z.string().trim().max(60).optional().default(''),
  isCapped: z.boolean(),
  matchesPlayed: z.coerce.number().int().min(0).max(2000).default(0),
  achievements: z.string().trim().max(1000).optional().default(''),
  runs: z.coerce.number().int().min(0).max(100000).default(0),
  battingAverage: z.coerce.number().min(0).max(200).default(0),
  strikeRate: z.coerce.number().min(0).max(400).default(0),
  wickets: z.coerce.number().int().min(0).max(5000).default(0),
  economy: z.coerce.number().min(0).max(30).default(0),
  // small resized JPEG as a data URL (the browser shrinks it before upload)
  photo: z
    .string()
    .max(200000)
    .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/, 'Photo must be a JPEG')
    .optional(),
});

router.get(
  '/status',
  asyncHandler(async (req, res) => {
    const s = await getSettings();
    res.json({
      registrationOpen: s.registrationOpen,
      registrationDeadline: s.registrationDeadline,
      auctionDate: s.auctionDate,
    });
  })
);

router.post(
  '/register',
  registerLimiter,
  asyncHandler(async (req, res) => {
    const s = await getSettings();
    if (!s.registrationOpen) throw new HttpError(403, 'Registration window is closed');

    const d = registerSchema.parse(req.body);
    const dob = new Date(d.dateOfBirth);
    if (Number.isNaN(dob.getTime()) || dob > new Date()) throw new HttpError(400, 'Invalid date of birth');
    const age = (Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
    if (age < 14 || age > 60) throw new HttpError(400, 'Player age must be between 14 and 60');

    if (d.photo) {
      const head = Buffer.from(d.photo.slice('data:image/jpeg;base64,'.length, 'data:image/jpeg;base64,'.length + 8), 'base64');
      if (!(head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff)) throw new HttpError(400, 'Photo must be a JPEG image');
    }
    const isOverseas = d.nationality.trim().toLowerCase() !== 'india';
    const basePrice = d.isCapped ? 50 : 20; // admin can change later

    try {
      const { rows } = await pool.query(
        `INSERT INTO players
           (full_name, email, phone, date_of_birth, state, nationality, is_overseas, role,
            batting_style, bowling_style, is_capped, matches_played, achievements, base_price_lakh,
            runs, batting_avg, strike_rate, wickets, economy, photo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         RETURNING id`,
        [d.fullName, d.email, d.phone, d.dateOfBirth, d.state, d.nationality, isOverseas, d.role,
         d.battingStyle || null, d.bowlingStyle, d.isCapped, d.matchesPlayed, d.achievements, basePrice,
         d.runs, d.battingAverage, d.strikeRate, d.wickets, d.economy, d.photo || null]
      );
      res.status(201).json({ id: rows[0].id, message: 'Registration submitted successfully' });
    } catch (e) {
      if (e.code === '23505') throw new HttpError(409, 'A player with this email is already registered');
      throw e;
    }
  })
);

// Public auction board: teams + sold players
router.get(
  '/board',
  asyncHandler(async (req, res) => {
    const teams = await teamsWithStats();
    const { rows: sold } = await pool.query(
      `SELECT p.id, p.full_name, p.role, p.is_capped, p.is_overseas, p.sold_price_lakh, p.base_price_lakh,
              t.short_name AS team
         FROM players p JOIN teams t ON t.id = p.team_id
        WHERE p.auction_status = 'SOLD'
        ORDER BY p.sold_price_lakh DESC, p.full_name`
    );
    res.json({ teams, sold });
  })
);

module.exports = router;
