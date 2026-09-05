require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');
const hpp          = require('hpp');

const authRouter     = require('./routes/auth');
const gstRouter      = require('./routes/gst');
const productsRouter = require('./routes/products');
const ordersRouter   = require('./routes/orders');
const uploadRouter   = require('./routes/upload');

const app = express();

// ── 1. TRUST PROXY (required for Railway) ────────────────────
app.set('trust proxy', true);   // Required for Railway reverse proxy

// ── 2. SECURITY HEADERS ───────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,   // handled by frontend
  crossOriginEmbedderPolicy: false,
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
}));

// ── 3. CORS ───────────────────────────────────────────────────
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:5500',
  'http://localhost:3000',
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('CORS: origin ' + origin + ' not allowed'));
  },
  credentials:    true,
  methods:        ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge:         86400,
}));

// ── 4. BODY PARSING with size limits ─────────────────────────
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// ── 5. HTTP PARAMETER POLLUTION ───────────────────────────────
app.use(hpp());

// ── 6. RATE LIMITERS ─────────────────────────────────────────
// Global
app.use(rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             200,
  standardHeaders: true,
  legacyHeaders:   false,
  validate:        { xForwardedForHeader: false, trustProxy: false },
  message:         { error: 'Too many requests. Please try again later.' },
  skip: (req) => req.path === '/health',
}));

// Auth — strict brute force protection
const authLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             10,
  standardHeaders: true,
  legacyHeaders:   false,
  validate:        { xForwardedForHeader: false, trustProxy: false },
  message:         { error: 'Too many login attempts. Please wait 15 minutes.' },
});

// OTP — max 5 per hour
const otpLimiter = rateLimit({
  windowMs:        60 * 60 * 1000,
  max:             5,
  standardHeaders: true,
  legacyHeaders:   false,
  validate:        { xForwardedForHeader: false, trustProxy: false },
  message:         { error: 'Too many OTP requests. Please wait 1 hour.' },
});

// Upload — max 20 per hour
const uploadLimiter = rateLimit({
  windowMs:        60 * 60 * 1000,
  max:             20,
  standardHeaders: true,
  legacyHeaders:   false,
  validate:        { xForwardedForHeader: false, trustProxy: false },
  message:         { error: 'Too many upload requests.' },
});

// ── 7. ROUTES ─────────────────────────────────────────────────
app.use('/api/auth',                    authLimiter, authRouter);
app.use('/api/auth/forgot-password',    otpLimiter);
app.use('/api/gst',                     gstRouter);
app.use('/api/products',                productsRouter);
app.use('/api/orders',                  ordersRouter);
app.use('/api/upload',                  uploadLimiter, uploadRouter);

// ── 8. HEALTH CHECK ───────────────────────────────────────────
app.get('/health', (_, res) => res.json({
  status: 'ok',
  ts: new Date().toISOString(),
  env: process.env.NODE_ENV,
}));

// ── 9. 404 ────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── 10. GLOBAL ERROR HANDLER ─────────────────────────────────
app.use((err, req, res, _next) => {
  if (err.message?.startsWith('CORS')) {
    return res.status(403).json({ error: err.message });
  }
  console.error('[' + new Date().toISOString() + '] ' + req.method + ' ' + req.path, err.message);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Something went wrong. Please try again.'
      : err.message,
  });
});

module.exports = app;