const axios  = require('axios');
const prisma = require('../utils/prisma');

// Generate a 6-digit OTP
function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// Send OTP via Fast2SMS
async function sendSMS(phone, code) {
  if (process.env.NODE_ENV !== 'production') {
    // In development just log it — no SMS cost
    console.log(`[DEV] OTP for ${phone}: ${code}`);
    return;
  }

  await axios.post('https://www.fast2sms.com/dev/bulkV2', null, {
    params: {
      authorization: process.env.FAST2SMS_API_KEY,
      message:       `Your RythuStore OTP is ${code}. Valid for 10 minutes. Do not share.`,
      language:      'english',
      route:         'q',   // transactional route
      numbers:       phone,
    },
    timeout: 8000,
  });
}

// Create OTP record in DB and send SMS
async function createAndSendOTP(retailerId, phone, purpose) {
  const code      = generateCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

  // Invalidate any existing OTPs for same purpose
  await prisma.oTP.updateMany({
    where: { retailerId, purpose, used: false },
    data:  { used: true },
  });

  await prisma.oTP.create({
    data: { retailerId, code, purpose, expiresAt },
  });

  await sendSMS(phone, code);
  return code; // returned for dev logging only
}

// Verify OTP — returns true/false
async function verifyOTP(retailerId, code, purpose) {
  const otp = await prisma.oTP.findFirst({
    where: {
      retailerId,
      purpose,
      used:      false,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!otp) return { valid: false, reason: 'OTP expired or not found' };

  // Increment attempts
  await prisma.oTP.update({
    where: { id: otp.id },
    data:  { attempts: { increment: 1 } },
  });

  // Block after 3 wrong attempts
  if (otp.attempts >= 3) {
    await prisma.oTP.update({ where: { id: otp.id }, data: { used: true } });
    return { valid: false, reason: 'Too many wrong attempts. Request a new OTP.' };
  }

  if (otp.code !== code) {
    return { valid: false, reason: 'Incorrect OTP' };
  }

  // Mark used
  await prisma.oTP.update({ where: { id: otp.id }, data: { used: true } });
  return { valid: true };
}

module.exports = { createAndSendOTP, verifyOTP };