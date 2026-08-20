// ─────────────────────────────────────────────────────────
//  routes/upload.js
//  Handles image uploads → Supabase Storage
//
//  Mount in app.js:
//    const uploadRouter = require('./routes/upload');
//    app.use('/api/upload', uploadRouter);
//
//  Install multer:
//    npm install multer @supabase/supabase-js
//
//  .env needs:
//    SUPABASE_URL=https://xxx.supabase.co
//    SUPABASE_SERVICE_KEY=your-service-role-key   ← NOT anon key
// ─────────────────────────────────────────────────────────

const router  = require('express').Router();
const multer  = require('multer');
const { createClient } = require('@supabase/supabase-js');

// Multer: store file in memory (not disk)
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 2 * 1024 * 1024 },   // 2 MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPG, PNG, WebP, GIF allowed'));
  },
});

// Supabase client with service role key (has storage write access)
function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY    // service_role key, not anon
  );
}

// ─────────────────────────────────────────────
//  POST /api/upload/product-image
//  Accepts: multipart/form-data with field "image"
//  Returns: { url: "https://..." }
// ─────────────────────────────────────────────
router.post('/product-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const supabase = getSupabase();

    // Build a safe unique filename
    const mimeToExt = {
      'image/jpeg': 'jpg',
      'image/png':  'png',
      'image/webp': 'webp',
      'image/gif':  'gif',
    };
    const ext      = mimeToExt[req.file.mimetype] || 'jpg';
    const fileName = `products/${Date.now()}-${Math.random().toString(36).substring(2, 10)}.${ext}`;

    // Upload to Supabase Storage
    const { error } = await supabase.storage
      .from('product-images')
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert:      false,
      });

    if (error) {
      console.error('Supabase upload error:', error);
      return res.status(500).json({ error: 'Image upload failed: ' + error.message });
    }

    // Get the public URL
    const { data } = supabase.storage
      .from('product-images')
      .getPublicUrl(fileName);

    return res.json({
      success: true,
      url:     data.publicUrl,
      fileName,
    });

  } catch (err) {
    console.error('Upload error:', err);
    if (err.message.includes('File too large')) {
      return res.status(400).json({ error: 'Image must be under 2 MB' });
    }
    if (err.message.includes('Only JPG')) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Upload failed. Please try again.' });
  }
});

module.exports = router;