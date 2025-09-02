const express = require('express');
const multer = require('multer');
const { putFileToStorage, insertUploadRow, validateTokenAndGetSignedUrl } = require('../utils/uploads');
const { randomToken, hashToken } = require('../utils/token');

const router = express.Router();
const upload = multer();

function extFromMime(mime) {
  switch (mime) {
    case 'image/png':
      return '.png';
    case 'image/jpeg':
    case 'image/jpg':
      return '.jpg';
    case 'image/webp':
      return '.webp';
    default:
      return '';
  }
}

// Standardized upload route and field key
router.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const ext = extFromMime(req.file.mimetype);
    const { id, path } = await putFileToStorage(req.file.buffer, req.file.mimetype, ext);

    const token = randomToken();
    const tokenHash = hashToken(token);
    const expiresAt = null; // set to a Date for expiring tokens
    await insertUploadRow({ id, storagePath: path, tokenHash, expiresAt });

    res.json({ id, token });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Token-protected access route
router.get('/api/image/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const rawToken = req.query.t;
    if (!rawToken) return res.status(400).json({ error: 'Missing token' });

    const url = await validateTokenAndGetSignedUrl({ id, rawToken, signedTtlSeconds: 300 });
    if (!url) return res.status(403).json({ error: 'Invalid or expired token' });
    return res.redirect(302, url);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Lookup failed' });
  }
});

module.exports = router;

