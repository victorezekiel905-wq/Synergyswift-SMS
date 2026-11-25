import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const ws = readFileSync("src/components/results/ResultsWorkspace.tsx", "utf8");
const api = readFileSync("src/app/api/results/scores/route.ts", "utf8");
const lockApi = readFileSync("src/app/api/results/locks/route.ts", "utf8");
const sql = readFileSync("supabase/migrations/20260101010900_score_locks.sql", "utf8");

describe("mid-term and end of term score sheets", () => {
  it("are two sheets: mid-term parts on the mid-term sheet, the rest on the end of term sheet", () => {
    expect(ws).toMatch(/"Mid-term sheet" : "End of term sheet"/);
    // On the end of term sheet the mid-term parts are shown as entered, not typed again.
    expect(ws).toMatch(/const fromMidSheet = \(c: \{ midterm\?: boolean \}\) => forReport === "term" && Boolean\(c\.midterm\)/);
    expect(ws).toMatch(/disabled=\{!cellOpen\(c\)\}/);
    expect(ws).toMatch(/Entered on the mid-term sheet/);
  });
  it("respect the admin's locks: mid-term locks the mid-term parts, end of term locks every part", () => {
    expect(ws).toMatch(/const cellOpen = \(c: \{ midterm\?: boolean \}\) => Boolean\(data\?\.can_edit\) && !termLocked && !\(c\.midterm && midLocked\) && !fromMidSheet\(c\)/);
    expect(api).toMatch(/midterm_scores_locked_at,term_scores_locked_at/);
  });
  it("only a school admin can lock, and the database keeps the lock for everyone", () => {
    expect(lockApi).toMatch(/requireCtx\(ROLES\.admin/);
    expect(sql).toMatch(/if not public\.is_school_admin\(\) then raise exception/);
    expect(sql).toMatch(/create trigger score_entries_report_lock before insert or update or delete on public\.score_entries/);
  });
});