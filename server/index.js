const path = require('path');
const express = require('express');
const multer = require('multer');

// Optional: load .env in local dev without adding hard dependency
try { require('dotenv').config(); } catch (_) {}

const { putFileToStorage, insertUploadRow, validateTokenAndGetSignedUrl, getRowForToken } = require('./utils/uploads');
const { getSupabaseClient } = require('./utils/supabase');
const { randomToken, hashToken } = require('./utils/token');

const app = express();
const PORT = process.env.PORT || 3000;

// Static front-end
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.json());

// Multer memory storage (buffer) for direct upload to Supabase
const upload = multer();

// Helper to pick file extension from mimetype
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

// API: upload image -> Supabase Storage + DB row with token hash
// Note: On Vercel, the /api prefix is stripped before reaching Express.
// Register both prefixed and unprefixed routes to work in both envs.
app.post(['/api/upload', '/upload'], ensureSupabaseConfigured, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }
    const ext = extFromMime(req.file.mimetype);
    const { id, path: storagePath } = await putFileToStorage(req.file.buffer, req.file.mimetype, ext);

    const token = randomToken();
    const tokenHash = hashToken(token);
    const expiresAt = null; // consider adding expiry if desired
    await insertUploadRow({ id, storagePath, tokenHash, expiresAt });

    const imageUrl = `/api/image/${id}?t=${token}`;
    const viewerUrl = `/viewer.html?id=${id}&t=${token}`;
    return res.json({ id, token, imageUrl, viewerUrl });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Upload failed', details: e && e.message ? e.message : 'Unknown error' });
  }
});

// Token-protected image endpoint -> redirect to signed Supabase URL
app.get(['/api/image/:id', '/image/:id'], ensureSupabaseConfigured, async (req, res) => {
  try {
    const { id } = req.params;
    const rawToken = req.query.t;
    if (!rawToken) return res.status(400).json({ error: 'Missing token' });

    // Optional debug: return metadata and existence info instead of redirecting
    if (req.query.debug === '1') {
      const row = await getRowForToken({ id, rawToken });
      if (!row) return res.status(403).json({ error: 'Invalid or expired token' });
      const supabase = getSupabaseClient();
      const bucket = process.env.SUPABASE_BUCKET || 'uploads';
      let exists = false, listErr = null, dir = '', name = '';
      try {
        const lastSlash = row.storage_path.lastIndexOf('/');
        dir = lastSlash > -1 ? row.storage_path.slice(0, lastSlash) : '';
        name = lastSlash > -1 ? row.storage_path.slice(lastSlash + 1) : row.storage_path;
        const { data: items, error } = await supabase.storage.from(bucket).list(dir || '', { limit: 100 });
        if (error) listErr = error.message || String(error);
        else exists = !!(items || []).find(it => it.name === name);
      } catch (e) {
        listErr = e && e.message ? e.message : 'list threw';
      }
      const signedUrl = await validateTokenAndGetSignedUrl({ id, rawToken, signedTtlSeconds: 300 });
      return res.json({ id, bucket, path: row.storage_path, exists, dir, name, listErr, signedUrl });
    }

    const url = await validateTokenAndGetSignedUrl({ id, rawToken, signedTtlSeconds: 300 });
    if (!url) return res.status(403).json({ error: 'Invalid or expired token' });
    return res.redirect(302, url);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Lookup failed', details: e && e.message ? e.message : 'Unknown error' });
  }
});

// Background removal is handled client-side via ONNX Runtime Web (no server route)

// Health check to verify Supabase/env wiring
app.get(['/api/health', '/health'], async (req, res) => {
  const supabaseUrl = !!process.env.SUPABASE_URL;
  const supabaseKey = !!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
  const bucket = process.env.SUPABASE_BUCKET || 'uploads';
  let storageOk = false;
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.storage.from(bucket).list('', { limit: 1 });
    storageOk = !error;
  } catch (_) {
    storageOk = false;
  }
  res.json({ ok: supabaseUrl && supabaseKey && storageOk, env: { supabaseUrl, supabaseKey, bucket }, storageOk, vercel: !!process.env.VERCEL });
});

// Fallback to index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

if (process.env.VERCEL) {
  module.exports = app;
} else {
  app.listen(PORT, () => {
    console.log(`WebAR Sticker Prototype running on http://localhost:${PORT}`);
  });
}
// Middleware: ensure Supabase is configured; return helpful 500 if missing
function ensureSupabaseConfigured(req, res, next) {
  try {
    getSupabaseClient();
    next();
  } catch (e) {
    console.error('Supabase configuration error:', e && e.message ? e.message : e);
    res.status(500).json({ error: 'Server not configured for Supabase. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.' });
  }
}
