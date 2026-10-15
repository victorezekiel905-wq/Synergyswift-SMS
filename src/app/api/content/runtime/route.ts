import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { readToken, saveAttempt } from "@/lib/content-server";
import { keepValues, scormOutcome } from "@/lib/content";

export const dynamic = "force-dynamic";

const Body = z.object({ token: z.string().max(600), values: z.record(z.string(), z.unknown()).default({}), finish: z.boolean().default(false) });

/** SCORM progress, sent by the player page (which holds the student's session) when the package commits or finishes. */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(undefined, "lms");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("invalid progress");
  // Progress saved while offline may arrive after the six-hour link has expired; the signed-in user must match it.
  const t = readToken(parsed.data.token, true);
  if (!t || t.u !== ctx.userId || t.t !== ctx.tenant.id) return jsonError("this content session has expired; open it again", 403);
  if (!t.a) return NextResponse.json({ ok: true, preview: true });
  if (t.k !== "scorm12" && t.k !== "scorm2004") return jsonError("not a SCORM package");
  const svc = createServiceClient();
  const [{ data: att }, { data: pkg }] = await Promise.all([
    svc.from("content_attempts").select("id,data").eq("id", t.a).eq("user_id", ctx.userId).maybeSingle(),
    svc.from("content_packages").select("mastery_score").eq("id", t.p).maybeSingle()
  ]);
  if (!att || !pkg) return jsonError("not found", 404);
  let values: Record<string, string>;
  try { values = keepValues(att.data ?? {}, parsed.data.values); } catch (e) { return jsonError((e as Error).message, 413); }
  // Session time is only counted once, when the package finishes.
  const merged = { ...values, ...Object.fromEntries(Object.entries(parsed.data.values).filter(([k]) => /session_time$/.test(k)).map(([k, v]) => [k, String(v)])) };
  const out = scormOutcome(t.k, merged, pkg.mastery_score ?? null);
  const r = await saveAttempt(svc, { tenantId: t.t, attemptId: att.id, packageId: t.p, status: out.status === "not_attempted" ? null : out.status, score: out.score,
    seconds: parsed.data.finish ? out.seconds : 0, data: values });
  return NextResponse.json({ ok: true, status: r?.status, score: r?.score ?? null });
}
