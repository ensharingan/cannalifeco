import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env');
}

// HashRouter puts the route in the hash. Only let supabase-js inspect and
// rewrite it when the URL really is an auth callback.
const url = typeof window !== 'undefined' ? window.location.href : '';
const looksLikeAuthCallback =
  /[#&?](access_token|refresh_token|error_description|code)=/.test(url);

// Own storage key: stops a second client sharing this session and racing the
// refresh token — the cause of "Refresh Token Not Found".
const STORAGE_KEY = 'cannalife-pos-auth';
const GLOBAL_KEY = '__cannalifeSupabaseClient';

function createCannalifeClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: looksLikeAuthCallback,
      storageKey: STORAGE_KEY,
      // Set back to 'implicit' if your reset-password email templates still
      // use the old {{ .Token }} style links.
      flowType: 'pkce',
    },
    realtime: { params: { eventsPerSecond: 5 } },
    global: { headers: { 'x-client-info': 'cannalife-pos' } },
  });
}

let client;

if (typeof globalThis !== 'undefined') {
  if (!globalThis[GLOBAL_KEY]) {
    globalThis[GLOBAL_KEY] = createCannalifeClient();
  } else if (import.meta.env.DEV) {
    console.warn('[cannalife] Reusing the existing Supabase client.');
  }
  client = globalThis[GLOBAL_KEY];
} else {
  client = createCannalifeClient();
}

export const supabase = client;
export default supabase;
