import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { requirePlatformAdmin, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DIR = path.join(process.cwd(), "supabase", "seed", "open-books");

/** How many free-library books are loaded, and how many the app ships with. */
export async function GET() {
  const gate = await requirePlatformAdmin();
  if (gate instanceof NextResponse) return gate;
  const summary = JSON.parse(await fs.readFile(path.join(DIR, "summary.json"), "utf8").catch(() => "null"));
  const { count, error } = await createServiceClient().from("open_books").select("id", { count: "exact", head: true });
  return NextResponse.json({ loaded: error ? null : count ?? 0, missing_table: Boolean(error && /open_books/.test(error.message)), shipped: summary });
}

/**
 * Loads (or refreshes) the free library from the catalogue shipped with the app
 * (scripts/library/build-open-books.mjs). Every school sees it at once. Owner only.
 */
export async function POST() {
  const gate = await requirePlatformAdmin("owner");
  if (gate instanceof NextResponse) return gate;
  const svc = createServiceClient();
  const files = (await fs.readdir(DIR).catch(() => [])).filter(f => f.endsWith(".json.gz")).sort();
  if (!files.length) return jsonError("The free-library catalogue isn't in this build.");
  let loaded = 0;
  const now = new Date().toISOString();
  for (const f of files) {
    const rows = JSON.parse(zlib.gunzipSync(await fs.readFile(path.join(DIR, f))).toString("utf8")) as Record<string, unknown>[];
    for (let i = 0; i < rows.length; i += 1000) {
      const { error } = await svc.from("open_books").upsert(rows.slice(i, i + 1000).map(r => ({ ...r, updated_at: now })), { onConflict: "id" });
      if (error) return jsonError(/source_check/.test(error.message) ? `Loaded ${loaded} books, then stopped: the extra textbooks need the second database update (migration 20260101009110).`
        : /open_books/.test(error.message) ? "The free library needs the database update (migration 20260101009100)." : `Stopped after ${loaded} books: ${error.message}`);
      loaded += Math.min(1000, rows.length - i);
    }
  }
  await svc.from("platform_audit_logs").insert({ actor_id: gate.userId, action: "open_books.loaded", meta: { books: loaded } });
  return NextResponse.json({ ok: true, loaded });
}
