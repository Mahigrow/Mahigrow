// ─────────────────────────────────────────────
//  routes/admin.js  —  Admin retailer management
//  Mount in app.js:
//    const adminRouter = require('./routes/admin');
//    app.use('/api/admin', adminRouter);
// ─────────────────────────────────────────────
const router = require('express').Router();
const prisma = require('../utils/prisma');
const { requireAdmin } = require('../middleware/auth');

// All routes require admin
router.use(requireAdmin);

// ── GET /api/admin/retailers ──────────────────
// List all retailers with full details
router.get('/retailers', async (req, res) => {
  try {
    const retailers = await prisma.retailer.findMany({
      select: {
        id: true, email: true, phone: true,
        shopName: true, ownerName: true,
        gstNumber: true, gstVerified: true,
        district: true, state: true, pincode: true,
        isActive: true, createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ retailers });
  } catch (err) {
    console.error('Admin retailers error:', err.message);
    res.status(500).json({ error: 'Could not fetch retailers' });
  }
});

// ── PATCH /api/admin/retailers/:id ───────────
// Activate or deactivate a retailer account
router.patch('/retailers/:id', async (req, res) => {
  try {
    const { isActive } = req.body;
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive must be true or false' });
    }

    const retailer = await prisma.retailer.update({
      where: { id: req.params.id },
      data:  { isActive },
      select: { id: true, phone: true, shopName: true, isActive: true },
    });

    console.log(
      `[ADMIN] ${isActive ? 'Activated' : 'Deactivated'} retailer: ${retailer.phone} (${retailer.shopName})`
        + ` by admin: ${req.retailer.phone}`
    );

    res.json({ success: true, retailer });
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Retailer not found' });
    }
    console.error('Admin toggle error:', err.message);
    res.status(500).json({ error: 'Could not update retailer' });
  }
});

module.exports = router;