// Vercel Serverless Function for image retrieval by id with token
// Uses shared utils so logic stays in one place.

const { validateTokenAndGetSignedUrl, getRowForToken } = require('../../server/utils/uploads');
const { getSupabaseClient } = require('../../server/utils/supabase');

module.exports = async (req, res) => {
  try {
    // Parse URL and params safely (works in Vercel Node runtime)
    const fullUrl = new URL(req.url, 'http://localhost');
    const token = fullUrl.searchParams.get('t');
    const debug = fullUrl.searchParams.get('debug');
    if (!token) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: 'Missing token' }));
    }

    // Extract id from path (last non-empty segment)
    const pathname = fullUrl.pathname || '';
    const segments = pathname.split('/').filter(Boolean);
    const id = segments[segments.length - 1];
    if (!id) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: 'Missing id' }));
    }

    // Optional debug response with existence check
    if (debug === '1') {
      const row = await getRowForToken({ id, rawToken: token });
      if (!row) {
        res.statusCode = 403;
        return res.end(JSON.stringify({ error: 'Invalid or expired token' }));
      }
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
      const signedUrl = await validateTokenAndGetSignedUrl({ id, rawToken: token, signedTtlSeconds: 300 });
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ id, bucket, path: row.storage_path, exists, dir, name, listErr, signedUrl }));
    }

    const url = await validateTokenAndGetSignedUrl({ id, rawToken: token, signedTtlSeconds: 300 });
    if (!url) {
      res.statusCode = 403;
      return res.end(JSON.stringify({ error: 'Invalid or expired token' }));
    }
    // Redirect to the signed Supabase URL
    res.statusCode = 302;
    res.setHeader('Location', url);
    return res.end();
  } catch (e) {
    console.error('image handler error:', e);
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: 'Lookup failed', details: e && e.message ? e.message : 'Unknown error' }));
  }
};
