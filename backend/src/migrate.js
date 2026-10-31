const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const pool = require('./db');

const DEFAULT_TEAMS = [
  ['Mumbai Mariners', 'MUM', '#1d6fd6'],
  ['Chennai Challengers', 'CHE', '#f2b705'],
  ['Bengaluru Blasters', 'BLR', '#d3202f'],
  ['Kolkata Knights', 'KOL', '#6a35b5'],
  ['Delhi Dynamos', 'DEL', '#1c4fa1'],
  ['Hyderabad Hawks', 'HYD', '#f26a21'],
  ['Rajasthan Royals XI', 'RAJ', '#e0399a'],
  ['Punjab Panthers', 'PUN', '#c8102e'],
  ['Gujarat Gladiators', 'GUJ', '#1b8a9c'],
  ['Lucknow Lions', 'LKO', '#27a9e1'],
];

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await pool.query(sql);

  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD;
  if (!password) throw new Error('ADMIN_PASSWORD env var is required');
  const { rowCount } = await pool.query('SELECT 1 FROM admins WHERE username = $1', [username]);
  if (!rowCount) {
    const hash = await bcrypt.hash(password, 12);
    await pool.query('INSERT INTO admins (username, password_hash) VALUES ($1, $2)', [username, hash]);
    console.log(`Seeded admin user "${username}"`);
  }

  if (process.env.SEED_TEAMS !== 'false') {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM teams');
    if (rows[0].n === 0) {
      for (const [name, short, color] of DEFAULT_TEAMS) {
        await pool.query('INSERT INTO teams (name, short_name, color) VALUES ($1, $2, $3)', [name, short, color]);
      }
      console.log('Seeded default teams');
    } else {
      // upgrade path: give default teams their colours if they still have the placeholder one
      for (const [, short, color] of DEFAULT_TEAMS) {
        await pool.query(`UPDATE teams SET color = $1 WHERE short_name = $2 AND color = '#0b5d3b'`, [color, short]);
      }
    }
  }
}

module.exports = { migrate };
