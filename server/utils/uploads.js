const path = require('path');
const { getSupabaseClient } = require('./supabase');
const { randomUUID, hashToken } = require('./token');

const DEFAULT_BUCKET = process.env.SUPABASE_BUCKET || 'uploads';

async function putFileToStorage(fileBuffer, contentType, proposedExt = '') {
  const supabase = getSupabaseClient();
  const id = randomUUID();
  const date = new Date();
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const safeExt = proposedExt?.replace(/[^a-zA-Z0-9.]/g, '') || '';
  const objectPath = `${y}/${m}/${d}/${id}${safeExt ? (safeExt.startsWith('.') ? safeExt : '.' + safeExt) : ''}`;

  let error;
  try {
    ({ error } = await supabase
      .storage
      .from(DEFAULT_BUCKET)
      .upload(objectPath, fileBuffer, { contentType, upsert: false }));
  } catch (e) {
    console.error('Supabase upload threw:', e);
    throw e;
  }
  if (error) {
    console.error('Supabase upload error:', error);
    throw error;
  }
  return { id, bucket: DEFAULT_BUCKET, path: objectPath };
}

async function insertUploadRow({ id, storagePath, tokenHash, expiresAt = null }) {
  const supabase = getSupabaseClient();
  const payload = {
    id,
    storage_path: storagePath,
    token_hash: tokenHash,
    expires_at: expiresAt,
  };
  let data, error;
  try {
    ({ data, error } = await supabase
      .from('uploads')
      .insert(payload)
      .select('id')
      .single());
  } catch (e) {
    console.error('DB insert threw:', e);
    throw e;
  }
  if (error) {
    console.error('DB insert error:', error);
    throw error;
  }
  return data.id;
}

async function getRowForToken({ id, rawToken }) {
  const supabase = getSupabaseClient();
  const tokenHash = hashToken(rawToken);
  let row, error;
  try {
    ({ data: row, error } = await supabase
      .from('uploads')
      .select('id, storage_path, expires_at, created_at')
      .eq('id', id)
      .eq('token_hash', tokenHash)
      .limit(1)
      .maybeSingle());
  } catch (e) {
    console.error('DB select (debug) threw:', e);
    throw e;
  }
  if (error) {
    console.error('DB select (debug) error:', error);
    throw error;
  }
  return row || null;
}

async function validateTokenAndGetSignedUrl({ id, rawToken, signedTtlSeconds = 300 }) {
  const supabase = getSupabaseClient();
  const tokenHash = hashToken(rawToken);
  let row, error;
  try {
    ({ data: row, error } = await supabase
      .from('uploads')
      .select('storage_path, expires_at')
      .eq('id', id)
      .eq('token_hash', tokenHash)
      .limit(1)
      .maybeSingle());
  } catch (e) {
    console.error('DB select threw:', e);
    throw e;
  }
  if (error) {
    console.error('DB select error:', error);
    throw error;
  }
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;

  let signed, signErr;
  try {
    ({ data: signed, error: signErr } = await supabase
      .storage
      .from(DEFAULT_BUCKET)
      .createSignedUrl(row.storage_path, signedTtlSeconds));
  } catch (e) {
    console.error('Create signed URL threw:', e);
    throw e;
  }
  if (signErr) {
    console.error('Create signed URL error:', signErr);
    throw signErr;
  }
  return signed?.signedUrl || null;
}

module.exports = {
  putFileToStorage,
  insertUploadRow,
  validateTokenAndGetSignedUrl,
};
