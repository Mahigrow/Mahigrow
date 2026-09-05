const router   = require('express').Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const prisma   = require('../utils/prisma');
const { isValidEmail, isValidPhone, isValidGSTIN } = require('../utils/validators');
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
      email, phone, password,
      shopName, ownerName,
      gstNumber, district, pincode,
      state = 'Andhra Pradesh',
      gstVerified = false,
    } = req.body;

    // ── Validate all required fields ──
    const errors = {};
    if (!isValidEmail(email))         errors.email     = 'Valid email required';
    if (!isValidPhone(phone))         errors.phone     = 'Valid 10-digit mobile required';
    if (!password || password.length < 8) errors.password = 'Password must be at least 8 characters';
    if (password && password.length > 128) errors.password = 'Password too long';
    if (!clean(shopName))             errors.shopName  = 'Shop name required';
    if (!clean(ownerName))            errors.ownerName = 'Owner name required';
    if (!isValidGSTIN(gstNumber))    errors.gstNumber = 'Valid 15-character GSTIN required';
    if (!clean(district))             errors.district  = 'District required';
    if (!pincode || !/^\d{6}$/.test(pincode)) errors.pincode = 'Valid 6-digit pincode required';

    if (Object.keys(errors).length) {
      return res.status(400).json({ error: 'Validation failed', fields: errors });
    }

    // ── Check for duplicates ──
    const existing = await prisma.retailer.findFirst({
      where: {
        OR: [
          { email:     email.toLowerCase().trim() },
          { phone:     phone.trim() },
          { gstNumber: gstNumber.toUpperCase().trim() },
        ],
      },
      select: { email: true, phone: true, gstNumber: true },
    });

    if (existing) {
      if (existing.email === email.toLowerCase().trim())
        return res.status(409).json({ error: 'This email is already registered', field: 'email' });
      if (existing.phone === phone.trim())
        return res.status(409).json({ error: 'This phone number is already registered', field: 'phone' });
      if (existing.gstNumber === gstNumber.toUpperCase().trim())
        return res.status(409).json({ error: 'This GST number is already registered', field: 'gstNumber' });
    }

    // ── Hash password with bcrypt (cost 12) ──
    const passwordHash = await bcrypt.hash(password, 12);

    // ── Create retailer ──
    const retailer = await prisma.retailer.create({
      data: {
        email:        email.toLowerCase().trim(),
        phone:        phone.trim(),
        passwordHash,
        shopName:     clean(shopName, 200),
        ownerName:    clean(ownerName, 200),
        gstNumber:    gstNumber.toUpperCase().trim(),
        gstVerified:  Boolean(gstVerified),
        district:     clean(district, 100),
        pincode:      pincode.trim(),
        state:        clean(state, 100),
        isActive:     false,   // admin activates after verification
      },
      select: { id: true, email: true, shopName: true },
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

    // ── Basic input check ──
    if (!phone || !password) {
      return res.status(400).json({ error: 'Phone number and password are required' });
    }

    if (typeof phone !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Invalid input' });
    }

    // ── Find retailer ──
    const retailer = await prisma.retailer.findUnique({
      where: { phone: phone.trim() },
    });

    // Use constant-time comparison even when retailer not found
    // to prevent timing attacks that reveal valid phone numbers
    const dummyHash = '$2a$12$dummy.hash.to.prevent.timing.attacks.xxxxxxxxxxxxxx';
    const hashToCompare = retailer ? retailer.passwordHash : dummyHash;
    const passwordMatch = await bcrypt.compare(password, hashToCompare);

    if (!retailer || !passwordMatch) {
      // Same error for both wrong phone and wrong password
      // — prevents user enumeration
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
        email:    retailer.email,
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
      select: { id: true, phone: true },
    });

    // Always return 200 — don't reveal whether phone is registered
    if (!retailer) {
      return res.json({ success: true, message: 'If this number is registered, an OTP has been sent.' });
    }

    await createAndSendOTP(retailer.id, retailer.phone, 'RESET_PASSWORD');

    return res.json({
      success: true,
      message: 'OTP sent to your registered mobile number.',
    });

  } catch (err) {
    console.error('Forgot password error:', err.message);
    res.status(500).json({ error: 'Could not send OTP. Please try again.' });
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

    if (newPassword.length < 8)  return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (newPassword.length > 128) return res.status(400).json({ error: 'Password too long' });

    // Sanitize OTP — only digits allowed
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
      where:  { id: req.retailer.id },
      select: {
        id: true, email: true, phone: true,
        shopName: true, ownerName: true,
        gstNumber: true, district: true,
        state: true, pincode: true,
        isActive: true, createdAt: true,
      },
    });
    res.json({ retailer });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch profile' });
  }
});

module.exports = router;

// ─────────────────────────────────────────────────────────────
//  POST /api/auth/admin/login
//  Only works for phones listed in ADMIN_PHONES env var
// ─────────────────────────────────────────────────────────────
router.post('/admin/login', async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({ error: 'Phone and password are required' });
    }

    // Check if phone is in admin list
    const adminPhones = (process.env.ADMIN_PHONES || '')
      .split(',').map(p => p.trim()).filter(Boolean);

    if (!adminPhones.includes(phone.trim())) {
      // Log unauthorized attempt
      console.warn('[ADMIN] Unauthorized login attempt from phone:', phone.trim());
      // Return same error as wrong password — don't reveal admin phone list
      return res.status(403).json({ error: 'Incorrect phone or password, or you do not have admin access.' });
    }

    // Find retailer account
    const retailer = await prisma.retailer.findUnique({
      where: { phone: phone.trim() },
    });

    const dummyHash = '$2a$12$dummy.hash.to.prevent.timing.attacks.xxxxxxxxxxxxxx';
    const hashToCompare = retailer ? retailer.passwordHash : dummyHash;
    const passwordMatch = await bcrypt.compare(password, hashToCompare);

    if (!retailer || !passwordMatch) {
      return res.status(401).json({ error: 'Incorrect phone or password, or you do not have admin access.' });
    }

    // Sign admin token with extra claim
    const token = jwt.sign(
      { retailerId: retailer.id, isAdmin: true },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }  // shorter session for admin
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