import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { canRun, gradeCode } from "@/lib/exams/code-runner";

const Body = z.object({
  language: z.string().max(20), code: z.string().max(50_000),
  tests: z.array(z.object({ input: z.string().max(20_000), expected: z.string().max(20_000), hidden: z.boolean().optional() })).min(1).max(20)
});

/** Teachers check their reference solution (or any code) against the test cases while writing a question. */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "exams");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("send language, code and at least one test case");
  const b = parsed.data;
  if (!canRun(b.language)) return jsonError(b.language === "javascript" ? "runner unavailable" : "Automatic marking for this language needs a Judge0 server (JUDGE0_URL). JavaScript works without one.", 400);
  const g = await gradeCode(b.language, b.code, b.tests.map(t => ({ ...t, hidden: false })), b.tests.length);
  return NextResponse.json({ passed: g.passed, total: g.total, outcomes: g.outcomes });
}
