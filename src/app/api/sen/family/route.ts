import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { enqueue, staffRows } from "@/lib/messaging/outbox";

export const dynamic = "force-dynamic";

/**
 * SEN for families (phase 14h): a parent (when the school shares the profile) or the child sees
 * the support plan, says how each target is going, writes in the home–school book, agrees the
 * plan (parents) and asks for a review meeting. GET without ?student lists the children with plans.
 */
async function whoFor(ctx: any, studentId: string) {
  const [{ data: fam }, { data: me }] = await Promise.all([ctx.sb.rpc("sen_family_can", { p_student: studentId }), ctx.sb.rpc("sen_is_me", { p_student: studentId })]);
  return fam ? "parent" : me ? "student" : null;
}

export async function GET(req: NextRequest) {
  const ctx = await requireCtx(["parent", "student"]);
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  const studentId = new URL(req.url).searchParams.get("student");
  if (!studentId) {
    // Children I can see a plan for.
    const ids: string[] = [];
    if (ctx.roles.has("student")) { const { data } = await ctx.sb.from("students").select("id").eq("user_id", ctx.userId).maybeSingle(); if (data) ids.push(data.id); }
    if (ctx.roles.has("parent")) {
      const { data: g } = await ctx.sb.from("guardians").select("id").eq("user_id", ctx.userId);
      const { data: kids } = g?.length ? await svc.from("student_guardians").select("student_id").in("guardian_id", g.map((x: any) => x.id)) : { data: [] };
      ids.push(...(kids ?? []).map((k: any) => k.student_id));
    }
    const { data: profiles } = ids.length ? await svc.from("sen_profiles").select("student_id,share_with_parents,status,students(first_name,last_name)").eq("tenant_id", tid).in("student_id", ids).neq("status", "closed") : { data: [] };
    const visible = (profiles ?? []).filter((p: any) => p.share_with_parents || ctx.roles.has("student"));
    return NextResponse.json({ children: visible.map((p: any) => ({ id: p.student_id, name: `${p.students?.first_name ?? ""} ${p.students?.last_name ?? ""}`.trim() })) });
  }
  const who = await whoFor(ctx, studentId);
  if (!who) return jsonError("not found", 404);
  const [{ data: profile }, { data: plan }, { data: student }] = await Promise.all([
    svc.from("sen_profiles").select("status,summary,strengths,strategies,extra_time_pct,arrangements,coordinator_id,users:coordinator_id(full_name)").eq("student_id", studentId).maybeSingle(),
    svc.from("ieps").select("id,title,starts_on,review_on,status,student_voice,parent_views,parent_agreed_at,parent_agreed_name,iep_targets(id,area,target,strategies,success_criteria,progress,position)")
      .eq("tenant_id", tid).eq("student_id", studentId).eq("status", "active").order("starts_on", { ascending: false }).limit(1).maybeSingle(),
    svc.from("students").select("first_name,last_name").eq("id", studentId).maybeSingle()
  ]);
  const targetIds = ((plan as any)?.iep_targets ?? []).map((t: any) => t.id);
  const [{ data: feedback }, { data: notes }] = await Promise.all([
    targetIds.length ? ctx.sb.from("iep_target_feedback").select("target_id,author_kind,author_name,rating,comment,created_at").in("target_id", targetIds).order("created_at", { ascending: false }).limit(300) : { data: [] },
    ctx.sb.from("sen_home_notes").select("id,author_kind,author_name,kind,body,mood,created_at,read_by_staff_at").eq("student_id", studentId).order("created_at", { ascending: false }).limit(100)
  ]);
  // The family has now read the school's notes.
  const unread = (notes ?? []).filter((n: any) => n.author_kind === "staff").map((n: any) => n.id);
  if (unread.length) await svc.from("sen_home_notes").update({ read_by_family_at: new Date().toISOString() }).in("id", unread).is("read_by_family_at", null);
  return NextResponse.json({
    who, student: student ? `${student.first_name} ${student.last_name}` : "",
    // Staff-only notes (e.g. agencies) never leave the school.
    profile: profile ? { summary: who === "parent" ? profile.summary : null, strengths: profile.strengths, strategies: profile.strategies, extra_time_pct: profile.extra_time_pct,
      arrangements: profile.arrangements, coordinator: (profile as any).users?.full_name ?? null } : null,
    plan: plan ? { ...plan, iep_targets: [...((plan as any).iep_targets ?? [])].sort((a: any, b: any) => a.position - b.position) } : null,
    feedback: feedback ?? [], notes: notes ?? []
  });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("note"), student_id: z.string().uuid(), body: z.string().trim().min(1).max(4000), mood: z.number().int().min(1).max(5).nullish(), meeting: z.boolean().default(false) }),
  z.object({ action: z.literal("feedback"), student_id: z.string().uuid(), target_id: z.string().uuid(), rating: z.number().int().min(1).max(5), comment: z.string().trim().max(1000).nullish() }),
  z.object({ action: z.literal("agree"), student_id: z.string().uuid(), iep_id: z.string().uuid(), name: z.string().trim().min(2).max(120), views: z.string().trim().max(4000).nullish() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(["parent", "student"]);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const who = await whoFor(ctx, b.student_id);
  if (!who) return jsonError("not found", 404);
  const svc = createServiceClient();
  const name = ctx.profile.full_name;
  // The SEN coordinator (or the SEN team) hears about it.
  const tell = async (subject: string, text: string) => {
    const { data: p } = await svc.from("sen_profiles").select("coordinator_id").eq("student_id", b.student_id).maybeSingle();
    let to = p?.coordinator_id ? [p.coordinator_id] : [];
    if (!to.length) { const { data } = await svc.from("users").select("id").eq("tenant_id", tid).eq("active", true).in("role", ["counsellor", "principal"]).limit(5); to = (data ?? []).map((u: any) => u.id); }
    const rows = await staffRows(svc, { tenantId: tid, userIds: to, kind: "sen", refId: b.student_id, subject, text, url: `${appUrl(req)}/school/students/${b.student_id}#sen` });
    if (rows.length) await enqueue(svc, rows);
  };
  switch (b.action) {
    case "note": {
      if (b.meeting && who !== "parent") return jsonError("Ask your teacher about a meeting.");
      const { error } = await ctx.sb.from("sen_home_notes").insert({ tenant_id: tid, student_id: b.student_id, author_kind: who, author_user_id: ctx.userId, author_name: name,
        kind: b.meeting ? "meeting_request" : "note", body: b.body, mood: b.mood ?? null });
      if (error) return jsonError(error.message);
      await tell(b.meeting ? `${name} asked for a support plan meeting` : `${name} wrote in the home–school book`, b.body).catch(() => null);
      return NextResponse.json({ ok: true });
    }
    case "feedback": {
      const { data: owner } = await ctx.sb.rpc("iep_target_student", { p_target: b.target_id });
      if (owner !== b.student_id) return jsonError("not found", 404);
      const { error } = await ctx.sb.from("iep_target_feedback").insert({ tenant_id: tid, target_id: b.target_id, author_kind: who, author_user_id: ctx.userId, author_name: name, rating: b.rating, comment: b.comment ?? null });
      return error ? jsonError(error.message) : NextResponse.json({ ok: true });
    }
    case "agree": {
      if (who !== "parent") return jsonError("Only a parent can agree the plan.", 403);
      const { data, error } = await svc.from("ieps").update({ parent_agreed_at: new Date().toISOString(), parent_agreed_name: b.name, parent_agreed_by: ctx.userId,
        ...(b.views ? { parent_views: b.views } : {}), updated_at: new Date().toISOString() }).eq("tenant_id", tid).eq("id", b.iep_id).eq("student_id", b.student_id).eq("status", "active").select("id");
      if (error) return jsonError(error.message);
      if (!data?.length) return jsonError("There is no active plan to agree.");
      await tell(`${name} agreed the support plan`, b.views ?? "No comments.").catch(() => null);
      return NextResponse.json({ ok: true });
    }
  }
}
