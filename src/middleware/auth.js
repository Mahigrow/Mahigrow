'use strict';
const jwt = require('jsonwebtoken');

// JWT payload shape: { retailerId, isAdmin? }
// req.retailer is set to the decoded payload

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

// Admin check: token must have isAdmin:true
// Phone-list check done in auth routes at login time; not re-checked here
// to avoid needing a DB query on every admin request
function requireAdmin(req, res, next) {
  if (!req.retailer?.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };