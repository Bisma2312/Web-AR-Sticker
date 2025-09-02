Supabase Integration Guide (First-Time Friendly)
================================================

This project uses Supabase for two things:
- Postgres database table `uploads` to store file metadata and a hashed access token.
- Supabase Storage private bucket to store the actual image files and generate short-lived signed URLs.

What you will set up
--------------------

- A Supabase project (free tier is fine to start).
- One private Storage bucket (default name: `uploads`).
- One Postgres table: `uploads` (migration provided).
- Environment variables in Vercel (and optionally a local `.env`).

1) Create a Supabase project
----------------------------

1. Go to https://supabase.com — create an account and a new project.
2. Choose a region close to your users (keep near your Vercel region if possible).
3. Save the following from the Supabase dashboard:
   - Project URL (looks like `https://xyzcompany.supabase.co`)
   - Service Role Key (found under Settings → API). Do not expose this in the browser.

2) Install the dependency
-------------------------

- In your project directory, install the official client:
  - `npm i @supabase/supabase-js`

3) Add environment variables
----------------------------

Vercel (recommended first):
- Open your Vercel project → Settings → Environment Variables.
- Add:
  - `SUPABASE_URL` = your project URL
  - `SUPABASE_SERVICE_ROLE_KEY` = service role key (server-side only)
  - `SUPABASE_BUCKET` = `uploads` (or your preferred name)
  - `TOKEN_PEPPER` = a random long string to harden token hashes
- Redeploy or trigger a rebuild so the env vars are available.

Local dev (optional):
- Create a `.env` file at the repo root with:

  SUPABASE_URL=your-url-here
  SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
  SUPABASE_BUCKET=uploads
  TOKEN_PEPPER=some-long-random-string

Make sure your local server loads env vars (e.g., `dotenv`) if not already.

4) Create the database table
----------------------------

Use the provided SQL file:
- Open Supabase dashboard → SQL Editor.
- Paste contents of `server/migrations/001_supabase.sql` and run.
- This creates table `public.uploads` and basic row-level security (RLS) policies allowing server-role access.

Table layout (for reference):
- `id` (UUID): primary key for each upload
- `storage_path` (TEXT): path to the file in Supabase Storage
- `token_hash` (TEXT): SHA-256 hash of your access token (raw token is never stored)
- `expires_at` (TIMESTAMPTZ, nullable): optional expiry for time-limited access
- `created_at` (TIMESTAMPTZ): timestamp of insert

5) Create a private Storage bucket
----------------------------------

Using the dashboard:
- Go to Storage → Create new bucket → Name: `uploads` → Visibility: Private.

Or via SQL (optional):

  -- Create a private bucket named `uploads`
  insert into storage.buckets (id, name, public)
  values ('uploads', 'uploads', false)
  on conflict (id) do nothing;

Why private? You will serve files using short-lived signed URLs generated server-side, so files are not publicly listable or hot-linkable.

6) Wire the server (copy/paste)
--------------------------------

Where to put the code
- File path: `server/index.js` (or wherever your Express app lives).
- Utilities to import from this repo:
  - `server/utils/supabase.js`
  - `server/utils/token.js`
  - `server/utils/uploads.js`

Minimal, complete example

Paste this into `server/index.js` (or merge into your existing file). It creates two routes:
- `POST /api/upload` to accept an image file (field name `image`)
- `GET /api/image/:id?t=<token>` to validate and redirect to a signed Supabase URL

```js
// server/index.js
require('dotenv').config(); // optional if you use a local .env in dev
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');

const { putFileToStorage, insertUploadRow, validateTokenAndGetSignedUrl } = require('./utils/uploads');
const { randomToken, hashToken } = require('./utils/token');

const app = express();
const upload = multer();

app.use(cors());
app.use(express.json());

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

// Upload endpoint: accepts multipart/form-data with field name `image`
app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const ext = extFromMime(req.file.mimetype);
    const { id, path: storagePath } = await putFileToStorage(req.file.buffer, req.file.mimetype, ext);

    // create a token once; store only the hash
    const token = randomToken();
    const tokenHash = hashToken(token);
    const expiresAt = null; // or new Date(Date.now() + 60*60*1000) for 1-hour tokens
    await insertUploadRow({ id, storagePath, tokenHash, expiresAt });

    // return the id & token to the client
    res.json({ id, token });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Token-protected image endpoint
app.get('/api/image/:id', async (req, res) => {
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

// Optional: serve your static frontend or export app for serverless
// app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));

// If deploying to Vercel serverless, you may instead:
// module.exports = app;
```

How the pieces connect
- The file bytes are uploaded directly to your private Supabase Storage bucket via the server.
- A UUID `id` and the generated `storage_path` are written to Postgres with a `token_hash`.
- The client receives `{ id, token }` and uses that token in the query string when requesting the image later.
- The GET route validates the hash and returns a short-lived signed URL via `302` redirect.

Client-side example (upload)

This shows how a browser page can upload an image and then display it using the tokenized URL.

```js
// in public/app.js (example)
async function uploadImage(file) {
  const form = new FormData();
  form.append('image', file);
  const resp = await fetch('/api/upload', { method: 'POST', body: form });
  if (!resp.ok) throw new Error('Upload failed');
  const { id, token } = await resp.json();
  // Store for later; you can also pass via query params to viewer.html
  return { id, token };
}

async function showImage({ id, token }) {
  const imgUrl = `/api/image/${id}?t=${encodeURIComponent(token)}`;
  const img = document.getElementById('preview');
  img.src = imgUrl;
}
```

Notes on deployment
- Vercel + Express: If you use a custom Node server, ensure your Vercel build runs `npm start` and exposes the port specified by `PORT`.
- Vercel Serverless Functions: Alternative is to export the Express app (`module.exports = app`) and adapt to Vercel’s `api` directory. The utilities work the same.
- Ensure your env vars (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET`, `TOKEN_PEPPER`) are set in Vercel and available at runtime.

7) Verify the setup
-------------------

Manual test flow:
1. Upload an image via your landing page or with curl/postman to `/api/upload`.
2. You should get `{ id, token }` in the response.
3. Open `/api/image/<id>?t=<token>` in a browser. You should see a redirect to a signed Supabase URL and then the image loads.
4. Try changing the token by 1 character; you should get 403.

8) Security notes
-----------------

- Do not send `SUPABASE_SERVICE_ROLE_KEY` to the client; it must live only on the server.
- We store only the SHA-256 hash of the token in Postgres; the raw token is returned once to the client.
- Consider adding expirations (`expires_at`) and rotating tokens if needed.
- Keep the bucket private; serving occurs via signed URLs with short TTLs (e.g., 5 minutes).
- Set a strong `TOKEN_PEPPER` secret to harden token hashes.

9) Common troubleshooting
-------------------------

- 403 on image route:
  - Token mismatch or expired. Confirm the exact `token` returned by upload is used as `t` param.
  - Ensure `TOKEN_PEPPER` did not change between upload and fetch.
  - Verify the DB row exists in `public.uploads` and `storage_path` matches the object path in your bucket.
- 500 on upload:
  - Check env vars present at runtime (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`).
  - Confirm bucket name matches `SUPABASE_BUCKET` or default `uploads`.
  - File too large? Consider Multer limits and Supabase Storage size limits.
- Not seeing redirects on Vercel:
  - Ensure your Express server is the one serving routes (check `npm start` on Vercel or serverless adaptation).

10) Optional enhancements
-------------------------

- One-time tokens: Add a boolean column `consumed` and set it true after first successful access.
- Cleanup job: Add a script/cron (e.g., Vercel Cron) to delete old rows and Storage objects past `expires_at`.
- Background removal: Store the processed image as a second object; add a column `processed_path` or a new table.
- KV cache (later): Cache token lookups to speed up `GET /api/image/:id?t=token` and reduce DB hits.
