const { createClient } = require('@supabase/supabase-js');

let cachedClient = null;

function getSupabaseClient() {
  if (cachedClient) return cachedClient;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error('Supabase env vars missing: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or ANON key)');
  }

  cachedClient = createClient(url, key, {
    auth: { persistSession: false },
    global: { headers: { 'X-Client-Info': 'webar-prototype-server' } },
  });
  return cachedClient;
}

module.exports = { getSupabaseClient };

