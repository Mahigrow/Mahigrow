const router   = require('express').Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const prisma   = require('../utils/prisma');
const { isValidEmail, isValidPhone, isValidGSTIN } = require('../utils/validators');
const { createAndSendOTP, verifyOTP } = require('../services/otp');

// ── Helper: sign JWT ──────────────────────────────────
function signToken(retailerId) {
  return jwt.sign({ retailerId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '30d',
  });
}

// ─────────────────────────────────────────────────────
//  POST /api/auth/register
//  Body: { email, phone, password, shopName, ownerName,
//          gstNumber, district, pincode, state }
// ─────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const {
      email, phone, password,
      shopName, ownerName,
      gstNumber, district, pincode,
      state = 'Andhra Pradesh',
    } = req.body;

    // ── Validate required fields ──
    const errors = {};
    if (!isValidEmail(email))        errors.email     = 'Valid email is required';
    if (!isValidPhone(phone))        errors.phone     = 'Valid 10-digit mobile number required';
    if (!password || password.length < 8) errors.password = 'Password must be at least 8 characters';
    if (!shopName?.trim())           errors.shopName  = 'Shop name is required';
    if (!ownerName?.trim())          errors.ownerName = 'Owner name is required';
    if (!isValidGSTIN(gstNumber))   errors.gstNumber = 'Valid 15-character GSTIN required';
    if (!district?.trim())           errors.district  = 'District is required';
    if (!pincode || pincode.length !== 6) errors.pincode = 'Valid 6-digit pincode required';

    if (Object.keys(errors).length) {
      return res.status(400).json({ error: 'Validation failed', fields: errors });
    }

    // ── Check duplicates ──
    const existing = await prisma.retailer.findFirst({
      where: {
        OR: [
          { email:     email.toLowerCase() },
          { phone:     phone.replace(/\s/g, '') },
          { gstNumber: gstNumber.toUpperCase() },
        ],
      },
      select: { email: true, phone: true, gstNumber: true },
    });

    if (existing) {
      if (existing.email === email.toLowerCase())
        return res.status(409).json({ error: 'This email is already registered', field: 'email' });
      if (existing.phone === phone.replace(/\s/g, ''))
        return res.status(409).json({ error: 'This phone number is already registered', field: 'phone' });
      if (existing.gstNumber === gstNumber.toUpperCase())
        return res.status(409).json({ error: 'This GST number is already registered', field: 'gstNumber' });
    }

    // ── Hash password ──
    const passwordHash = await bcrypt.hash(password, 12);

    // ── Create retailer ──
    const retailer = await prisma.retailer.create({
      data: {
        email:        email.toLowerCase(),
        phone:        phone.replace(/\s/g, ''),
        passwordHash,
        shopName:     shopName.trim(),
        ownerName:    ownerName.trim(),
        gstNumber:    gstNumber.toUpperCase(),
        gstVerified:  req.body.gstVerified || false,
        district:     district.trim(),
        pincode:      pincode.trim(),
        state:        state.trim(),
        isActive:     false, // admin activates after verification
      },
      select: { id: true, email: true, phone: true, shopName: true },
    });

    // ── Return success (no token yet — account needs activation) ──
    return res.status(201).json({
      success:  true,
      message:  'Account created. Our team will call you within 1 business day to activate it.',
      retailer: { id: retailer.id, email: retailer.email, shopName: retailer.shopName },
    });

  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────
//  POST /api/auth/login
//  Body: { phone, password }
// ─────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({ error: 'Phone number and password are required' });
    }

    // ── Find retailer ──
    const retailer = await prisma.retailer.findUnique({
      where: { phone: phone.replace(/\s/g, '') },
    });

    if (!retailer) {
      return res.status(401).json({ error: 'No account found with this phone number' });
    }

    // ── Check password ──
    const passwordMatch = await bcrypt.compare(password, retailer.passwordHash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    // ── Check if account is activated ──
    if (!retailer.isActive) {
      return res.status(403).json({
        error:  'Account not yet activated',
        detail: 'Our team will call you within 1 business day to verify and activate your account.',
      });
    }

    // ── Sign JWT ──
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
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────
//  POST /api/auth/forgot-password
//  Body: { phone }
//  Sends OTP to registered phone
// ─────────────────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const { phone } = req.body;

    if (!isValidPhone(phone)) {
      return res.status(400).json({ error: 'Enter a valid 10-digit mobile number' });
    }

    const retailer = await prisma.retailer.findUnique({
      where:  { phone: phone.replace(/\s/g, '') },
      select: { id: true, phone: true },
    });

    // Always return 200 — don't leak whether phone is registered
    if (!retailer) {
      return res.json({ success: true, message: 'If this number is registered, an OTP has been sent.' });
    }

    await createAndSendOTP(retailer.id, retailer.phone, 'RESET_PASSWORD');

    return res.json({
      success: true,
      message: 'OTP sent to your registered mobile number.',
    });

  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Could not send OTP. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────
//  POST /api/auth/reset-password
//  Body: { phone, otp, newPassword }
// ─────────────────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { phone, otp, newPassword } = req.body;

    if (!phone || !otp || !newPassword) {
      return res.status(400).json({ error: 'Phone, OTP and new password are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const retailer = await prisma.retailer.findUnique({
      where:  { phone: phone.replace(/\s/g, '') },
      select: { id: true },
    });

    if (!retailer) {
      return res.status(404).json({ error: 'No account found with this phone number' });
    }

    // ── Verify OTP ──
    const result = await verifyOTP(retailer.id, otp, 'RESET_PASSWORD');
    if (!result.valid) {
      return res.status(400).json({ error: result.reason });
    }

    // ── Update password ──
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.retailer.update({
      where: { id: retailer.id },
      data:  { passwordHash },
    });

    return res.json({ success: true, message: 'Password updated successfully. Please sign in.' });

  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Could not reset password. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────
//  GET /api/auth/me
//  Returns current retailer profile (requires token)
// ─────────────────────────────────────────────────────
const { requireAuth } = require('../middleware/auth');

router.get('/me', requireAuth, async (req, res) => {
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
});

module.exports = router;