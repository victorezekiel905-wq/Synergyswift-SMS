import { createBrowserClient } from "@supabase/ssr";
import { insertDefaultsFetch } from "./insert-defaults";

// Permissive typing: the full column-level schema is maintained in
// supabase/migrations/*.sql. Client calls are typed loosely on purpose.
export function createClient(): any {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { fetch: insertDefaultsFetch() } }
  );
}
