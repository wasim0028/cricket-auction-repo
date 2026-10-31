const pool = require('./db');

async function getSettings(client = pool) {
  const { rows } = await client.query('SELECT key, value FROM settings');
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const deadline = s.registration_deadline ? new Date(s.registration_deadline) : null;
  const manualOpen = s.registration_open === 'true';
  const registrationOpen = manualOpen && (!deadline || new Date() < deadline);
  return {
    registrationOpen,
    manualOpen,
    registrationDeadline: s.registration_deadline || null,
    auctionDate: s.auction_date || null,
    bidTimerSeconds: Number(s.bid_timer_seconds) || 20,
  };
}

async function setSetting(key, value, client = pool) {
  await client.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, String(value)]
  );
}

module.exports = { getSettings, setSetting };
