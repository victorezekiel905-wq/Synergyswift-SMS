import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { languageProblem, POINTS } from "@/lib/lms";

export const dynamic = "force-dynamic";
const PEOPLE = [...ROLES.staff, "student"];

/** Forums the caller can use; ?forum= its threads; ?thread= the posts. Row-level security decides what is visible. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(PEOPLE);
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const u = new URL(req.url).searchParams;
  const staff = hasAny(ctx, ROLES.staff);
  const thread = u.get("thread");
  if (thread) {
    const { data: t } = await ctx.sb.from("forum_threads").select("*,users:author_id(full_name,role),forums(id,title,locked)").eq("tenant_id", tid).eq("id", thread).maybeSingle();
    if (!t) return jsonError("not found", 404);
    const { data: posts } = await ctx.sb.from("forum_posts").select("id,body,hidden,hidden_reason,edited_at,created_at,author_id,users:author_id(full_name,role)").eq("thread_id", thread).order("created_at").limit(1000);
    return NextResponse.json({ thread: t, posts: posts ?? [], staff, me: ctx.userId });
  }
  const forum = u.get("forum");
  if (forum) {
    const [{ data: f }, { data: threads }] = await Promise.all([
      ctx.sb.from("forums").select("*,class_groups(name),subjects(name)").eq("tenant_id", tid).eq("id", forum).maybeSingle(),
      ctx.sb.from("forum_threads").select("id,title,pinned,locked,hidden,post_count,last_post_at,created_at,author_id,users:author_id(full_name,role)").eq("forum_id", forum)
        .order("pinned", { ascending: false }).order("last_post_at", { ascending: false }).limit(300)
    ]);
    if (!f) return jsonError("not found", 404);
    return NextResponse.json({ forum: f, threads: threads ?? [], staff, me: ctx.userId });
  }
  const [{ data: forums }, { data: reports }] = await Promise.all([
    ctx.sb.from("forums").select("id,kind,title,description,locked,class_group_id,class_groups(name),subjects(name),forum_threads(count)").eq("tenant_id", tid).order("kind").order("title"),
    staff ? ctx.sb.from("forum_reports").select("id,reason,created_at,post_id,thread_id,forum_posts(body,thread_id),forum_threads(title),users:reporter_id(full_name)").eq("tenant_id", tid).is("resolved_at", null).order("created_at", { ascending: false }).limit(100) : { data: [] }
  ]);
  return NextResponse.json({ forums: forums ?? [], reports: reports ?? [], staff });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_forum"), kind: z.enum(["class", "school", "staff"]), class_group_id: z.string().uuid().nullish(), subject_id: z.string().uuid().nullish(),
    title: z.string().trim().min(2).max(120), description: z.string().trim().max(500).nullish() }),
  z.object({ action: z.literal("class_forums") }),
  z.object({ action: z.literal("lock_forum"), id: z.string().uuid(), locked: z.boolean() }),
  z.object({ action: z.literal("thread"), forum_id: z.string().uuid(), title: z.string().trim().min(2).max(160), body: z.string().trim().min(1).max(20000) }),
  z.object({ action: z.literal("reply"), thread_id: z.string().uuid(), body: z.string().trim().min(1).max(20000) }),
  z.object({ action: z.literal("edit"), post_id: z.string().uuid(), body: z.string().trim().min(1).max(20000) }),
  z.object({ action: z.literal("moderate"), post_id: z.string().uuid().nullish(), thread_id: z.string().uuid().nullish(), hide: z.boolean(), reason: z.string().trim().max(300).nullish() }),
  z.object({ action: z.literal("thread_flags"), thread_id: z.string().uuid(), pinned: z.boolean().optional(), locked: z.boolean().optional() }),
  z.object({ action: z.literal("report"), post_id: z.string().uuid().nullish(), thread_id: z.string().uuid().nullish(), reason: z.string().trim().min(2).max(500) }),
  z.object({ action: z.literal("resolve_report"), id: z.string().uuid() }),
  z.object({ action: z.literal("delete_thread"), thread_id: z.string().uuid() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(PEOPLE);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const sb = ctx.sb;
  const staff = hasAny(ctx, ROLES.staff);
  const svc = createServiceClient();
  const refuse = (e: any) => jsonError(/row-level security|closed/.test(e?.message ?? "") ? (e.message.includes("closed") ? "this discussion is closed" : "you cannot post here") : e?.message ?? "not found", e ? 403 : 404);

  // Students: polite language and a sensible pace.
  const studentChecks = async (text: string) => {
    if (staff) return null;
    const problem = languageProblem(text);
    if (problem) return problem;
    const { count } = await svc.from("forum_posts").select("id", { count: "exact", head: true }).eq("author_id", ctx.userId).gte("created_at", new Date(Date.now() - 10 * 60_000).toISOString());
    return (count ?? 0) >= 10 ? "you are posting very quickly; please wait a few minutes" : null;
  };
  const credit = async (ref: string) => {
    if (staff) return;
    const { data: st } = await svc.from("students").select("id").eq("tenant_id", tid).eq("user_id", ctx.userId).maybeSingle();
    if (st) await svc.from("learning_activity").insert({ tenant_id: tid, student_id: st.id, kind: "forum", points: POINTS.forum, ref_id: ref });
  };

  switch (b.action) {
    case "create_forum": {
      if (!staff) return jsonError("only staff create forums", 403);
      if (b.kind === "class" && !b.class_group_id) return jsonError("choose the class");
      const { data, error } = await sb.from("forums").insert({ tenant_id: tid, kind: b.kind, class_group_id: b.kind === "class" ? b.class_group_id : null, subject_id: b.subject_id ?? null,
        title: b.title, description: b.description ?? null, created_by: ctx.userId }).select("id").single();
      return error ? jsonError(error.message) : NextResponse.json({ ok: true, id: data.id }, { status: 201 });
    }
    case "class_forums": {
      // One discussion forum per class the teacher teaches (or every class, for admins), if it has none yet.
      if (!staff) return jsonError("only staff create forums", 403);
      const admin = hasAny(ctx, ROLES.admin);
      const { data: offer } = admin ? await sb.from("class_groups").select("id,name").eq("tenant_id", tid)
        : await sb.from("subject_offerings").select("class_groups(id,name)").eq("tenant_id", tid).eq("teacher_id", ctx.userId);
      const classes = new Map<string, string>();
      for (const o of offer ?? []) { const c = (o as any).class_groups ?? o; if (c?.id) classes.set(c.id, c.name); }
      const { data: have } = await sb.from("forums").select("class_group_id").eq("tenant_id", tid).eq("kind", "class");
      const exists = new Set((have ?? []).map((f: any) => f.class_group_id));
      const rows = [...classes].filter(([id]) => !exists.has(id)).map(([id, name]) => ({ tenant_id: tid, kind: "class", class_group_id: id, title: `${name} discussion`, created_by: ctx.userId }));
      if (rows.length) { const { error } = await sb.from("forums").insert(rows); if (error) return jsonError(error.message); }
      return NextResponse.json({ ok: true, created: rows.length });
    }
    case "lock_forum": {
      const { error } = await sb.from("forums").update({ locked: b.locked }).eq("tenant_id", tid).eq("id", b.id);
      return error ? refuse(error) : NextResponse.json({ ok: true });
    }
    case "thread": {
      const problem = await studentChecks(`${b.title} ${b.body}`);
      if (problem) return jsonError(problem, 422);
      const { data, error } = await sb.from("forum_threads").insert({ tenant_id: tid, forum_id: b.forum_id, author_id: ctx.userId, title: b.title, body: b.body }).select("id").single();
      if (error) return refuse(error);
      await credit(data.id);
      return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
    }
    case "reply": {
      const problem = await studentChecks(b.body);
      if (problem) return jsonError(problem, 422);
      const { data, error } = await sb.from("forum_posts").insert({ tenant_id: tid, thread_id: b.thread_id, author_id: ctx.userId, body: b.body }).select("id").single();
      if (error) return refuse(error);
      await credit(data.id);
      return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
    }
    case "edit": {
      const problem = await studentChecks(b.body);
      if (problem) return jsonError(problem, 422);
      const { data, error } = await sb.from("forum_posts").update({ body: b.body, edited_at: new Date().toISOString() }).eq("tenant_id", tid).eq("id", b.post_id).eq("author_id", ctx.userId).select("id").maybeSingle();
      return error || !data ? refuse(error) : NextResponse.json({ ok: true });
    }
    case "moderate": {
      if (!staff) return jsonError("only staff moderate", 403);
      const patch = b.hide ? { hidden: true, ...(b.post_id ? { hidden_by: ctx.userId, hidden_reason: b.reason ?? null } : {}) } : { hidden: false, ...(b.post_id ? { hidden_by: null, hidden_reason: null } : {}) };
      const q = b.post_id ? sb.from("forum_posts").update(patch).eq("id", b.post_id) : sb.from("forum_threads").update({ hidden: b.hide }).eq("id", b.thread_id ?? "");
      const { error } = await q.eq("tenant_id", tid);
      if (error) return refuse(error);
      await sb.from("forum_reports").update({ resolved_at: new Date().toISOString(), resolved_by: ctx.userId }).eq("tenant_id", tid).is("resolved_at", null).eq(b.post_id ? "post_id" : "thread_id", b.post_id ?? b.thread_id);
      return NextResponse.json({ ok: true });
    }
    case "thread_flags": {
      const patch: Record<string, boolean> = {};
      if (b.pinned !== undefined) patch.pinned = b.pinned;
      if (b.locked !== undefined) patch.locked = b.locked;
      const { error } = await sb.from("forum_threads").update(patch).eq("tenant_id", tid).eq("id", b.thread_id);
      return error ? refuse(error) : NextResponse.json({ ok: true });
    }
    case "report": {
      if (!b.post_id && !b.thread_id) return jsonError("choose what to report");
      const { error } = await sb.from("forum_reports").insert({ tenant_id: tid, post_id: b.post_id ?? null, thread_id: b.thread_id ?? null, reporter_id: ctx.userId, reason: b.reason });
      return error ? refuse(error) : NextResponse.json({ ok: true });
    }
    case "resolve_report": {
      const { error } = await sb.from("forum_reports").update({ resolved_at: new Date().toISOString(), resolved_by: ctx.userId }).eq("tenant_id", tid).eq("id", b.id);
      return error ? refuse(error) : NextResponse.json({ ok: true });
    }
    case "delete_thread": {
      const { data, error } = await sb.from("forum_threads").delete().eq("tenant_id", tid).eq("id", b.thread_id).select("id").maybeSingle();
      return error || !data ? jsonError(error?.message ?? "only staff, or the author before anyone replies, can delete a thread", 403) : NextResponse.json({ ok: true });
    }
  }
}
