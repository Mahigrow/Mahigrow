'use strict';
const router   = require('express').Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const prisma   = require('../utils/prisma');
const { isValidPhone, isValidGSTIN } = require('../utils/validators');
const { createAndSendOTP, verifyOTP } = require('../services/otp');
const { requireAuth } = require('../middleware/auth');

// ── sign JWT ──────────────────────────────────────────────────
function signToken(retailerId) {
  return jwt.sign(
    { retailerId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
  );
}

// ── sanitize string input ─────────────────────────────────────
function clean(str, max = 200) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>"'`]/g, '').trim().slice(0, max);
}

// ─────────────────────────────────────────────────────────────
//  POST /api/auth/register
// ─────────────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const {
      phone, password,
      shopName, ownerName,
      gstin,       // schema field name
      district = '', pincode = '',
      state = '',
      email,       // optional
      gstVerified = false,
    } = req.body;

    const errors = {};
    if (!isValidPhone(phone))          errors.phone     = 'Valid 10-digit mobile required';
    if (!password || password.length < 8) errors.password = 'Password must be at least 8 characters';
    if (password && password.length > 128) errors.password = 'Password too long';
    if (!clean(shopName))              errors.shopName  = 'Shop name required';
    if (!clean(ownerName))             errors.ownerName = 'Owner name required';
    if (!isValidGSTIN(gstin))          errors.gstin     = 'Valid 15-character GSTIN required';

    if (Object.keys(errors).length) {
      return res.status(400).json({ error: 'Validation failed', fields: errors });
    }

    // ── Check for duplicates ──
    const orClause = [
      { phone: phone.trim() },
      { gstin: gstin.toUpperCase().trim() },
    ];
    if (email) orClause.push({ email: email.toLowerCase().trim() });

    const existing = await prisma.retailer.findFirst({
      where: { OR: orClause },
      select: { phone: true, gstin: true, email: true },
    });

    if (existing) {
      if (existing.phone === phone.trim())
        return res.status(409).json({ error: 'This phone number is already registered', field: 'phone' });
      if (existing.gstin === gstin.toUpperCase().trim())
        return res.status(409).json({ error: 'This GSTIN is already registered', field: 'gstin' });
      if (email && existing.email === email.toLowerCase().trim())
        return res.status(409).json({ error: 'This email is already registered', field: 'email' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const retailer = await prisma.retailer.create({
      data: {
        phone:        phone.trim(),
        passwordHash,
        shopName:     clean(shopName, 200),
        ownerName:    clean(ownerName, 200),
        gstin:        gstin.toUpperCase().trim(),
        gstVerified:  Boolean(gstVerified),
        district:     clean(district, 100),
        pincode:      pincode ? pincode.trim() : '',
        state:        clean(state, 100),
        email:        email ? email.toLowerCase().trim() : null,
        isActive:     false,
      },
      select: { id: true, phone: true, shopName: true },
    });

    return res.status(201).json({
      success: true,
      message: 'Account created. Our team will call you within 1 business day to activate it.',
      retailer,
    });

  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /api/auth/login
// ─────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({ error: 'Phone number and password are required' });
    }
    if (typeof phone !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Invalid input' });
    }

    const retailer = await prisma.retailer.findUnique({
      where: { phone: phone.trim() },
    });

    const dummyHash = '$2a$12$dummy.hash.to.prevent.timing.attacks.xxxxxxxxxxxxxx';
    const hashToCompare = retailer ? retailer.passwordHash : dummyHash;
    const passwordMatch = await bcrypt.compare(password, hashToCompare);

    if (!retailer || !passwordMatch) {
      return res.status(401).json({ error: 'Incorrect phone number or password' });
    }

    if (!retailer.isActive) {
      return res.status(403).json({
        error:  'Account not yet activated',
        detail: 'Our team will call you within 1 business day.',
      });
    }

    const token = signToken(retailer.id);

    return res.json({
      success: true,
      token,
      retailer: {
        id:       retailer.id,
        phone:    retailer.phone,
        shopName: retailer.shopName,
      },
    });

  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /api/auth/forgot-password
// ─────────────────────────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const { phone } = req.body;

    if (!isValidPhone(phone)) {
      return res.status(400).json({ error: 'Enter a valid 10-digit mobile number' });
    }

    const retailer = await prisma.retailer.findUnique({
      where:  { phone: phone.trim() },
      select: { id: true, phone: true, email: true },
    });

    // Always return 200 — don't reveal whether phone is registered
    if (!retailer) {
      return res.json({ success: true, via: 'email', destination: 'your registered email' });
    }

    if (!retailer.email) {
      return res.status(400).json({ error: 'No email address on file. Please contact support.' });
    }

    const result = await createAndSendOTP(retailer.id, retailer.email, 'RESET_PASSWORD');

    return res.json({
      success:     true,
      via:         result.via || 'email',
      destination: result.destination || retailer.email,
    });

  } catch (err) {
    console.error('Forgot password error:', err.message);
    res.status(500).json({ error: 'Could not send OTP. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /api/auth/verify-otp
// ─────────────────────────────────────────────────────────────
router.post('/verify-otp', async (req, res) => {
  try {
    const { phone, otp, purpose } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({ error: 'Phone and OTP are required' });
    }

    const retailer = await prisma.retailer.findUnique({
      where:  { phone: phone.trim() },
      select: { id: true },
    });

    if (!retailer) {
      return res.status(404).json({ error: 'No account found with this phone number' });
    }

    const cleanOTP = String(otp).replace(/\D/g, '').slice(0, 6);
    const result = await verifyOTP(retailer.id, cleanOTP, purpose || 'RESET_PASSWORD');

    if (!result.valid) {
      return res.status(400).json({ error: result.reason });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('Verify OTP error:', err.message);
    res.status(500).json({ error: 'Could not verify OTP. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /api/auth/reset-password
// ─────────────────────────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { phone, otp, newPassword } = req.body;

    if (!phone || !otp || !newPassword) {
      return res.status(400).json({ error: 'Phone, OTP and new password are required' });
    }

    if (newPassword.length < 8)   return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (newPassword.length > 128) return res.status(400).json({ error: 'Password too long' });

    const cleanOTP = String(otp).replace(/\D/g, '').slice(0, 6);
    if (cleanOTP.length !== 6) {
      return res.status(400).json({ error: 'OTP must be 6 digits' });
    }

    const retailer = await prisma.retailer.findUnique({
      where:  { phone: phone.trim() },
      select: { id: true },
    });

    if (!retailer) {
      return res.status(404).json({ error: 'No account found with this phone number' });
    }

    const result = await verifyOTP(retailer.id, cleanOTP, 'RESET_PASSWORD');
    if (!result.valid) {
      return res.status(400).json({ error: result.reason });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.retailer.update({
      where: { id: retailer.id },
      data:  { passwordHash },
    });

    return res.json({ success: true, message: 'Password updated. Please sign in.' });

  } catch (err) {
    console.error('Reset password error:', err.message);
    res.status(500).json({ error: 'Could not reset password. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /api/auth/me
// ─────────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  try {
    const retailer = await prisma.retailer.findUnique({
      where:  { id: req.retailer.retailerId },
      select: {
        id: true, phone: true, email: true,
        shopName: true, ownerName: true,
        gstin: true, district: true,
        state: true, pincode: true,
        isActive: true, createdAt: true,
      },
    });
    res.json({ retailer });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch profile' });
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /api/auth/admin/login
// ─────────────────────────────────────────────────────────────
router.post('/admin/login', async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({ error: 'Phone and password are required' });
    }

    const adminPhones = (process.env.ADMIN_PHONES || '')
      .split(',').map(p => p.trim()).filter(Boolean);

    if (!adminPhones.includes(phone.trim())) {
      console.warn('[ADMIN] Unauthorized login attempt from phone:', phone.trim());
      return res.status(403).json({ error: 'Incorrect phone or password, or you do not have admin access.' });
    }

    const retailer = await prisma.retailer.findUnique({
      where: { phone: phone.trim() },
    });

    const dummyHash = '$2a$12$dummy.hash.to.prevent.timing.attacks.xxxxxxxxxxxxxx';
    const hashToCompare = retailer ? retailer.passwordHash : dummyHash;
    const passwordMatch = await bcrypt.compare(password, hashToCompare);

    if (!retailer || !passwordMatch) {
      return res.status(401).json({ error: 'Incorrect phone or password, or you do not have admin access.' });
    }

    // Admin token includes retailerId + isAdmin flag
    const token = jwt.sign(
      { retailerId: retailer.id, isAdmin: true },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    console.log('[ADMIN] Login:', phone.trim(), new Date().toISOString());

    return res.json({
      success: true,
      token,
      admin: {
        id:       retailer.id,
        phone:    retailer.phone,
        shopName: retailer.shopName,
      },
    });

  } catch (err) {
    console.error('Admin login error:', err.message);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /api/auth/admin/retailers
// ─────────────────────────────────────────────────────────────
router.get('/admin/retailers', requireAuth, async (req, res) => {
  try {
    if (!req.retailer?.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const retailers = await prisma.retailer.findMany({
      select: {
        id: true, phone: true, email: true,
        shopName: true, ownerName: true,
        gstin: true, gstVerified: true,
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

// ─────────────────────────────────────────────────────────────
//  PATCH /api/auth/admin/retailers/:id
// ─────────────────────────────────────────────────────────────
router.patch('/admin/retailers/:id', requireAuth, async (req, res) => {
  try {
    if (!req.retailer?.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { isActive } = req.body;
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive must be true or false' });
    }

    const retailer = await prisma.retailer.update({
      where:  { id: req.params.id },
      data:   { isActive },
      select: { id: true, phone: true, shopName: true, isActive: true },
    });

    res.json({ success: true, retailer });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Retailer not found' });
    console.error('Update retailer error:', err.message);
    res.status(500).json({ error: 'Could not update retailer' });
  }
});

module.exports = router;