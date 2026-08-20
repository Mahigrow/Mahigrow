const router    = require('express').Router();
const prisma    = require('../utils/prisma');
const { requireAuth } = require('../middleware/auth');
const { createOrder, verifySignature } = require('../services/razorpay');

// All order routes require login
router.use(requireAuth);

// ─────────────────────────────────────────────────────
//  POST /api/orders
//  Body: { items: [{ productId, qty }] }
//  Creates order in DB + Razorpay order
// ─────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { items } = req.body;

    if (!items || !items.length) {
      return res.status(400).json({ error: 'Order must have at least one item' });
    }

    // ── Fetch products and calculate totals ──
    let subtotal = 0;
    const orderItems = [];

    for (const item of items) {
      const product = await prisma.product.findUnique({
        where: { id: item.productId, isActive: true },
      });

      if (!product) {
        return res.status(404).json({ error: `Product not found: ${item.productId}` });
      }

      if (!product.inStock) {
        return res.status(400).json({ error: `${product.name} is out of stock` });
      }

      if (item.qty < product.moq) {
        return res.status(400).json({
          error: `Minimum order for ${product.name} is ${product.moq} ${product.unit}s`,
        });
      }

      // Find correct tier rate (in paise)
      let ratePerUnit = product.tiers[0][2]; // default to first tier
      for (const [min, max, price] of product.tiers) {
        if (item.qty >= min && item.qty <= max) {
          ratePerUnit = price;
          break;
        }
      }

      const totalAmount = ratePerUnit * item.qty;
      subtotal += totalAmount;

      orderItems.push({
        productId:   product.id,
        productName: product.name,
        qty:         item.qty,
        ratePerUnit,
        totalAmount,
      });
    }

    // GST @ 12% (average — in production calculate per-product GST rate)
    const gstAmount  = Math.round(subtotal * 0.12);
    const grandTotal = subtotal + gstAmount;

    // ── Create Razorpay order ──
    const rzpOrder = await createOrder(grandTotal, `RS-${Date.now()}`);

    // ── Save order to DB ──
    const order = await prisma.order.create({
      data: {
        retailerId:     req.retailer.id,
        subtotal,
        gstAmount,
        grandTotal,
        razorpayOrderId: rzpOrder.id,
        status:          'PENDING',
        items: {
          create: orderItems,
        },
      },
      include: { items: true },
    });

    return res.status(201).json({
      success:        true,
      orderId:        order.id,
      razorpayOrderId: rzpOrder.id,
      amount:         grandTotal,       // in paise for Razorpay SDK
      currency:       'INR',
      keyId:          process.env.RAZORPAY_KEY_ID,
      prefill: {
        name:    req.retailer.shopName,
        contact: req.retailer.phone,
      },
    });

  } catch (err) {
    console.error('Create order error:', err);
    res.status(500).json({ error: 'Could not create order. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────
//  POST /api/orders/verify-payment
//  Body: { razorpayOrderId, razorpayPaymentId, razorpaySignature }
//  Called after successful Razorpay payment
// ─────────────────────────────────────────────────────
router.post('/verify-payment', async (req, res) => {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return res.status(400).json({ error: 'Payment details are incomplete' });
    }

    // ── Verify signature ──
    const isValid = verifySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
    if (!isValid) {
      return res.status(400).json({ error: 'Payment verification failed. Contact support.' });
    }

    // ── Update order in DB ──
    const order = await prisma.order.update({
      where: { razorpayOrderId },
      data: {
        razorpayPaymentId,
        razorpaySignature,
        status: 'CONFIRMED',
      },
    });

    return res.json({
      success:  true,
      orderId:  order.id,
      message:  'Payment confirmed. You will receive a GST invoice on your registered email.',
    });

  } catch (err) {
    console.error('Verify payment error:', err);
    res.status(500).json({ error: 'Payment verification error. Contact support.' });
  }
});

// ─────────────────────────────────────────────────────
//  GET /api/orders
//  Returns current retailer's orders
// ─────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      where:   { retailerId: req.retailer.id },
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    });

    // Convert paise → rupees
    const formatted = orders.map(o => ({
      ...o,
      subtotal:   o.subtotal / 100,
      gstAmount:  o.gstAmount / 100,
      grandTotal: o.grandTotal / 100,
      items: o.items.map(i => ({
        ...i,
        ratePerUnit: i.ratePerUnit / 100,
        totalAmount: i.totalAmount / 100,
      })),
    }));

    res.json({ orders: formatted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not fetch orders' });
  }
});

// GET /api/orders/:id
router.get('/:id', async (req, res) => {
  try {
    const order = await prisma.order.findFirst({
      where:   { id: req.params.id, retailerId: req.retailer.id },
      include: { items: true },
    });

    if (!order) return res.status(404).json({ error: 'Order not found' });

    res.json({
      order: {
        ...order,
        subtotal:   order.subtotal / 100,
        gstAmount:  order.gstAmount / 100,
        grandTotal: order.grandTotal / 100,
        items: order.items.map(i => ({
          ...i,
          ratePerUnit: i.ratePerUnit / 100,
          totalAmount: i.totalAmount / 100,
        })),
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch order' });
  }
});

module.exports = router;