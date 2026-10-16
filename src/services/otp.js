// ─────────────────────────────────────────────────────────────
//  services/otp.js
//  OTP via Email (Resend) → SMS fallback (Fast2SMS) → console
// ─────────────────────────────────────────────────────────────
const axios  = require('axios');
const prisma = require('../utils/prisma');

const OTP_EXPIRY_MINUTES = 10;
const OTP_MAX_ATTEMPTS   = 3;

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ─────────────────────────────────────────────────────────────
//  SEND VIA RESEND (free — 3000 emails/month)
//  Sign up: resend.com → get API key → add domain
// ─────────────────────────────────────────────────────────────
async function sendEmail(email, phone, otp, purpose) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY not configured');

  const fromEmail  = process.env.RESEND_FROM_EMAIL || 'noreply@mahigrow.com';
  const subject    = purpose === 'RESET_PASSWORD'
    ? 'MahiGrow — Password Reset OTP'
    : 'MahiGrow — Verify your account';

  const html = `
    <!DOCTYPE html>
    <html>
    <body style="font-family:Inter,Arial,sans-serif;background:#f5f5f5;margin:0;padding:20px;">
      <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
        
        <!-- Header -->
        <div style="background:#0a7a30;padding:24px;text-align:center;">
          <h1 style="color:#fff;margin:0;font-size:1.4rem;font-weight:800;letter-spacing:-.02em;">
            Mahi<span style="color:#69f0ae;">Grow</span>
          </h1>
          <p style="color:rgba(255,255,255,.7);margin:4px 0 0;font-size:.82rem;">
            Bulk Agri Inputs Portal
          </p>
        </div>

        <!-- Body -->
        <div style="padding:28px 24px;">
          <p style="color:#212121;font-size:.92rem;margin:0 0 8px;">Hello,</p>
          <p style="color:#424242;font-size:.85rem;line-height:1.6;margin:0 0 24px;">
            ${purpose === 'RESET_PASSWORD'
              ? 'We received a request to reset your MahiGrow account password. Use the OTP below:'
              : 'Use the OTP below to verify your MahiGrow account:'}
          </p>

          <!-- OTP Box -->
          <div style="background:#f5f5f5;border:2px dashed #0a7a30;border-radius:10px;padding:20px;text-align:center;margin:0 0 24px;">
            <div style="font-size:2.4rem;font-weight:800;letter-spacing:.3em;color:#0a7a30;font-family:monospace;">
              ${otp}
            </div>
            <p style="color:#9e9e9e;font-size:.72rem;margin:8px 0 0;">
              Valid for <strong>10 minutes</strong> · Do not share this OTP
            </p>
          </div>

          <p style="color:#424242;font-size:.82rem;line-height:1.6;margin:0 0 8px;">
            If you did not request this, please ignore this email. Your account is safe.
          </p>
          <p style="color:#9e9e9e;font-size:.76rem;margin:0;">
            Phone: +91 ${phone}
          </p>
        </div>

        <!-- Footer -->
        <div style="background:#f5f5f5;padding:16px 24px;text-align:center;border-top:1px solid #e0e0e0;">
          <p style="color:#9e9e9e;font-size:.68rem;margin:0;">
            © 2026 MahaGoAgro · MahiGrow · mahigrow.com
          </p>
        </div>

      </div>
    </body>
    </html>`;

  const res = await axios.post(
    'https://api.resend.com/emails',
    {
      from:    fromEmail,
      to:      [email],
      subject,
      html,
    },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
    }
  );

  if (res.data?.id) {
    console.log(`[OTP] Email sent to ${email} — ID: ${res.data.id}`);
    return true;
  }
  throw new Error('Email send failed: ' + JSON.stringify(res.data));
}

// ─────────────────────────────────────────────────────────────
//  FALLBACK: FAST2SMS (SMS)
// ─────────────────────────────────────────────────────────────
async function sendSMS(phone, otp) {
  const apiKey = process.env.FAST2SMS_API_KEY;
  if (!apiKey) throw new Error('FAST2SMS_API_KEY not configured');

  const res = await axios.post(
    'https://www.fast2sms.com/dev/bulkV2',
    null,
    {
      params: {
        authorization:    apiKey,
        variables_values: otp,
        route:            'otp',
        numbers:          phone,
      },
      headers: { 'cache-control': 'no-cache' },
    }
  );

  if (res.data?.return === true) {
    console.log(`[OTP] SMS sent to +91${phone}`);
    return true;
  }
  throw new Error('SMS failed: ' + JSON.stringify(res.data));
}

// ─────────────────────────────────────────────────────────────
//  CREATE + SEND OTP
//  Flow: Email → SMS fallback → console (dev only)
// ─────────────────────────────────────────────────────────────
async function createAndSendOTP(retailerId, phone, purpose = 'VERIFY_PHONE') {
  const otp       = generateOTP();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  // Invalidate previous OTPs
  await prisma.oTP.updateMany({
    where: { retailerId, purpose, used: false },
    data:  { used: true },
  });

  // Save new OTP
  await prisma.oTP.create({
    data: { retailerId, otp, purpose, expiresAt, attempts: 0, used: false },
  });

  // Get retailer email
  const retailer = await prisma.retailer.findUnique({
    where:  { id: retailerId },
    select: { email: true, phone: true },
  });

  let channel = 'unknown';

  // Try email first
  if (retailer?.email) {
    try {
      await sendEmail(retailer.email, phone, otp, purpose);
      channel = 'email';
      return { success: true, channel, sentTo: retailer.email };
    } catch (emailErr) {
      console.warn('[OTP] Email failed:', emailErr.message, '— trying SMS');
    }
  }

  // Fallback to SMS
  try {
    await sendSMS(phone, otp);
    channel = 'sms';
    return { success: true, channel, sentTo: phone };
  } catch (smsErr) {
    console.warn('[OTP] SMS failed:', smsErr.message);
  }

  // Dev fallback — log to console
  if (process.env.NODE_ENV !== 'production') {
    console.log(`\n🔐 DEV OTP for +91${phone}: ${otp}\n`);
    return { success: true, channel: 'console', sentTo: 'console' };
  }

  throw new Error('Could not send OTP via email or SMS. Please try again.');
}

// ─────────────────────────────────────────────────────────────
//  VERIFY OTP
// ─────────────────────────────────────────────────────────────
async function verifyOTP(retailerId, inputOtp, purpose = 'VERIFY_PHONE') {
  const record = await prisma.oTP.findFirst({
    where: {
      retailerId,
      purpose,
      used:      false,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!record) {
    return { valid: false, reason: 'OTP expired or not found. Please request a new one.' };
  }

  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    await prisma.oTP.update({ where: { id: record.id }, data: { used: true } });
    return { valid: false, reason: 'Too many attempts. Please request a new OTP.' };
  }

  await prisma.oTP.update({
    where: { id: record.id },
    data:  { attempts: { increment: 1 } },
  });

  if (record.otp !== inputOtp.trim()) {
    const left = OTP_MAX_ATTEMPTS - (record.attempts + 1);
    return {
      valid:  false,
      reason: left > 0
        ? `Incorrect OTP. ${left} attempt(s) remaining.`
        : 'Too many attempts. Please request a new OTP.',
    };
  }

  await prisma.oTP.update({ where: { id: record.id }, data: { used: true } });
  return { valid: true };
}

module.exports = { createAndSendOTP, verifyOTP, generateOTP };