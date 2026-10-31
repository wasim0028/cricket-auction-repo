const { Pool, types } = require('pg');

// Return DATE columns as plain 'YYYY-MM-DD' strings (no timezone shifting)
types.setTypeParser(1082, (v) => v);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

// Idle clients emit 'error' when the database restarts or the network drops. Without a
// listener Node would crash; the pool discards the broken client and reconnects on demand.
pool.on('error', (err) => console.error('pg pool error (client discarded):', err.message));

module.exports = pool;
