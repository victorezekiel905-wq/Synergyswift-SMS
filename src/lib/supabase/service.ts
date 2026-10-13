import { createClient as createBaseClient } from "@supabase/supabase-js";
import { currentActor } from "@/lib/request-actor";

/**
 * Service-role client. Each query carries the request's actor (user:<id>,
 * guardian:<id>) in an x-actor header so the change history shows who
 * the server acted for.
 */
export function createServiceClient(): any {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || key.includes("replace-with-")) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured. Service-role operations " +
      "are unavailable in this environment; use the RLS-bound server client instead."
    );
  }
  return createBaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        const actor = currentActor();
        if (!actor) return fetch(input, init);
        const headers = new Headers(init?.headers);
        headers.set("x-actor", actor);
        return fetch(input, { ...init, headers });
      }
    }
  });
}
