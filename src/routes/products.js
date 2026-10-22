'use strict';
const router = require('express').Router();
const prisma = require('../utils/prisma');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// ── GET /api/products ─────────────────────────
router.get('/', async (req, res) => {
  try {
    const { category, brand, search, page = 1, limit = 100 } = req.query;
    const where = {};
    if (category) where.category = category;
    if (brand)    where.brand    = brand;
    if (search)   where.name     = { contains: search, mode: 'insensitive' };

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.product.count({ where }),
    ]);

    // Build category counts and brand list for frontend dynamic nav
    const allProducts = await prisma.product.findMany({
      select: { category: true, brand: true },
    });

    const categoryCounts = {};
    const brandsSet = new Set();
    allProducts.forEach(p => {
      categoryCounts[p.category] = (categoryCounts[p.category] || 0) + 1;
      if (p.brand) brandsSet.add(p.brand);
    });

    res.json({
      products,
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        categoryCounts,
        brands: [...brandsSet].sort(),
      },
    });
  } catch (err) {
    console.error('Get products error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/products/:id ─────────────────────
router.get('/:id', async (req, res) => {
  try {
    const product = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json({ product });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/products — Create (admin) ───────
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const {
      name, category, brand, size, unit,
      mrp, tiers, moq, step, cert, inStock, stockQty, imageUrl,
    } = req.body;

    if (!name || !category || !tiers)
      return res.status(400).json({ error: 'name, category, tiers required' });

    const product = await prisma.product.create({
      data: {
        name, category, brand: brand || '',
        size: size || '', unit: unit || 'bag',
        mrp: Number(mrp) || 0,
        tiers: tiers,           // JSON array [[minQty, maxQty, price], ...]
        basePrice: tiers[0][2], // first tier price
        moq: Number(moq) || 1,
        step: Number(step) || 1,
        cert: cert || 'ISI',
        inStock: inStock !== false,
        stockQty: Number(stockQty) || 0,
        imageUrl: imageUrl || null,
      },
    });

    res.status(201).json({ product });
  } catch (err) {
    console.error('Create product error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PATCH /api/products/:id — Update (admin) ──
router.patch('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const data = { ...req.body };
    if (data.mrp)  data.mrp = Number(data.mrp);
    if (data.moq)  data.moq = Number(data.moq);
    if (data.step) data.step = Number(data.step);
    if (data.tiers && data.tiers[0]) data.basePrice = data.tiers[0][2];

    const product = await prisma.product.update({
      where: { id: req.params.id },
      data,
    });
    res.json({ product });
  } catch (err) {
    console.error('Update product error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── DELETE /api/products/:id (admin) ─────────
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await prisma.product.delete({ where: { id: req.params.id } });
    res.json({ message: 'Product deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;