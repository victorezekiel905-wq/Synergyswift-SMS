import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny, type Ctx } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { assistConfigured, tutorReply, assistErrorMessage, type TutorTurn } from "@/lib/assist";
import { appUrl } from "@/lib/school";
import { POINTS } from "@/lib/lms";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

async function settings(svc: any, tid: string) {
  const { data } = await svc.from("tenant_settings").select("ai_tutor_enabled,ai_tutor_daily_limit,school_name").eq("tenant_id", tid).maybeSingle();
  return { enabled: Boolean(data?.ai_tutor_enabled) && assistConfigured(), switchedOn: Boolean(data?.ai_tutor_enabled), limit: data?.ai_tutor_daily_limit ?? 30, school: data?.school_name ?? null, available: assistConfigured() };
}
const startOfDay = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString(); };

async function usedToday(svc: any, studentId: string) {
  const { data: convs } = await svc.from("tutor_conversations").select("id").eq("student_id", studentId).gte("updated_at", startOfDay());
  if (!convs?.length) return 0;
  const { count } = await svc.from("tutor_messages").select("id", { count: "exact", head: true }).eq("role", "student").in("conversation_id", convs.map((c: any) => c.id)).gte("created_at", startOfDay());
  return count ?? 0;
}

/**
 * Students: their chats (?id= one with messages). Staff and parents: a
 * student's chats (?student_id=), and for staff, chats flagged with a concern (?flagged=1).
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(undefined, "lms");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const u = new URL(req.url).searchParams;
  const svc = createServiceClient();
  const s = await settings(svc, tid);
  const id = u.get("id");
  if (id) {
    const { data: conv } = await ctx.sb.from("tutor_conversations").select("id,title,student_id,context,concern,reviewed_at,created_at,updated_at,subjects(name),students(first_name,last_name)").eq("tenant_id", tid).eq("id", id).maybeSingle();
    if (!conv) return jsonError("not found", 404);
    const { data: msgs } = await ctx.sb.from("tutor_messages").select("id,role,content,created_at").eq("conversation_id", id).order("id");
    return NextResponse.json({ conversation: conv, messages: msgs ?? [] });
  }
  const cols = "id,title,student_id,concern,concern_at,reviewed_at,updated_at,subjects(name),students(first_name,last_name,class_groups(name))";
  if (hasAny(ctx, ROLES.staff)) {
    if (u.get("flagged")) {
      const { data } = await ctx.sb.from("tutor_conversations").select(cols).eq("tenant_id", tid).not("concern", "is", null).order("concern_at", { ascending: false }).limit(200);
      return NextResponse.json({ items: data ?? [], settings: s, admin: hasAny(ctx, ROLES.admin) });
    }
    if (u.get("student_id")) {
      const { data } = await ctx.sb.from("tutor_conversations").select(cols).eq("tenant_id", tid).eq("student_id", u.get("student_id")).order("updated_at", { ascending: false }).limit(200);
      return NextResponse.json({ items: data ?? [], settings: s });
    }
    // Overview for the AI tutor settings page.
    const since = new Date(Date.now() - 7 * 86400_000).toISOString();
    const { data: recent } = await ctx.sb.from("tutor_conversations").select(cols).eq("tenant_id", tid).gte("updated_at", since).order("updated_at", { ascending: false }).limit(100);
    return NextResponse.json({ items: recent ?? [], settings: s, admin: hasAny(ctx, ROLES.admin) });
  }
  if (u.get("student_id")) {
    const { data } = await ctx.sb.from("tutor_conversations").select(cols).eq("tenant_id", tid).eq("student_id", u.get("student_id")).order("updated_at", { ascending: false }).limit(100);
    return NextResponse.json({ items: data ?? [], settings: { enabled: s.enabled } });
  }
  const { data: me } = await svc.from("students").select("id").eq("tenant_id", tid).eq("user_id", ctx.userId).maybeSingle();
  if (!me) return NextResponse.json({ items: [], settings: { enabled: false } });
  const { data } = await ctx.sb.from("tutor_conversations").select("id,title,updated_at,subjects(name)").eq("student_id", me.id).order("updated_at", { ascending: false }).limit(100);
  return NextResponse.json({ items: data ?? [], settings: { enabled: s.enabled, limit: s.limit, used: await usedToday(svc, me.id) } });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("send"), conversation_id: z.string().uuid().nullish(), text: z.string().trim().min(1).max(4000), subject_id: z.string().uuid().nullish(),
    context: z.object({ kind: z.enum(["homework", "step"]), ref_id: z.string().uuid() }).nullish() }),
  z.object({ action: z.literal("review"), id: z.string().uuid() }),
  z.object({ action: z.literal("settings"), enabled: z.boolean(), daily_limit: z.number().int().min(1).max(500) })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(undefined, "lms");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  if (b.action === "settings") {
    if (!hasAny(ctx, ROLES.admin)) return jsonError("only admins can change this", 403);
    const { error } = await svc.from("tenant_settings").upsert({ tenant_id: tid, ai_tutor_enabled: b.enabled, ai_tutor_daily_limit: b.daily_limit }, { onConflict: "tenant_id" });
    if (error) return jsonError(error.message);
    await ctx.sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: b.enabled ? "tutor.enabled" : "tutor.disabled", meta: { daily_limit: b.daily_limit } });
    return NextResponse.json({ ok: true });
  }
  if (b.action === "review") {
    if (!hasAny(ctx, ROLES.staff)) return jsonError("forbidden", 403);
    const { data, error } = await ctx.sb.from("tutor_conversations").update({ reviewed_at: new Date().toISOString() }).eq("tenant_id", tid).eq("id", b.id).select("id").maybeSingle();
    return error || !data ? jsonError(error?.message ?? "not found", 404) : NextResponse.json({ ok: true });
  }
  return send(ctx, svc, b, req);
}

async function send(ctx: Ctx, svc: any, b: Extract<z.infer<typeof Body>, { action: "send" }>, req: NextRequest) {
  const tid = ctx.tenant.id;
  const s = await settings(svc, tid);
  if (!s.enabled) return jsonError("The study helper is not switched on for your school.", 403);
  const { data: me } = await svc.from("students").select("id,class_group_id,first_name,class_groups(name,level)").eq("tenant_id", tid).eq("user_id", ctx.userId).maybeSingle();
  if (!me) return jsonError("only students can use the study helper", 403);
  if (await usedToday(svc, me.id) >= s.limit) return jsonError(`You have asked ${s.limit} questions today, which is your school's daily limit. Try again tomorrow.`, 429);

  let conv: any = null;
  if (b.conversation_id) {
    ({ data: conv } = await svc.from("tutor_conversations").select("id,title,context,subject_id,concern").eq("id", b.conversation_id).eq("student_id", me.id).maybeSingle());
    if (!conv) return jsonError("not found", 404);
  } else {
    // Context is loaded here, never taken from the student's browser.
    let context: Record<string, unknown> = {};
    let subject = b.subject_id ?? null;
    if (b.context?.kind === "homework") {
      const { data: hw } = await svc.from("homework").select("id,title,instructions,subject_id,class_group_id").eq("id", b.context.ref_id).eq("tenant_id", tid).maybeSingle();
      if (hw && hw.class_group_id === me.class_group_id) { context = { kind: "homework", ref_id: hw.id, title: hw.title, text: hw.instructions ?? "" }; subject = hw.subject_id ?? subject; }
    } else if (b.context?.kind === "step") {
      const { data: st } = await svc.from("learning_path_steps").select("id,title,body,learning_paths!inner(subject_id,status,class_group_ids)").eq("id", b.context.ref_id).eq("tenant_id", tid).maybeSingle();
      const lp = st?.learning_paths as any;
      if (st && lp?.status === "published" && (lp.class_group_ids ?? []).includes(me.class_group_id)) { context = { kind: "learning step", ref_id: st.id, title: st.title, text: st.body ?? "" }; subject = lp.subject_id ?? subject; }
    }
    const { data: created, error } = await svc.from("tutor_conversations").insert({ tenant_id: tid, student_id: me.id, user_id: ctx.userId, subject_id: subject, context, title: b.text.slice(0, 60) })
      .select("id,title,context,subject_id,concern").single();
    if (error) return jsonError(error.message);
    conv = created;
  }
  await svc.from("tutor_messages").insert({ tenant_id: tid, conversation_id: conv.id, role: "student", content: b.text });
  const { data: hist } = await svc.from("tutor_messages").select("role,content").eq("conversation_id", conv.id).order("id", { ascending: false }).limit(24);
  const { data: subj } = conv.subject_id ? await svc.from("subjects").select("name").eq("id", conv.subject_id).maybeSingle() : { data: null };
  const { data: tenant } = await svc.from("tenants").select("name").eq("id", tid).maybeSingle();
  try {
    const cls = me.class_groups as any;
    const out = await tutorReply({ level: cls?.level || cls?.name || null, subject: subj?.name ?? null, schoolName: s.school ?? tenant?.name ?? "school",
      context: conv.context?.title ? { kind: String(conv.context.kind), title: String(conv.context.title), text: String(conv.context.text ?? "") } : null,
      history: ((hist ?? []) as TutorTurn[]).reverse() });
    const now = new Date().toISOString();
    await svc.from("tutor_messages").insert({ tenant_id: tid, conversation_id: conv.id, role: "tutor", content: out.reply.slice(0, 20000) || "…" });
    const patch: Record<string, unknown> = { updated_at: now };
    if (!b.conversation_id && out.title) patch.title = out.title.slice(0, 80);
    // Concerns only ever go up, and the school is told straight away.
    const rank = { none: 0, wellbeing: 1, safety: 2 } as const;
    const raised = out.concern !== "none" && rank[out.concern] > rank[(conv.concern ?? "none") as keyof typeof rank];
    if (raised) Object.assign(patch, { concern: out.concern, concern_at: now, reviewed_at: null, reviewed_by: null });
    await svc.from("tutor_conversations").update(patch).eq("id", conv.id);
    if (raised) await alertStaff(svc, tid, me, conv.id, out.concern as "wellbeing" | "safety", appUrl(req));
    await svc.from("learning_activity").upsert({ tenant_id: tid, student_id: me.id, kind: "tutor", points: POINTS.tutor, ref_id: conv.id }, { onConflict: "student_id,kind,ref_id", ignoreDuplicates: true });
    return NextResponse.json({ conversation_id: conv.id, reply: out.reply, title: patch.title ?? conv.title });
  } catch (e) {
    const { message, status } = assistErrorMessage(e);
    return jsonError(message.replace(/^Drafting/, "The study helper"), status);
  }
}

/** Counsellors, admins and the form teacher hear about a safety or wellbeing concern at once. */
async function alertStaff(svc: any, tid: string, me: any, convId: string, concern: "wellbeing" | "safety", base: string) {
  const [{ data: staff }, { data: cls }] = await Promise.all([
    svc.from("users").select("id,role,extra_roles").eq("tenant_id", tid),
    me.class_group_id ? svc.from("class_groups").select("form_teacher_id").eq("id", me.class_group_id).maybeSingle() : { data: null }
  ]);
  const roles = (u: any) => [u.role, ...(u.extra_roles ?? [])];
  const ids = new Set<string>((staff ?? []).filter((u: any) => roles(u).some((r: string) => ["counsellor", "principal", "school_admin"].includes(r))).map((u: any) => u.id));
  if (cls?.form_teacher_id) ids.add(cls.form_teacher_id);
  const { staffRows, enqueue, tryDispatch } = await import("@/lib/messaging/outbox");
  const rows = await staffRows(svc, { tenantId: tid, userIds: [...ids], kind: "tutor_concern", refId: convId,
    subject: concern === "safety" ? `Safety concern: ${me.first_name}` : `Wellbeing concern: ${me.first_name}`,
    text: `Something ${me.first_name} wrote to the study helper may need a member of staff. Please read the conversation today.`, url: `${base}/school/learning?tab=tutor&conversation=${convId}` });
  if (rows.length) { await enqueue(svc, rows); await tryDispatch(svc, { budgetMs: 3000 }); }
  await svc.from("audit_logs").insert({ tenant_id: tid, actor_id: null, action: `tutor.concern_${concern}`, meta: { conversation_id: convId, student_id: me.id } });
}
