const jwt    = require('jsonwebtoken');
const prisma = require('../utils/prisma');

// ── sanitize input ────────────────────────────────────────────
function sanitizeString(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>"'`]/g, '').trim().slice(0, 500);
}

// ── requireAuth middleware ────────────────────────────────────
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = header.split(' ')[1];

    // Validate token format before verifying
    if (!token || token.length < 20) {
      return res.status(401).json({ error: 'Invalid token format' });
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtErr) {
      if (jwtErr.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Session expired. Please sign in again.' });
      }
      return res.status(401).json({ error: 'Invalid token' });
    }

    if (!payload.retailerId) {
      return res.status(401).json({ error: 'Invalid token payload' });
    }

    const retailer = await prisma.retailer.findUnique({
      where:  { id: payload.retailerId },
      select: { id: true, email: true, phone: true, shopName: true, isActive: true },
    });

    if (!retailer) {
      return res.status(401).json({ error: 'Account not found' });
    }

    if (!retailer.isActive) {
      return res.status(403).json({
        error:  'Account pending activation',
        detail: 'Our team will call you within 1 business day to activate your account.',
      });
    }

    req.retailer = retailer;
    next();

  } catch (err) {
    console.error('Auth middleware error:', err.message);
    return res.status(500).json({ error: 'Authentication failed' });
  }
}

// ── requireAdmin middleware (for admin routes) ─────────────────
// Add an isAdmin field to Retailer model when needed
// For now, check against an env-level admin phone list
async function requireAdmin(req, res, next) {
  await requireAuth(req, res, async () => {
    const adminPhones = (process.env.ADMIN_PHONES || '').split(',').map(p => p.trim());
    if (!adminPhones.includes(req.retailer.phone)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  });
}

module.exports = { requireAuth, requireAdmin, sanitizeString };