import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client for the NEW multi-tenant product project — kept
 * entirely separate from the personal dashboard's client (lib/supabase.ts), so
 * the live `/` dashboard is untouched. Reads the training tables (public schema)
 * with the service-role key and scopes every query by tenant_id in code.
 *
 * Returns null until PRODUCT_SUPABASE_URL + PRODUCT_SUPABASE_SERVICE_KEY are set,
 * so the /app route falls back to mock data and always renders.
 */
let cached: SupabaseClient | null | undefined;

export function getProductSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;

  const url = process.env.PRODUCT_SUPABASE_URL;
  const key = process.env.PRODUCT_SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    cached = null;
    return null;
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
