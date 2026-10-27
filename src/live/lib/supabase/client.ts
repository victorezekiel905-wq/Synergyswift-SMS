"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

/**
 * One RLS-bound client per tab for the live-lessons engine; every query runs as
 * the signed-in user. Synergy Swift: queries go to the "live" schema, so this is
 * its own instance (not the app's shared one, which reads "public"); the sign-in
 * session is the same.
 */
export function createClient(): SupabaseClient {
  if (!browserClient) {
    browserClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { db: { schema: "live" }, isSingleton: false }
    ) as unknown as SupabaseClient;
  }
  return browserClient;
}
