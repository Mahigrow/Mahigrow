const jwt    = require('jsonwebtoken');
const prisma = require('../utils/prisma');

// Attach req.retailer if valid token
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token   = header.split(' ')[1];
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    const retailer = await prisma.retailer.findUnique({
      where:  { id: payload.retailerId },
      select: { id: true, email: true, phone: true, shopName: true, isActive: true },
    });

    if (!retailer) {
      return res.status(401).json({ error: 'Account not found' });
    }

    if (!retailer.isActive) {
      return res.status(403).json({
        error: 'Account not yet activated. Our team will contact you within 1 business day.',
      });
    }

    req.retailer = retailer;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = { requireAuth };