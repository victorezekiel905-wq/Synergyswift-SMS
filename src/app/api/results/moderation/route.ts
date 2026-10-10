import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";

/**
 * Score moderation.
 *  GET ?term_id=&class_group_id=  status of every subject's sheet in a class
 *  GET ?term_id=&queue=1          sheets waiting for the caller (HOD or admin)
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "results");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url);
  const termId = u.searchParams.get("term_id"), cg = u.searchParams.get("class_group_id");
  if (!termId) return jsonError("term_id is required");
  const tid = ctx.tenant.id;
  const isAdmin = hasAny(ctx, ROLES.admin);
  const { data: settings } = await ctx.sb.from("tenant_settings").select("require_moderation").eq("tenant_id", tid).maybeSingle();
  const { data: myDepts } = await ctx.sb.from("departments").select("id").eq("tenant_id", tid).eq("head_user_id", ctx.userId);
  const hodOf = new Set((myDepts ?? []).map((d: any) => d.id));

  if (u.searchParams.get("queue")) {
    const { data: sheets } = await ctx.sb.from("score_sheets")
      .select("id,term_id,class_group_id,subject_id,status,submitted_at,hod_at,note,class_groups(name),subjects(name,department_id),submitted:users!score_sheets_submitted_by_fkey(full_name)")
      .eq("tenant_id", tid).eq("term_id", termId).in("status", ["submitted", "hod_approved"]).order("submitted_at");
    const queue = (sheets ?? []).filter((s: any) =>
      (s.status === "submitted" && hodOf.has(s.subjects?.department_id)) || (isAdmin && (s.status === "hod_approved" || s.status === "submitted")));
    return NextResponse.json({
      moderation: Boolean(settings?.require_moderation), is_admin: isAdmin, is_hod: hodOf.size > 0,
      queue: queue.map((s: any) => ({
        id: s.id, class_group_id: s.class_group_id, subject_id: s.subject_id, status: s.status, submitted_at: s.submitted_at, hod_at: s.hod_at,
        class_name: s.class_groups?.name, subject: s.subjects?.name, submitted_by: s.submitted?.full_name ?? null,
        my_step: s.status === "submitted" && hodOf.has(s.subjects?.department_id) ? "hod" : "final"
      }))
    });
  }

  if (!cg) return jsonError("class_group_id is required");
  const [{ data: offered }, { data: sheets }] = await Promise.all([
    ctx.sb.from("subject_offerings").select("subject_id,teacher_id,subjects(name,department_id)").eq("tenant_id", tid).eq("class_group_id", cg),
    ctx.sb.from("score_sheets").select("id,subject_id,status,note,submitted_at,hod_at,approved_at,score_sheet_events(action,note,at,users(full_name))")
      .eq("tenant_id", tid).eq("term_id", termId).eq("class_group_id", cg)
  ]);
  const bySubject = new Map((sheets ?? []).map((s: any) => [s.subject_id, s]));
  return NextResponse.json({
    moderation: Boolean(settings?.require_moderation), is_admin: isAdmin,
    sheets: (offered ?? []).map((o: any) => {
      const s: any = bySubject.get(o.subject_id);
      return {
        subject_id: o.subject_id, subject: o.subjects?.name, status: s?.status ?? "draft", note: s?.note ?? null,
        submitted_at: s?.submitted_at ?? null, hod_at: s?.hod_at ?? null, approved_at: s?.approved_at ?? null,
        i_teach: o.teacher_id === ctx.userId, i_am_hod: hodOf.has(o.subjects?.department_id),
        history: (s?.score_sheet_events ?? []).sort((a: any, b: any) => a.at.localeCompare(b.at)).map((e: any) => ({ action: e.action, note: e.note, at: e.at, by: e.users?.full_name ?? null }))
      };
    }).sort((a: any, b: any) => String(a.subject).localeCompare(String(b.subject)))
  });
}

const Body = z.object({
  term_id: z.string().uuid(), class_group_id: z.string().uuid(), subject_id: z.string().uuid(),
  action: z.enum(["submit", "hod_approve", "approve", "return"]), note: z.string().trim().max(1000).nullish()
});

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "results");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const { data, error } = await ctx.sb.rpc("moderate_score_sheet", { p_term: b.term_id, p_class: b.class_group_id, p_subject: b.subject_id, p_action: b.action, p_note: b.note ?? null });
  if (error) return jsonError(error.message, 403);
  await ctx.sb.from("audit_logs").insert({ tenant_id: ctx.tenant.id, actor_id: ctx.userId, action: `scores.${b.action}`, target: b.class_group_id, meta: { term_id: b.term_id, subject_id: b.subject_id } });
  return NextResponse.json(data);
}
