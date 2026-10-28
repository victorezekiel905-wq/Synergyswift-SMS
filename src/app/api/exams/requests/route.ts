import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl, studentName } from "@/lib/school";
import { tellStaff } from "@/lib/hr-server";
import { computeDeadline } from "@/lib/exams/server";

export const dynamic = "force-dynamic";

const KIND = { extra_time: "extra time", late_sitting: "a late sitting", resit: "a resit", special_arrangement: "a special arrangement" } as const;

/**
 * Exam requests (phase 14j): extra time, a late sitting, a resit or a special arrangement.
 * GET ?status= : staff see all (the exams office decides); a parent or student sees their own.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(undefined, "exams");
  if (ctx instanceof NextResponse) return ctx;
  const status = new URL(req.url).searchParams.get("status");
  // For the family screen: the children this person can ask for, and each one's exams in the next 90 days (or the last 30, for resits).
  if (new URL(req.url).searchParams.get("view") === "options") {
    const svc = createServiceClient();
    const { data: kids } = ctx.roles.has("parent")
      ? await svc.from("student_guardians").select("students!inner(id,first_name,last_name,other_names,class_group_id,status,tenant_id),guardians!inner(user_id)").eq("guardians.user_id", ctx.userId).eq("students.tenant_id", ctx.tenant.id)
      : await svc.from("students").select("id,first_name,last_name,other_names,class_group_id,status,tenant_id").eq("tenant_id", ctx.tenant.id).eq("user_id", ctx.userId);
    const children = ((kids ?? []) as any[]).map(k => k.students ?? k).filter(c => c.status === "active");
    const from = new Date(Date.now() - 30 * 86_400_000).toISOString(), to = new Date(Date.now() + 90 * 86_400_000).toISOString();
    const out = [];
    for (const c of children) {
      const [{ data: exams }, { data: papers }] = await Promise.all([
        svc.from("exams").select("id,title,opens_at,closes_at,class_group_id").eq("tenant_id", ctx.tenant.id).in("status", ["published", "closed"])
          .or(`class_group_id.is.null,class_group_id.eq.${c.class_group_id ?? "00000000-0000-0000-0000-000000000000"}`).gte("closes_at", from).lte("opens_at", to).order("opens_at").limit(50),
        c.class_group_id ? svc.from("exam_papers").select("id,title,slot_date,exam_series!inner(status)").eq("tenant_id", ctx.tenant.id).eq("exam_series.status", "published")
          .contains("class_group_ids", [c.class_group_id]).gte("slot_date", from.slice(0, 10)).lte("slot_date", to.slice(0, 10)).order("slot_date").limit(50) : Promise.resolve({ data: [] })
      ]);
      out.push({ id: c.id, name: studentName(c), exams: (exams ?? []).map((e: any) => ({ id: e.id, title: e.title, at: e.opens_at })),
        papers: (papers ?? []).map((p: any) => ({ id: p.id, title: p.title, at: p.slot_date })) });
    }
    return NextResponse.json({ children: out });
  }
  let q = ctx.sb.from("exam_requests").select("*,students(first_name,last_name,other_names,admission_no,class_groups(name)),exams(title,opens_at,closes_at),exam_papers(title,slot_date)")
    .eq("tenant_id", ctx.tenant.id).order("created_at", { ascending: false }).limit(300);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) return NextResponse.json({ requests: [], ready: false, can_decide: false });
  return NextResponse.json({ ready: true, can_decide: hasAny(ctx, ROLES.examOffice), requests: (data ?? []).map((r: any) => ({
    ...r, student: studentName(r.students), class_name: r.students?.class_groups?.name ?? null, admission_no: r.students?.admission_no ?? null,
    exam: r.exams?.title ?? r.exam_papers?.title ?? null, students: undefined, exams: undefined, exam_papers: undefined })) });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), student_id: z.string().uuid(), exam_id: z.string().uuid().nullish(), paper_id: z.string().uuid().nullish(),
    kind: z.enum(["extra_time", "late_sitting", "resit", "special_arrangement"]), minutes: z.number().int().min(1).max(240).nullish(),
    opens_at: z.string().datetime({ offset: true }).nullish(), closes_at: z.string().datetime({ offset: true }).nullish(),
    arrangement: z.string().trim().max(200).nullish(), reason: z.string().trim().min(3).max(1000) }),
  z.object({ action: z.literal("cancel"), id: z.string().uuid() }),
  z.object({ action: z.literal("decide"), id: z.string().uuid(), approve: z.boolean(), note: z.string().trim().max(500).nullish(),
    minutes: z.number().int().min(1).max(240).nullish(), opens_at: z.string().datetime({ offset: true }).nullish(), closes_at: z.string().datetime({ offset: true }).nullish() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(undefined, "exams");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  const fail = (m: string) => jsonError(/row-level security/.test(m) ? "you cannot ask for this child" : m);

  if (b.action === "create") {
    if (!b.exam_id && !b.paper_id) return jsonError("choose the exam");
    if (b.kind === "extra_time" && !b.minutes) return jsonError("say how many extra minutes");
    if (b.kind === "late_sitting" && (!b.opens_at || !b.closes_at)) return jsonError("give the time the late sitting can start and end");
    if (b.kind === "special_arrangement" && !b.arrangement) return jsonError("describe the arrangement");
    const as = ctx.roles.has("parent") && !hasAny(ctx, ROLES.staff) ? "parent" : ctx.roles.has("student") ? "student" : "staff";
    const { data, error } = await ctx.sb.from("exam_requests").insert({ tenant_id: tid, student_id: b.student_id, exam_id: b.exam_id ?? null, paper_id: b.paper_id ?? null,
      kind: b.kind, minutes: b.minutes ?? null, opens_at: b.opens_at ?? null, closes_at: b.closes_at ?? null, arrangement: b.arrangement ?? null, reason: b.reason,
      requested_by: ctx.userId, requested_as: as }).select("id").single();
    if (error) return fail(error.message);
    const { data: office } = await svc.from("users").select("id,role,extra_roles").eq("tenant_id", tid).eq("active", true);
    const has = (u: any, r: string) => u.role === r || (u.extra_roles ?? []).includes(r);
    const officers = (office ?? []).filter((u: any) => has(u, "exam_officer")).map((u: any) => u.id);
    const to = officers.length ? officers : (office ?? []).filter((u: any) => has(u, "school_admin") || has(u, "principal")).map((u: any) => u.id);
    const { data: st } = await svc.from("students").select("first_name,last_name,other_names").eq("id", b.student_id).maybeSingle();
    await tellStaff(svc, tid, to, "exam_request", `Exam request: ${KIND[b.kind]} for ${studentName(st)}`, b.reason, `${appUrl(req)}/school/exams-office?tab=requests`, data.id).catch(() => null);
    return NextResponse.json({ ok: true, id: data.id });
  }
  if (b.action === "cancel") {
    const { data, error } = await ctx.sb.from("exam_requests").update({ status: "cancelled" }).eq("tenant_id", tid).eq("id", b.id).select("id");
    if (error) return fail(error.message);
    return data?.length ? NextResponse.json({ ok: true }) : jsonError("not found", 404);
  }
  // decide
  if (!hasAny(ctx, ROLES.examOffice)) return jsonError("only the exams office decides exam requests", 403);
  const { data: r } = await svc.from("exam_requests").select("*").eq("tenant_id", tid).eq("id", b.id).maybeSingle();
  if (!r) return jsonError("not found", 404);
  // The office may adjust what was asked for before approving it.
  const adjust = b.approve ? { ...(b.minutes ? { minutes: b.minutes } : {}), ...(b.opens_at ? { opens_at: b.opens_at } : {}), ...(b.closes_at ? { closes_at: b.closes_at } : {}) } : {};
  const { error } = await ctx.sb.from("exam_requests").update({ ...adjust, status: b.approve ? "approved" : "declined", decision_note: b.note ?? null }).eq("tenant_id", tid).eq("id", r.id);
  if (error) return jsonError(error.message);
  // Extra time approved while the candidate is already writing: their clock moves at once.
  if (b.approve && r.kind === "extra_time" && r.exam_id) {
    const { data: st } = await svc.from("students").select("user_id").eq("id", r.student_id).maybeSingle();
    const { data: a } = st?.user_id ? await svc.from("exam_attempts").select("id,status,started_at,extra_minutes").eq("exam_id", r.exam_id).eq("student_user_id", st.user_id).maybeSingle() : { data: null };
    const { data: exam } = await svc.from("exams").select("*").eq("id", r.exam_id).maybeSingle();
    if (a && exam && ["in_progress", "locked"].includes(a.status)) {
      const extra = (a.extra_minutes ?? 0) + (b.minutes ?? r.minutes ?? 0);
      await svc.from("exam_attempts").update({ extra_minutes: extra, deadline_at: computeDeadline(exam, new Date(a.started_at), extra).toISOString() }).eq("id", a.id);
      await svc.from("exam_requests").update({ used_at: new Date().toISOString() }).eq("id", r.id);
    }
  }
  if (r.requested_by) await tellStaff(svc, tid, [r.requested_by], "exam_request", `Exam request ${b.approve ? "approved" : "declined"}: ${KIND[r.kind as keyof typeof KIND]}`,
    b.note ?? (b.approve ? "It will apply automatically." : "Talk to the exams office if you have questions."), `${appUrl(req)}/school/exams-office?tab=requests`, r.id).catch(() => null);
  await svc.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "exams.request_decided", meta: { id: r.id, kind: r.kind, approve: b.approve } });
  return NextResponse.json({ ok: true });
}
