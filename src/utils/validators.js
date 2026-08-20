const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const PHONE_REGEX = /^[6-9]\d{9}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidGSTIN(g) { return GSTIN_REGEX.test((g || '').toUpperCase()); }
function isValidPhone(p) { return PHONE_REGEX.test((p || '').replace(/\s/g, '')); }
function isValidEmail(e) { return EMAIL_REGEX.test((e || '').toLowerCase()); }

module.exports = { isValidGSTIN, isValidPhone, isValidEmail };