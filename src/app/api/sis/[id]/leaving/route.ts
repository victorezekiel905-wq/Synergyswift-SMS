import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny, denyUnless } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { clearanceFor, leaveSchool, recordMovement, reinstate } from "@/lib/sis-server";
import { LEAVING_KINDS } from "@/lib/sis";

export const dynamic = "force-dynamic";

/** The enrolment history and, for admins, the leaving checklist. */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const ctx = await requireCtx(ROLES.staff, "sims");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const [{ data: s }, { data: moves }] = await Promise.all([
    ctx.sb.from("students").select("id,status,admitted_on,previous_school,left_on,leaving_kind,leaving_reason,destination_school").eq("tenant_id", tid).eq("id", id).maybeSingle(),
    ctx.sb.from("student_movements").select("*,users:recorded_by(full_name)").eq("tenant_id", tid).eq("student_id", id).order("effective_on", { ascending: false }).order("created_at", { ascending: false })
  ]);
  if (!s) return jsonError("not found", 404);
  const admin = hasAny(ctx, ROLES.admin);
  return NextResponse.json({ student: s, movements: moves ?? [], clearance: admin ? await clearanceFor(createServiceClient(), tid, id) : null, admin });
}

const d = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("leave"), kind: z.enum(LEAVING_KINDS), left_on: d, reason: z.string().trim().max(500).nullish(), destination: z.string().trim().max(160).nullish(),
    notes: z.string().trim().max(1000).nullish(), add_to_alumni: z.boolean().default(false) }),
  z.object({ action: z.literal("reinstate"), class_group_id: z.string().uuid().nullable(), reason: z.string().trim().max(500).nullish() }),
  z.object({ action: z.literal("admission"), admitted_on: d.nullish(), previous_school: z.string().trim().max(160).nullish() }),
  z.object({ action: z.literal("note"), kind: z.enum(["suspended", "other"]), effective_on: d, reason: z.string().trim().min(2).max(500), notes: z.string().trim().max(1000).nullish() })
]);

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const ctx = await requireCtx(ROLES.admin, "sims");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  try {
    switch (b.action) {
      case "leave": {
        { const denied = denyUnless(ctx, "students.remove"); if (denied) return denied; }
        const r = await leaveSchool(ctx.sb, svc, { tenantId: tid, studentId: id, kind: b.kind, leftOn: b.left_on, reason: b.reason, destination: b.destination, notes: b.notes, actorId: ctx.userId, addToAlumni: b.add_to_alumni });
        await ctx.sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "student.left", target: id, meta: { kind: b.kind } });
        return NextResponse.json(r);
      }
      case "reinstate":
        return NextResponse.json(await reinstate(ctx.sb, svc, { tenantId: tid, studentId: id, classGroupId: b.class_group_id, reason: b.reason, actorId: ctx.userId }));
      case "admission": {
        const { error } = await ctx.sb.from("students").update({ admitted_on: b.admitted_on ?? null, previous_school: b.previous_school ?? null }).eq("tenant_id", tid).eq("id", id);
        return error ? jsonError(error.message) : NextResponse.json({ ok: true });
      }
      case "note": {
        if (b.kind === "suspended") {
          const { error } = await ctx.sb.from("students").update({ status: "suspended" }).eq("tenant_id", tid).eq("id", id).eq("status", "active");
          if (error) return jsonError(error.message);
        }
        const { error } = await recordMovement(ctx.sb, { tenantId: tid, studentId: id, kind: b.kind, effectiveOn: b.effective_on, reason: b.reason, notes: b.notes, recordedBy: ctx.userId });
        return error ? jsonError(error.message) : NextResponse.json({ ok: true });
      }
    }
  } catch (e) { return jsonError((e as Error).message); }
}
