const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { ZodError } = require('zod');

const app = express();
app.set('trust proxy', 1); // behind ALB / Azure Front Door / Cloud Run

app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true,
  })
);
app.use(express.json({ limit: '300kb' })); // registration may carry a small resized photo
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/public', require('./routes/public'));
app.use('/api/live', require('./routes/live'));
app.use('/api/admin', require('./routes/admin'));

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof ZodError) {
    const msg = err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    return res.status(400).json({ error: msg });
  }
  if (err.status) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
