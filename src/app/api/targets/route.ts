import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { targetsFor } from "@/lib/portfolio-server";

export const dynamic = "force-dynamic";

/**
 * Targets (phase 14o). GET ?student= : a student's targets with where they stand (staff, the student, their parents);
 * GET ?class= : the class's targets. Staff set and remove them.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(undefined);
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url).searchParams;
  const tid = ctx.tenant.id;
  if (u.get("class")) {
    const { data, error } = await ctx.sb.from("class_targets").select("*,terms(name)").eq("tenant_id", tid).eq("class_group_id", u.get("class")).order("created_at", { ascending: false });
    return NextResponse.json({ targets: error ? [] : data ?? [] });
  }
  const student = u.get("student");
  if (!student) return jsonError("choose a student");
  const { data: st } = await ctx.sb.from("students").select("id").eq("tenant_id", tid).eq("id", student).maybeSingle();
  if (!st) return jsonError("not found", 404);
  return NextResponse.json({ targets: await targetsFor(ctx.sb, tid, student) });
}

const pct = z.number().min(0).max(100);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("student"), student_id: z.string().uuid(), kind: z.enum(["average", "subject_score", "attendance", "personal"]), target: pct.nullish(),
    subject_id: z.string().uuid().nullish(), term_id: z.string().uuid().nullish(), description: z.string().trim().max(300).nullish() }),
  z.object({ action: z.literal("class"), class_group_id: z.string().uuid(), kind: z.enum(["average", "attendance", "pass_rate", "other"]), target: pct.nullish(),
    term_id: z.string().uuid().nullish(), description: z.string().trim().max(300).nullish() }),
  z.object({ action: z.literal("status"), id: z.string().uuid(), status: z.enum(["active", "met", "missed", "dropped"]) }),
  z.object({ action: z.literal("delete"), id: z.string().uuid(), class: z.boolean().default(false) })
]);

/** Staff set targets; the writes use the service role after these checks (students and classes are checked through the person's own access). */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  if (b.action === "student") {
    if (b.kind !== "personal" && b.target == null) return jsonError("give the target figure");
    if (b.kind === "subject_score" && !b.subject_id) return jsonError("choose the subject");
    const { data: st } = await ctx.sb.from("students").select("id").eq("tenant_id", tid).eq("id", b.student_id).maybeSingle();
    if (!st) return jsonError("not found", 404);
    const { error } = await svc.from("student_targets").insert({ tenant_id: tid, student_id: b.student_id, kind: b.kind, target: b.target ?? null, subject_id: b.subject_id ?? null,
      term_id: b.term_id ?? null, description: b.description ?? null, set_by: ctx.userId, set_by_kind: "staff" });
    return error ? jsonError(error.message) : NextResponse.json({ ok: true }, { status: 201 });
  }
  if (b.action === "class") {
    const { data: g } = await ctx.sb.from("class_groups").select("id").eq("tenant_id", tid).eq("id", b.class_group_id).maybeSingle();
    if (!g) return jsonError("not found", 404);
    const { error } = await svc.from("class_targets").insert({ tenant_id: tid, class_group_id: b.class_group_id, kind: b.kind, target: b.target ?? null, term_id: b.term_id ?? null,
      description: b.description ?? null, set_by: ctx.userId });
    return error ? jsonError(error.message) : NextResponse.json({ ok: true }, { status: 201 });
  }
  if (b.action === "status") {
    const { error } = await svc.from("student_targets").update({ status: b.status }).eq("tenant_id", tid).eq("id", b.id);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  const { error } = await svc.from(b.class ? "class_targets" : "student_targets").delete().eq("tenant_id", tid).eq("id", b.id);
  return error ? jsonError(error.message) : NextResponse.json({ ok: true });
}
