import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { withInsertDefaults } from "@/lib/supabase/insert-defaults";

const prefer = (init?: RequestInit) => new Headers(init?.headers).get("Prefer");
const REST = "https://x.supabase.co/rest/v1/message_outbox?columns=%22a%22,%22b%22";

describe("rows inserted together use column defaults for what they leave out", () => {
  it("a plain insert asks for missing=default, keeping what it already asked", () => {
    expect(prefer(withInsertDefaults(REST, { method: "POST", headers: { Prefer: "return=representation" } }))).toBe("return=representation,missing=default");
    expect(prefer(withInsertDefaults(new URL(REST), { method: "POST" }))).toBe("missing=default");
  });
  it("upserts, reads, updates, deletes, functions and storage are left alone", () => {
    expect(prefer(withInsertDefaults(REST, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" } }))).toBe("resolution=merge-duplicates,return=minimal");
    expect(withInsertDefaults(REST, { method: "GET" })?.headers).toBeUndefined();
    expect(withInsertDefaults(REST, { method: "PATCH" })?.headers).toBeUndefined();
    expect(withInsertDefaults("https://x.supabase.co/rest/v1/rpc/do_it", { method: "POST" })?.headers).toBeUndefined();
    expect(withInsertDefaults("https://x.supabase.co/storage/v1/object/b/f", { method: "POST" })?.headers).toBeUndefined();
  });
  it("every Supabase client the app makes goes through it", () => {
    expect(readFileSync("src/lib/perf-server.ts", "utf8")).toMatch(/base\(input, withInsertDefaults\(input, init\)\)/);
    for (const f of ["src/lib/supabase/client.ts", "src/live/lib/supabase/client.ts", "src/live/lib/supabase/server.ts"]) {
      expect(readFileSync(f, "utf8"), f).toMatch(/fetch: insertDefaultsFetch\(\)/);
    }
    expect(readFileSync("src/live/lib/supabase/service.ts", "utf8").match(/fetch: insertDefaultsFetch\(\)/g)?.length).toBe(2);
  });
});
