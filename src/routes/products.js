const router = require('express').Router();
const prisma = require('../utils/prisma');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// ── HELPERS ──────────────────────────────────────────────────────
// Variants stored in paise, returned in rupees
function formatVariants(variants) {
  if (!variants || !Array.isArray(variants)) return null;
  return variants.map(v => ({
    size: v.size,
    mrp:  v.mrp / 100,
    tiers: (v.tiers || []).map(([min, max, price]) => [min, max, price / 100]),
  }));
}

function storeVariants(variants) {
  if (!variants || !Array.isArray(variants)) return undefined;
  return variants.map(v => ({
    size: v.size,
    mrp:  Math.round(v.mrp * 100),
    tiers: (v.tiers || []).map(([min, max, price]) => [
      parseInt(min),
      max === null || max === '' ? null : parseInt(max),
      Math.round(price * 100),
    ]),
  }));
}

// GET /api/products
// Query: ?category=seeds&inStock=true
router.get('/', async (req, res) => {
  try {
    const { category, inStock } = req.query;

    const where = { isActive: true };
    if (category) where.category = category;
    if (inStock === 'true') where.inStock = true;

    const products = await prisma.product.findMany({
      where,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      select: {
        id: true, name: true, brand: true, category: true,
        size: true, mrp: true, cert: true, unit: true,
        moq: true, step: true, inStock: true, stockQty: true,
        tiers: true, variants: true, imageUrl: true,
      },
    });

    // Convert paise → rupees for the frontend
    const formatted = products.map(p => ({
      ...p,
      mrp:      p.mrp / 100,
      tiers:    p.tiers.map(([min, max, price]) => [min, max, price / 100]),
      variants: formatVariants(p.variants),
      imageUrl: p.imageUrl || null,
    }));

    // Compute category counts and unique brands for frontend
    const categoryCounts = {};
    const brandSet = new Set();
    formatted.forEach(p => {
      categoryCounts[p.category] = (categoryCounts[p.category] || 0) + 1;
      if (p.brand) brandSet.add(p.brand);
    });

    res.json({
      products: formatted,
      meta: {
        total:          formatted.length,
        categoryCounts,
        brands:         [...brandSet].sort(),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not fetch products' });
  }
});

// GET /api/products/:id
router.get('/:id', async (req, res) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
    });

    if (!product) return res.status(404).json({ error: 'Product not found' });

    res.json({
      product: {
        ...product,
        mrp:      product.mrp / 100,
        tiers:    product.tiers.map(([min, max, price]) => [min, max, price / 100]),
        variants: formatVariants(product.variants),
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch product' });
  }
});

// ─────────────────────────────────────────────────────
//  POST /api/products
//  Admin: create a new product
//  Body: { name, brand, category, size, cert, mrp,
//          unit, moq, step, stockQty, inStock, tiers,
//          variants: [{size, mrp, tiers}] }
//  Prices sent in rupees, stored in paise
// ─────────────────────────────────────────────────────
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const {
      name, brand, category, size, cert,
      description = '',
      mrp, unit, moq, step,
      stockQty = 0, inStock = true,
      tiers, variants, imageUrl = null,
    } = req.body;

    // Basic validation
    if (!name || !brand || !category || !mrp || !moq || !tiers?.length) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const product = await prisma.product.create({
      data: {
        name:        name.trim(),
        brand:       brand.trim(),
        category,
        size:        size?.trim() || '',
        cert:        cert || 'CIB',
        description: description.trim(),
        mrp:         Math.round(mrp * 100),       // rupees → paise
        unit:        unit || 'unit',
        moq:         parseInt(moq),
        step:        parseInt(step) || parseInt(moq),
        stockQty:    parseInt(stockQty) || 0,
        inStock:     Boolean(inStock),
        isActive:    true,
        imageUrl:    imageUrl || null,
        tiers:       tiers.map(([min, max, price]) => [
          parseInt(min),
          max === null || max === '' ? null : parseInt(max),
          Math.round(price * 100),               // rupees → paise
        ]),
        ...(variants?.length && { variants: storeVariants(variants) }),
      },
    });

    res.status(201).json({
      success: true,
      product: {
        ...product,
        mrp:      product.mrp / 100,
        tiers:    product.tiers.map(([min, max, price]) => [min, max, price / 100]),
        variants: formatVariants(product.variants),
      },
    });
  } catch (err) {
    console.error('Create product error:', err);
    res.status(500).json({ error: 'Could not create product' });
  }
});

// ─────────────────────────────────────────────────────
//  PUT /api/products/:id
//  Admin: update an existing product
// ─────────────────────────────────────────────────────
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name, brand, category, size, cert,
      description = '',
      mrp, unit, moq, step,
      stockQty, inStock, tiers, variants, isActive, imageUrl,
    } = req.body;

    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Product not found' });

    const updated = await prisma.product.update({
      where: { id },
      data: {
        ...(name        && { name: name.trim() }),
        ...(brand       && { brand: brand.trim() }),
        ...(category    && { category }),
        ...(size        && { size: size.trim() }),
        ...(cert        && { cert }),
        ...(description !== undefined && { description: description.trim() }),
        ...(mrp !== undefined && { mrp: Math.round(mrp * 100) }),
        ...(unit        && { unit }),
        ...(moq         && { moq: parseInt(moq) }),
        ...(step        && { step: parseInt(step) }),
        ...(stockQty !== undefined && { stockQty: parseInt(stockQty) }),
        ...(inStock  !== undefined && { inStock: Boolean(inStock) }),
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
        ...(imageUrl !== undefined && { imageUrl: imageUrl || null }),
        ...(tiers?.length && {
          tiers: tiers.map(([min, max, price]) => [
            parseInt(min),
            max === null || max === '' ? null : parseInt(max),
            Math.round(price * 100),
          ]),
        }),
        // Allow clearing variants by passing empty array
        ...(variants !== undefined && {
          variants: variants?.length ? storeVariants(variants) : null,
        }),
      },
    });

    res.json({
      success: true,
      product: {
        ...updated,
        mrp:      updated.mrp / 100,
        tiers:    updated.tiers.map(([min, max, price]) => [min, max, price / 100]),
        variants: formatVariants(updated.variants),
      },
    });
  } catch (err) {
    console.error('Update product error:', err);
    res.status(500).json({ error: 'Could not update product' });
  }
});

// ─────────────────────────────────────────────────────
//  DELETE /api/products/:id
//  Admin: delete a product (soft delete — sets isActive false)
//  Use ?hard=true to permanently delete
// ─────────────────────────────────────────────────────
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id }   = req.params;
    const hardDelete = req.query.hard === 'true';

    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Product not found' });

    if (hardDelete) {
      await prisma.product.delete({ where: { id } });
    } else {
      // Soft delete — hide from catalogue but keep order history intact
      await prisma.product.update({
        where: { id },
        data:  { isActive: false },
      });
    }

    res.json({ success: true, message: 'Product removed from catalogue' });
  } catch (err) {
    console.error('Delete product error:', err);
    res.status(500).json({ error: 'Could not delete product' });
  }
});

module.exports = router;