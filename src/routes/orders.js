// ─────────────────────────────────────────────────────────────
//  routes/orders.js  —  COD Orders + Tracking
// ─────────────────────────────────────────────────────────────
const router  = require('express').Router();
const prisma  = require('../utils/prisma');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// ─────────────────────────────────────────────────────────────
//  POST /api/orders  —  Place a COD order
// ─────────────────────────────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  try {
    const { items } = req.body;

    if (!items?.length) {
      return res.status(400).json({ error: 'No items in order' });
    }

    // Fetch product details and calculate totals
    let subtotal = 0;
    const orderItems = [];

    for (const item of items) {
      const product = await prisma.product.findUnique({
        where:  { id: item.productId, isActive: true },
        select: { id: true, name: true, tiers: true, variants: true, unit: true, moq: true, inStock: true },
      });

      if (!product) {
        return res.status(400).json({ error: `Product not found: ${item.productId}` });
      }
      if (!product.inStock) {
        return res.status(400).json({ error: `${product.name} is out of stock` });
      }
      if (item.qty < product.moq) {
        return res.status(400).json({
          error: `Minimum order for ${product.name} is ${product.moq} ${product.unit}(s)`,
        });
      }

      // Determine tiers to use: variant tiers (if variantSize specified) or product tiers
      let tiersToUse = product.tiers;
      let variantSize = item.variantSize || null;

      if (variantSize && Array.isArray(product.variants)) {
        const variant = product.variants.find(v => v.size === variantSize);
        if (!variant) {
          return res.status(400).json({ error: `Variant size "${variantSize}" not found for ${product.name}` });
        }
        tiersToUse = variant.tiers || product.tiers;
      }

      // Calculate price from tiers (stored in paise)
      let rate = tiersToUse[0][2];
      for (const [min, max, price] of tiersToUse) {
        if (item.qty >= min) rate = price;
        if (item.qty >= min && (max === null || item.qty <= max)) break;
      }

      const total = rate * item.qty;
      subtotal   += total;

      orderItems.push({
        productId:   product.id,
        qty:         item.qty,
        variantSize: variantSize,
        rate,
        total,
      });
    }

    const gstAmount   = Math.round(subtotal * 0.12);
    const grandTotal  = subtotal + gstAmount;

    // Create order in DB
    const order = await prisma.order.create({
      data: {
        retailerId:    req.retailer.id,
        status:        'PLACED',
        paymentMethod: 'COD',
        subtotal,
        gstAmount,
        grandTotal,
        items: {
          create: orderItems,
        },
      },
      include: {
        items: {
          include: { product: { select: { name: true, unit: true, imageUrl: true } } },
        },
      },
    });

    // Format response (convert paise to rupees)
    const formatted = {
      ...order,
      subtotal:    order.subtotal   / 100,
      gstAmount:   order.gstAmount  / 100,
      grandTotal:  order.grandTotal / 100,
      totalAmount: order.grandTotal / 100,   // alias for frontend
      items: order.items.map(i => ({
        ...i,
        unitPrice: i.rate  / 100,            // alias for frontend
        lineTotal: i.total / 100,            // alias for frontend
        rate:      i.rate  / 100,
        total:     i.total / 100,
      })),
    };

    res.status(201).json({ success: true, order: formatted });

  } catch (err) {
    console.error('Create order error:', err.message);
    res.status(500).json({ error: 'Could not place order. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /api/orders  —  Retailer's own orders
// ─────────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      where:   { retailerId: req.retailer.id },
      orderBy: { createdAt: 'desc' },
      include: {
        items: {
          include: {
            product: { select: { name: true, unit: true, imageUrl: true, category: true } },
          },
        },
      },
    });

    const formatted = orders.map(o => ({
      ...o,
      subtotal:    o.subtotal   / 100,
      gstAmount:   o.gstAmount  / 100,
      grandTotal:  o.grandTotal / 100,
      totalAmount: o.grandTotal / 100,
      items: o.items.map(i => ({
        ...i,
        unitPrice: i.rate  / 100,
        lineTotal: i.total / 100,
        rate:      i.rate  / 100,
        total:     i.total / 100,
      })),
    }));

    res.json({ orders: formatted });
  } catch (err) {
    console.error('Get orders error:', err.message);
    res.status(500).json({ error: 'Could not fetch orders' });
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /api/orders/:id  —  Single order details
// ─────────────────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const order = await prisma.order.findFirst({
      where: { id: req.params.id, retailerId: req.retailer.id },
      include: {
        items: {
          include: {
            product: { select: { name: true, unit: true, imageUrl: true, category: true, brand: true } },
          },
        },
      },
    });

    if (!order) return res.status(404).json({ error: 'Order not found' });

    res.json({
      order: {
        ...order,
        subtotal:    order.subtotal   / 100,
        gstAmount:   order.gstAmount  / 100,
        grandTotal:  order.grandTotal / 100,
        totalAmount: order.grandTotal / 100,
        items: order.items.map(i => ({
          ...i,
          unitPrice: i.rate  / 100,
          lineTotal: i.total / 100,
          rate:      i.rate  / 100,
          total:     i.total / 100,
        })),
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch order' });
  }
});

// ─────────────────────────────────────────────────────────────
//  PATCH /api/orders/:id/status  —  Admin updates order status
// ─────────────────────────────────────────────────────────────
router.patch('/:id/status', requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['PLACED', 'PACKING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be one of: ' + validStatuses.join(', ') });
    }

    const order = await prisma.order.update({
      where: { id: req.params.id },
      data:  { status, updatedAt: new Date() },
      select: { id: true, status: true, retailerId: true },
    });

    console.log(`[ADMIN] Order ${order.id} status → ${status} by ${req.retailer.phone}`);
    res.json({ success: true, order });

  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Order not found' });
    res.status(500).json({ error: 'Could not update order status' });
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /api/orders/admin/all  —  Admin sees all orders
// ─────────────────────────────────────────────────────────────
router.get('/admin/all', requireAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    const where = status ? { status } : {};

    const orders = await prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        retailer: { select: { shopName: true, phone: true, district: true } },
        items: {
          include: {
            product: { select: { name: true, unit: true, imageUrl: true } },
          },
        },
      },
    });

    const formatted = orders.map(o => ({
      ...o,
      subtotal:    o.subtotal   / 100,
      gstAmount:   o.gstAmount  / 100,
      grandTotal:  o.grandTotal / 100,
      totalAmount: o.grandTotal / 100,
      items: o.items.map(i => ({
        ...i,
        unitPrice: i.rate  / 100,
        lineTotal: i.total / 100,
        rate:      i.rate  / 100,
        total:     i.total / 100,
      })),
    }));

    res.json({ orders: formatted, total: formatted.length });
  } catch (err) {
    console.error('Admin orders error:', err.message);
    res.status(500).json({ error: 'Could not fetch orders' });
  }
});

module.exports = router;