// Two server-side Supabase clients, as in PostgresBackend:
// - `supabase`: secret key, for data. Bypasses RLS, so every query filters by owner.
// - `authClient`: publishable key, for login, token checks and refresh.
// Never use either in the browser.
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!url || !secretKey || !publishableKey) {
  throw new Error("SUPABASE_URL, SUPABASE_SECRET_KEY and SUPABASE_PUBLISHABLE_KEY are required.");
}

const options = {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
};

export const supabase = createClient(url, secretKey, options);
export const authClient = createClient(url, publishableKey, options);
