import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client. Uses the SERVICE-ROLE key so the app (which sits
 * behind the password proxy) can read/write while RLS stays fully locked — the
 * anon/publishable key can't bypass RLS, so it is intentionally NOT used here.
 * NEVER import this into a client component.
 *
 * Returns null until the service-role key is configured — callers then fall
 * back to deterministic mock data so the dashboard always renders something.
 */
let cached: SupabaseClient | null | undefined;

export function getSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    cached = null;
    return null;
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

export const isSupabaseConfigured = () =>
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
