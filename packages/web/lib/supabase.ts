import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Returns a Supabase client if the public env vars are set, else null. The app is
 * designed to run without a backend (bundled-cartridge fallback in data.ts), so every
 * caller must handle null.
 */
let cached: SupabaseClient | null | undefined;

export function getSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  cached = url && key ? createClient(url, key) : null;
  return cached;
}
