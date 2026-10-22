'use strict';
const router = require('express').Router();
const axios  = require('axios');

const GST_STATES = {
  '01':'Jammu & Kashmir','02':'Himachal Pradesh','03':'Punjab','04':'Chandigarh',
  '05':'Uttarakhand','06':'Haryana','07':'Delhi','08':'Rajasthan','09':'Uttar Pradesh',
  '10':'Bihar','11':'Sikkim','12':'Arunachal Pradesh','13':'Nagaland','14':'Manipur',
  '15':'Mizoram','16':'Tripura','17':'Meghalaya','18':'Assam','19':'West Bengal',
  '20':'Jharkhand','21':'Odisha','22':'Chhattisgarh','23':'Madhya Pradesh',
  '24':'Gujarat','25':'Daman & Diu','26':'Dadra & Nagar Haveli','27':'Maharashtra',
  '28':'Andhra Pradesh','29':'Karnataka','30':'Goa','31':'Lakshadweep',
  '32':'Kerala','33':'Tamil Nadu','34':'Puducherry','35':'Andaman & Nicobar',
  '36':'Telangana','37':'Andhra Pradesh (new)','38':'Ladakh',
};

// POST /api/gst/verify
router.post('/verify', async (req, res) => {
  try {
    const { gstin } = req.body;
    if (!gstin) return res.status(400).json({ error: 'GSTIN required' });

    // Basic format validation
    const gstRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
    if (!gstRegex.test(gstin.toUpperCase()))
      return res.status(400).json({ error: 'Invalid GSTIN format' });

    const stateCode = gstin.slice(0, 2);
    const state     = GST_STATES[stateCode] || '';

    // Try GST API
    if (process.env.GSTINCHECK_API_KEY) {
      try {
        const resp = await axios.get(`https://sheet.gstincheck.co.in/check/${process.env.GSTINCHECK_API_KEY}/${gstin}`, {
          timeout: 5000,
        });
        const d = resp.data;
        if (d && d.flag) {
          return res.json({
            valid: true,
            gstin: gstin.toUpperCase(),
            legalName: d.data?.lgnm || '',
            tradeName: d.data?.tradeNam || '',
            state,
            verified: true,
          });
        }
      } catch (apiErr) {
        console.warn('GST API failed, soft-verify:', apiErr.message);
      }
    }

    // Soft-verify fallback — format valid, state auto-filled
    res.json({
      valid: true,
      gstin: gstin.toUpperCase(),
      legalName: '',
      tradeName: '',
      state,
      verified: false, // soft-verified (format only)
    });
  } catch (err) {
    console.error('GST verify error:', err);
    res.status(500).json({ error: 'GST verification failed' });
  }
});

module.exports = router;