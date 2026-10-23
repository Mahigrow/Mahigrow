'use strict';
const { Resend }  = require('resend');
const axios       = require('axios');
const prisma      = require('../utils/prisma');

function gen6() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ── Send via Resend email ─────────────────────
async function sendEmail(to, otp, purpose) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const labels = { VERIFY_PHONE: 'Verify your account', RESET_PASSWORD: 'Reset your password' };
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'noreply@mahigrow.com',
    to,
    subject: `MahiGrow — ${labels[purpose] || 'OTP'}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#0a7a30">MahiGrow</h2>
        <p>${labels[purpose] || 'Your OTP'}</p>
        <div style="font-size:36px;font-weight:700;letter-spacing:8px;color:#111;margin:24px 0">${otp}</div>
        <p style="color:#666;font-size:13px">Valid for 10 minutes. Do not share this code.</p>
      </div>`,
  });
}

// ── Send via Fast2SMS ─────────────────────────
async function sendSMS(phone, otp) {
  await axios.get('https://www.fast2sms.com/dev/bulkV2', {
    params: {
      authorization: process.env.FAST2SMS_API_KEY,
      variables_values: otp,
      route: 'otp',
      numbers: phone,
    },
  });
}

// ── Main: generate + save + send ─────────────
async function sendOTP(retailerId, destination, purpose) {
  const otp = gen6();

  // Save to DB — field name is 'code' (matches schema)
  await prisma.oTP.create({
    data: {
      retailerId,
      code: otp,
      purpose,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      attempts: 0,
      used: false,
    },
  });

  // Determine if destination is email or phone
  const isEmail = destination.includes('@');

  if (isEmail) {
    try {
      await sendEmail(destination, otp, purpose);
      return { sent: true, via: 'email', destination };
    } catch (e) {
      console.error('Resend email failed:', e.message);
    }
  }

  // Try SMS fallback
  try {
    await sendSMS(isEmail ? null : destination, otp);
    return { sent: true, via: 'sms', destination };
  } catch (e) {
    console.error('Fast2SMS failed:', e.message);
  }

  // Dev fallback
  console.log(`[DEV OTP] ${destination} → ${otp} (${purpose})`);
  return { sent: true, via: 'console', destination };
}

// ── Verify OTP ────────────────────────────────
async function verifyOTP(retailerId, code, purpose) {
  // Check for any non-expired record first (to give right error message)
  const anyRecord = await prisma.oTP.findFirst({
    where: { retailerId, purpose, used: false },
    orderBy: { createdAt: 'desc' },
  });

  if (!anyRecord) {
    return { valid: false, reason: 'No OTP found. Please request a new one.' };
  }

  if (anyRecord.expiresAt < new Date()) {
    return { valid: false, reason: 'OTP has expired. Please request a new one.' };
  }

  if (anyRecord.code !== code) {
    // Increment attempts
    await prisma.oTP.update({
      where: { id: anyRecord.id },
      data:  { attempts: { increment: 1 } },
    });
    return { valid: false, reason: 'Incorrect OTP. Please try again.' };
  }

  // Valid — mark as used
  await prisma.oTP.update({
    where: { id: anyRecord.id },
    data:  { used: true },
  });
  return { valid: true };
}

module.exports = { createAndSendOTP: sendOTP, verifyOTP };