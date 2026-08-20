const Razorpay = require('razorpay');
const crypto   = require('crypto');

// Lazy init — only created when first order is placed, not at startup
let rzp = null;
function getRzp() {
  if (!rzp) {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are missing from .env');
    }
    rzp = new Razorpay({
      key_id:     process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return rzp;
}

// Create a Razorpay order
async function createOrder(amountInPaise, receipt) {
  return getRzp().orders.create({
    amount:   amountInPaise,
    currency: 'INR',
    receipt,
  });
}

// Verify payment signature
function verifySignature(razorpayOrderId, razorpayPaymentId, signature) {
  const body     = razorpayOrderId + '|' + razorpayPaymentId;
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest('hex');
  return expected === signature;
}

module.exports = { createOrder, verifySignature };