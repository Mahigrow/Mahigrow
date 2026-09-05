// ─────────────────────────────────────────────────────────────
//  services/otp.js
//  OTP generation, sending (WhatsApp first, SMS fallback),
//  verification and expiry management
// ─────────────────────────────────────────────────────────────
const axios  = require('axios');
const prisma = require('../utils/prisma');

// ── CONFIG ───────────────────────────────────────────────────
const OTP_EXPIRY_MINUTES = 10;
const OTP_MAX_ATTEMPTS   = 3;

// ── GENERATE 6-DIGIT OTP ─────────────────────────────────────
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ─────────────────────────────────────────────────────────────
//  SEND VIA META WHATSAPP CLOUD API (Free — 1000/month)
// ─────────────────────────────────────────────────────────────
async function sendWhatsApp(phone, otp) {
  const token         = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const templateName  = process.env.WHATSAPP_TEMPLATE_NAME || 'mahigrow_otp';

  if (!token || !phoneNumberId) {
    throw new Error('WhatsApp credentials not configured');
  }

  const response = await axios.post(
    `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      to:                '91' + phone,   // India country code
      type:              'template',
      template: {
        name:     templateName,
        language: { code: 'en' },
        components: [
          {
            type:       'body',
            parameters: [{ type: 'text', text: otp }],
          },
          {
            // Optional: button to copy OTP automatically
            type:    'button',
            sub_type: 'url',
            index:   '0',
            parameters: [{ type: 'text', text: otp }],
          },
        ],
      },
    },
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
      },
    }
  );

  if (response.data?.messages?.[0]?.id) {
    console.log(`[OTP] WhatsApp sent to +91${phone} — MsgId: ${response.data.messages[0].id}`);
    return true;
  }
  throw new Error('WhatsApp send failed: ' + JSON.stringify(response.data));
}

// ─────────────────────────────────────────────────────────────
//  FALLBACK: SEND VIA FAST2SMS (SMS)
// ─────────────────────────────────────────────────────────────
async function sendSMS(phone, otp) {
  const apiKey = process.env.FAST2SMS_API_KEY;

  if (!apiKey) {
    throw new Error('Fast2SMS API key not configured');
  }

  const response = await axios.post(
    'https://www.fast2sms.com/dev/bulkV2',
    null,
    {
      params: {
        authorization: apiKey,
        variables_values: otp,
        route:  'otp',
        numbers: phone,
      },
      headers: { 'cache-control': 'no-cache' },
    }
  );

  if (response.data?.return === true) {
    console.log(`[OTP] SMS sent to +91${phone}`);
    return true;
  }
  throw new Error('SMS send failed: ' + JSON.stringify(response.data));
}

// ─────────────────────────────────────────────────────────────
//  CREATE OTP IN DB AND SEND
//  Tries WhatsApp first → falls back to SMS → falls back to log
// ─────────────────────────────────────────────────────────────
async function createAndSendOTP(retailerId, phone, purpose = 'VERIFY_PHONE') {
  const otp     = generateOTP();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  // Invalidate any existing unused OTPs for this retailer + purpose
  await prisma.oTP.updateMany({
    where: { retailerId, purpose, used: false },
    data:  { used: true },
  });

  // Store new OTP in DB
  await prisma.oTP.create({
    data: {
      retailerId,
      otp,
      purpose,
      expiresAt,
      attempts: 0,
      used:     false,
    },
  });

  // ── Try WhatsApp first ──
  let channel = 'unknown';
  try {
    await sendWhatsApp(phone, otp);
    channel = 'whatsapp';
  } catch (waErr) {
    console.warn('[OTP] WhatsApp failed:', waErr.message, '— trying SMS fallback');

    // ── Fallback to SMS ──
    try {
      await sendSMS(phone, otp);
      channel = 'sms';
    } catch (smsErr) {
      console.warn('[OTP] SMS also failed:', smsErr.message);

      // ── Dev fallback: just log the OTP ──
      if (process.env.NODE_ENV !== 'production') {
        console.log(`\n🔐 DEV OTP for +91${phone}: ${otp}\n`);
        channel = 'console';
      } else {
        // In production, if both fail, throw so user gets an error
        throw new Error('Could not send OTP via WhatsApp or SMS. Please try again.');
      }
    }
  }

  return { success: true, channel };
}

// ─────────────────────────────────────────────────────────────
//  VERIFY OTP
// ─────────────────────────────────────────────────────────────
async function verifyOTP(retailerId, inputOtp, purpose = 'VERIFY_PHONE') {
  const record = await prisma.oTP.findFirst({
    where: {
      retailerId,
      purpose,
      used:     false,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!record) {
    return { valid: false, reason: 'OTP expired or not found. Please request a new one.' };
  }

  // Check attempt limit
  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    await prisma.oTP.update({
      where: { id: record.id },
      data:  { used: true },
    });
    return { valid: false, reason: 'Too many incorrect attempts. Please request a new OTP.' };
  }

  // Increment attempt count
  await prisma.oTP.update({
    where: { id: record.id },
    data:  { attempts: { increment: 1 } },
  });

  // Check if OTP matches
  if (record.otp !== inputOtp.trim()) {
    const attemptsLeft = OTP_MAX_ATTEMPTS - (record.attempts + 1);
    return {
      valid:  false,
      reason: attemptsLeft > 0
        ? `Incorrect OTP. ${attemptsLeft} attempt(s) remaining.`
        : 'Too many incorrect attempts. Please request a new OTP.',
    };
  }

  // ✅ Valid — mark as used
  await prisma.oTP.update({
    where: { id: record.id },
    data:  { used: true },
  });

  return { valid: true };
}

module.exports = { createAndSendOTP, verifyOTP, generateOTP };