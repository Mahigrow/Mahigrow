'use strict';
const router = require('express').Router();
const prisma = require('../utils/prisma');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// ── Helper: get price for qty from tiers ─────
function getTierPrice(tiers, qty) {
  // tiers = [[minQty, maxQty, price], ...]
  if (!tiers || !tiers.length) return 0;
  for (let i = tiers.length - 1; i >= 0; i--) {
    if (qty >= tiers[i][0]) return tiers[i][2];
  }
  return tiers[0][2];
}

// ── POST /api/orders — Place COD order ───────
router.post('/', requireAuth, async (req, res) => {
  try {
    const { items } = req.body; // [{ productId, qty }]
    if (!items || !items.length)
      return res.status(400).json({ error: 'No items in order' });

    let totalAmount = 0;
    const orderItems = [];

    for (const item of items) {
      if (!item.productId || !item.qty || item.qty < 1)
        return res.status(400).json({ error: 'Invalid item: productId and qty required' });

      const product = await prisma.product.findUnique({ where: { id: item.productId } });
      if (!product) return res.status(404).json({ error: `Product not found: ${item.productId}` });

      const unitPrice = getTierPrice(product.tiers, item.qty);
      const lineTotal = unitPrice * item.qty;
      totalAmount += lineTotal;

      orderItems.push({
        productId: item.productId,
        qty: item.qty,
        unitPrice,
        lineTotal,
      });
    }

    const order = await prisma.order.create({
      data: {
        retailerId: req.retailer.retailerId,
        totalAmount,
        status: 'PLACED',
        paymentMethod: 'COD',
        items: { create: orderItems },
      },
      include: {
        items: {
          include: { product: { select: { name: true, unit: true } } },
        },
      },
    });

    res.status(201).json({ order });
  } catch (err) {
    console.error('Create order error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/orders — Retailer's own orders ──
router.get('/', requireAuth, async (req, res) => {
  try {
    const { status } = req.query;
    const where = { retailerId: req.retailer.retailerId };
    if (status) where.status = status;

    const orders = await prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        items: {
          include: { product: { select: { name: true, unit: true, imageUrl: true } } },
        },
      },
    });

    res.json({ orders });
  } catch (err) {
    console.error('Get orders error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/orders/:id — Single order ───────
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: {
        items: {
          include: { product: { select: { name: true, unit: true, imageUrl: true } } },
        },
        retailer: { select: { shopName: true, phone: true, district: true } },
      },
    });

    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Only owner or admin can view
    if (order.retailerId !== req.retailer.retailerId && !req.retailer.isAdmin)
      return res.status(403).json({ error: 'Not authorized' });

    res.json({ order });
  } catch (err) {
    console.error('Get order error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/orders/admin/all — All orders (admin) ──
router.get('/admin/all', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    const where = {};
    if (status) where.status = status;

    const orders = await prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        items: {
          include: { product: { select: { name: true, unit: true } } },
        },
        retailer: { select: { shopName: true, phone: true, district: true, gstin: true } },
      },
    });

    const stats = {
      total:     orders.length,
      placed:    orders.filter(o => o.status === 'PLACED').length,
      packing:   orders.filter(o => o.status === 'PACKING').length,
      outForDelivery: orders.filter(o => o.status === 'OUT_FOR_DELIVERY').length,
      delivered: orders.filter(o => o.status === 'DELIVERED').length,
      cancelled: orders.filter(o => o.status === 'CANCELLED').length,
    };

    res.json({ orders, stats });
  } catch (err) {
    console.error('Admin get orders error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PATCH /api/orders/:id/status — Update status (admin) ──
router.patch('/:id/status', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['PLACED', 'PACKING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'];
    if (!validStatuses.includes(status))
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });

    const order = await prisma.order.update({
      where: { id: req.params.id },
      data: { status },
      include: {
        retailer: { select: { shopName: true, phone: true } },
      },
    });

    res.json({ order });
  } catch (err) {
    console.error('Update order status error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;