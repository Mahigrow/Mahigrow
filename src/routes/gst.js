const router = require('express').Router();
const axios  = require('axios');
const { isValidGSTIN } = require('../utils/validators');

const STATE_CODES = {
  '01':'Jammu & Kashmir','02':'Himachal Pradesh','03':'Punjab','04':'Chandigarh',
  '05':'Uttarakhand','06':'Haryana','07':'Delhi','08':'Rajasthan','09':'Uttar Pradesh',
  '10':'Bihar','11':'Sikkim','12':'Arunachal Pradesh','13':'Nagaland','14':'Manipur',
  '15':'Mizoram','16':'Tripura','17':'Meghalaya','18':'Assam','19':'West Bengal',
  '20':'Jharkhand','21':'Odisha','22':'Chhattisgarh','23':'Madhya Pradesh',
  '24':'Gujarat','26':'Dadra & Nagar Haveli','27':'Maharashtra',
  '28':'Andhra Pradesh (old)','29':'Karnataka','30':'Goa',
  '32':'Kerala','33':'Tamil Nadu','34':'Puducherry',
  '36':'Telangana','37':'Andhra Pradesh','38':'Ladakh',
};

// GET /api/gst/validate-format?gstin=37AABCU9603R1ZX
// Instant format check — no API call
router.get('/validate-format', (req, res) => {
  const gstin = (req.query.gstin || '').toUpperCase().trim();

  if (!isValidGSTIN(gstin)) {
    return res.status(400).json({ valid: false, error: 'Invalid GSTIN format' });
  }

  const stateCode = gstin.substring(0, 2);
  return res.json({
    valid:     true,
    gstin,
    stateName: STATE_CODES[stateCode] || 'Unknown',
  });
});

// POST /api/gst/verify
// Body: { gstin }
// Full live verification via GSTINcheck API
router.post('/verify', async (req, res) => {
  const gstin = (req.body.gstin || '').toUpperCase().trim();

  if (!isValidGSTIN(gstin)) {
    return res.status(400).json({ verified: false, error: 'Invalid GSTIN format' });
  }

  try {
    const apiKey   = process.env.GSTINCHECK_API_KEY;
    const response = await axios.get(
      `https://api.gstincheck.co.in/check/${apiKey}/${gstin}`,
      { timeout: 8000 }
    );

    const data = response.data;

    if (!data.flag) {
      return res.status(404).json({
        verified: false,
        error:    'GSTIN not found in government database. Please check the number.',
      });
    }

    if (data.sts && data.sts.toLowerCase() !== 'active') {
      return res.status(400).json({
        verified: false,
        error:    `GST registration is ${data.sts}. Only active GSTINs are accepted.`,
      });
    }

    return res.json({
      verified:         true,
      gstin,
      tradeName:        data.tradeNam || '',
      legalName:        data.lgnm     || '',
      status:           data.sts      || 'Active',
      registrationDate: data.rgdt     || '',
      stateName:        STATE_CODES[gstin.substring(0, 2)] || '',
    });

  } catch (err) {
    console.error('GST API error:', err.message);

    // Soft fail — let the user register, team verifies manually
    return res.status(503).json({
      verified:  false,
      softFail:  true,
      error:     'Verification service unavailable. Your format is valid — our team will verify manually.',
      stateName: STATE_CODES[gstin.substring(0, 2)] || '',
    });
  }
});

module.exports = router;