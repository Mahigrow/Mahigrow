require('dotenv').config();
const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const rateLimit   = require('express-rate-limit');

const authRouter     = require('./routes/auth');
const uploadRouter   = require('./routes/upload');
const gstRouter      = require('./routes/gst');
const productsRouter = require('./routes/products');
const ordersRouter   = require('./routes/orders');

const app = express();

// ── SECURITY ──────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin:      process.env.FRONTEND_URL || 'http://localhost:5500',
  credentials: true,
}));
app.use(express.json());

// Global rate limiter — 100 req/15 min per IP
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      100,
  message:  { error: 'Too many requests. Please try again later.' },
}));

// Stricter limiter for auth routes — 10 req/15 min
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      10,
  message:  { error: 'Too many auth attempts. Please wait 15 minutes.' },
});

// ── ROUTES ────────────────────────────────────────────
app.use('/api/auth',     authLimiter, authRouter);
app.use('/api/upload',   uploadRouter);
app.use('/api/gst',      gstRouter);
app.use('/api/products', productsRouter);
app.use('/api/orders',   ordersRouter);

// ── HEALTH CHECK ──────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── 404 ───────────────────────────────────────────────
app.use((_, res) => res.status(404).json({ error: 'Route not found' }));

// ── ERROR HANDLER ─────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;