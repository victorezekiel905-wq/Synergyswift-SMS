import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { chunks } from "@/lib/fetch-all";
import { transcriptCodes, makeTranscriptCodes, sendTranscriptCodes, transcriptNeedsUpdate } from "@/lib/onboarding-codes-server";

export const dynamic = "force-dynamic";

/** School office → Transcripts: every student's transcript code (admins only, migration 10100). */
export async function GET() {
  const ctx = await requireCtx(ROLES.admin, "results");
  if (ctx instanceof NextResponse) return ctx;
  try {
    return NextResponse.json({ rows: await transcriptCodes(createServiceClient(), ctx.tenant.id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const m = (e as Error).message;
    return jsonError(transcriptNeedsUpdate(m) ? "Transcript codes need the database update (migration 20260101010100)." : m, 503);
  }
}

const Ids = z.array(z.string().uuid()).min(1).max(5000);
const Body = z.discriminatedUnion("action", [
  // Make (or replace) codes: one student, a class or the whole school. days: how long they work (none = until replaced).
  z.object({ action: z.literal("generate"), student_ids: Ids, days: z.number().int().min(1).max(365).nullable().default(30) }),
  z.object({ action: z.literal("send"), student_ids: Ids }),
  z.object({ action: z.literal("revoke_code"), student_id: z.string().uuid() }),
  z.object({ action: z.literal("revoke_access"), student_id: z.string().uuid(), user_id: z.string().uuid() }),
  // Download and print (separate from reading): the existing release switch.
  z.object({ action: z.literal("release"), student_ids: Ids, allowed: z.boolean() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin, "results");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  const audit = (action: string, meta: Record<string, unknown>) => svc.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action, meta });
  try {
    if (b.action === "generate") {
      const made = await makeTranscriptCodes(svc, { tenantId: tid, studentIds: b.student_ids, by: ctx.userId, days: b.days });
      await audit("transcript.codes_made", { count: made, days: b.days });
      return NextResponse.json({ ok: true, made });
    }
    if (b.action === "send") {
      const r = await sendTranscriptCodes(svc, { tenantId: tid, studentIds: b.student_ids, baseUrl: appUrl(req), actor: ctx.userId });
      await audit("transcript.codes_sent", { count: b.student_ids.length });
      return NextResponse.json({ ok: true, ...r });
    }
    if (b.action === "revoke_code") {
      const { error } = await svc.from("transcript_codes").update({ revoked_at: new Date().toISOString() }).eq("tenant_id", tid).eq("student_id", b.student_id).is("revoked_at", null);
      if (error) throw new Error(error.message);
      await audit("transcript.code_withdrawn", { student_id: b.student_id });
      return NextResponse.json({ ok: true });
    }
    if (b.action === "revoke_access") {
      const { error } = await svc.from("transcript_access").update({ revoked_at: new Date().toISOString() }).eq("tenant_id", tid).eq("student_id", b.student_id).eq("user_id", b.user_id);
      if (error) throw new Error(error.message);
      await audit("transcript.access_withdrawn", { student_id: b.student_id, user_id: b.user_id });
      return NextResponse.json({ ok: true });
    }
    for (const c of chunks(b.student_ids)) {
      const { error } = await svc.from("students").update({ transcript_allowed: b.allowed, transcript_allowed_by: ctx.userId, transcript_allowed_at: new Date().toISOString() })
        .eq("tenant_id", tid).in("id", c);
      if (error) throw new Error(error.message);
    }
    await audit(b.allowed ? "transcript.released" : "transcript.held", { count: b.student_ids.length });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const m = (e as Error).message;
    return jsonError(transcriptNeedsUpdate(m) ? "Transcript codes need the database update (migration 20260101010100)." : m);
  }
}
