// WebSocket fan-out. Every API instance LISTENs on the Postgres channel and pushes a fresh
// snapshot to its own connected browsers, so no Redis is needed to run several instances.
const { WebSocketServer } = require('ws');
const { Client } = require('pg');
const { CHANNEL, snapshot } = require('./live');

function attach(server) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1024 });

  const send = (ws, payload) => {
    if (ws.readyState === 1) ws.send(payload);
  };

  wss.on('connection', async (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));
    ws.on('error', () => {});
    try {
      send(ws, JSON.stringify({ type: 'snapshot', data: await snapshot() }));
    } catch (e) {
      console.error('ws snapshot failed:', e.message);
    }
  });

  let pending = false;
  async function broadcast() {
    if (pending) return;
    pending = true;
    await new Promise((r) => setTimeout(r, 30)); // coalesce bursts of events
    pending = false;
    if (!wss.clients.size) return;
    try {
      const msg = JSON.stringify({ type: 'snapshot', data: await snapshot() });
      wss.clients.forEach((c) => send(c, msg));
    } catch (e) {
      console.error('ws broadcast failed:', e.message);
    }
  }

  async function listen() {
    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });
    let retried = false;
    const retry = () => {
      if (retried) return;
      retried = true;
      client.end().catch(() => {});
      setTimeout(listen, 2000);
    };
    client.on('error', retry);
    client.on('end', retry);
    client.on('notification', (m) => m.channel === CHANNEL && broadcast());
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
      broadcast(); // resync browsers after a reconnect
    } catch {
      retry();
    }
  }
  listen();

  // drop dead connections (e.g. phones that went offline)
  setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  return wss;
}

module.exports = { attach };
