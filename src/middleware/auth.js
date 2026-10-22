'use strict';
const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.retailer = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.retailer?.isAdmin) return res.status(403).json({ error: 'Admin access required' });
  const adminPhones = (process.env.ADMIN_PHONES || '').split(',').map(p => p.trim());
  if (!adminPhones.includes(req.retailer.phone)) return res.status(403).json({ error: 'Not in admin list' });
  next();
}

module.exports = { requireAuth, requireAdmin };