import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/results", async () => ({ fetchAll: (await import("@/lib/fetch-all")).fetchAll }));
vi.mock("@/lib/school", () => ({ studentName: (s: { first_name: string }) => s.first_name }));
vi.mock("@/lib/fees", () => ({ createInvoice: async () => null }));
vi.mock("@/lib/provision", () => ({ provisionUser: async () => ({ userId: "u" }) }));
vi.mock("@/lib/auth", () => ({ STAFF_ROLE_OPTIONS: ["teacher"] }));
import { runImport } from "@/lib/importers-server";
import type { RowResult } from "@/lib/importers";

/** A database in memory where every call takes 80 ms, like the live one. */
function fakeDb() {
  const tables: Record<string, any[]> = { class_groups: [], students: [], guardians: [], student_guardians: [] };
  let n = 0, calls = 0;
  const from = (table: string) => {
    let op = "select", payload: any = null;
    const q: any = {
      select: () => q, eq: () => q, order: () => q, not: () => q, in: () => q, range: () => q, single: () => q,
      insert: (row: any) => { op = "insert"; payload = row; return q; },
      update: (row: any) => { op = "update"; payload = row; return q; },
      upsert: (row: any) => { op = "upsert"; payload = row; return q; },
      then: (ok: (v: any) => void) => {
        calls++;
        setTimeout(() => {
          if (op === "insert") { const row = { id: `${table}-${++n}`, ...payload }; tables[table].push(row); ok({ data: row, error: null }); }
          else if (op === "upsert") { tables[table].push(payload); ok({ data: payload, error: null }); }
          else if (op === "update") ok({ data: { id: "x" }, error: null });
          else ok({ data: [...tables[table]], error: null });
        }, 80);
      }
    };
    return q;
  };
  return { sb: { from }, tables, calls: () => calls };
}

const row = (i: number): RowResult => ({ row: i + 2, errors: [], values: {
  admission_no: `ADM${i}`, first_name: `Child${i}`, last_name: "Obi", class: `JSS ${(i % 3) + 1}`,
  // Two children per family: the same parent's phone twice.
  guardian_name: `Parent ${Math.floor(i / 2)}`, guardian_phone: `0803${String(Math.floor(i / 2)).padStart(7, "0")}`, guardian_email: null
} } as never);

describe("importing a whole school's students", () => {
  it("300 students with shared parents finish well inside Cloudflare's 100 seconds, with no duplicates", async () => {
    const db = fakeDb();
    const t = Date.now();
    const r = await runImport(db.sb, "t1", "students", Array.from({ length: 300 }, (_, i) => row(i)), { dryRun: false, baseUrl: "", userId: "u", svc: null });
    const ms = Date.now() - t;
    expect(r.errors).toEqual([]);
    expect(r.created).toBe(300);
    expect(db.tables.class_groups).toHaveLength(3);         // each class made once
    expect(db.tables.guardians).toHaveLength(150);          // brothers and sisters share one parent
    expect(db.tables.student_guardians).toHaveLength(300);
    // One after another this was about 300 × 3 × 80 ms = 72 s; 10 at a time it is a few seconds.
    expect(ms).toBeLessThan(15_000);
  }, 60_000);
});
