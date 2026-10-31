require('dotenv').config();
const { migrate } = require('./migrate');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
  console.error('JWT_SECRET must be set (min 16 chars)');
  process.exit(1);
}

async function start() {
  // DB may still be booting (docker compose / cloud): retry a few times
  for (let i = 1; i <= 10; i++) {
    try {
      await migrate();
      break;
    } catch (e) {
      if (i === 10) throw e;
      console.log(`DB not ready (${e.message}); retry ${i}/10`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  const app = require('./app');
  const server = require('http').createServer(app);
  require('./ws').attach(server);
  require('./live').startTicker();
  const port = process.env.PORT || 4000;
  server.listen(port, () => console.log(`API + WebSocket listening on :${port}`));
}

start().catch((e) => {
  console.error(e);
  process.exit(1);
});
