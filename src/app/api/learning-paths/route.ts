import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny, type Ctx } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { stepStates, pathSummary, prerequisiteCycle, markQuizStep, finished, type StepProgress } from "@/lib/learning";
import { toPublicQuestion, type Question } from "@/lib/exams/engine";
import { POINTS } from "@/lib/lms";

export const dynamic = "force-dynamic";

const STEP_COLS = "id,path_id,position,title,kind,body,url,package_id,homework_id,question_ids,pass_pct,requires";

async function myStudent(ctx: Ctx) {
  const { data } = await createServiceClient().from("students").select("id,class_group_id").eq("tenant_id", ctx.tenant.id).eq("user_id", ctx.userId).maybeSingle();
  return data as { id: string; class_group_id: string | null } | null;
}

/**
 * Homework and content steps finish themselves: a submitted homework or a
 * completed package counts even if it happened before the step was added.
 */
async function syncAuto(svc: any, tenantId: string, studentId: string, userId: string | null, steps: any[], progress: StepProgress[]) {
  const have = new Set(progress.filter(finished).map(p => p.step_id));
  const hw = steps.filter(s => s.kind === "homework" && s.homework_id && !have.has(s.id));
  const pk = steps.filter(s => s.kind === "content" && s.package_id && !have.has(s.id));
  const [{ data: subs }, { data: atts }] = await Promise.all([
    hw.length ? svc.from("homework_submissions").select("homework_id").eq("student_id", studentId).in("homework_id", hw.map(s => s.homework_id)) : { data: [] },
    pk.length && userId ? svc.from("content_attempts").select("package_id,status,score").eq("user_id", userId).in("package_id", pk.map(s => s.package_id)) : { data: [] }
  ]);
  const add: any[] = [];
  for (const s of hw) if ((subs ?? []).some((x: any) => x.homework_id === s.homework_id)) add.push({ s, status: "done", score: null });
  for (const s of pk) {
    const a = (atts ?? []).find((x: any) => x.package_id === s.package_id);
    if (a && (a.status === "passed" || (a.status === "completed" && (a.score === null || s.pass_pct === 0 || a.score >= s.pass_pct)))) add.push({ s, status: "done", score: a.score });
  }
  for (const x of add) {
    await svc.from("learning_path_progress").upsert({ step_id: x.s.id, student_id: studentId, tenant_id: tenantId, path_id: x.s.path_id, status: x.status, score: x.score, completed_at: new Date().toISOString() }, { onConflict: "step_id,student_id" });
    await svc.from("learning_activity").upsert({ tenant_id: tenantId, student_id: studentId, kind: "path_step", points: POINTS.path_step, ref_id: x.s.id }, { onConflict: "student_id,kind,ref_id", ignoreDuplicates: true });
    progress = [...progress.filter(p => p.step_id !== x.s.id), { step_id: x.s.id, status: x.status, score: x.score }];
  }
  return progress;
}

export async function GET(req: NextRequest) {
  const ctx = await requireCtx(undefined, "lms");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const u = new URL(req.url).searchParams;
  const id = u.get("id");
  const staff = hasAny(ctx, ROLES.staff);
  const svc = createServiceClient();

  // A parent or teacher looking at one child's paths.
  const childId = u.get("student_id");
  if (childId) {
    const { data: kid } = await ctx.sb.from("students").select("id,class_group_id,user_id").eq("tenant_id", tid).eq("id", childId).maybeSingle();
    if (!kid?.class_group_id) return NextResponse.json({ items: [] });
    const { data: paths } = await svc.from("learning_paths").select(`id,title,subjects(name),learning_path_steps(${STEP_COLS})`).eq("tenant_id", tid).eq("status", "published").contains("class_group_ids", [kid.class_group_id]);
    const { data: prog } = await ctx.sb.from("learning_path_progress").select("step_id,status,score").eq("student_id", kid.id);
    return NextResponse.json({ items: (paths ?? []).map((p: any) => ({ id: p.id, title: p.title, subject: p.subjects?.name ?? null, ...pathSummary(p.learning_path_steps, prog ?? []) })) });
  }

  if (staff) {
    if (id) {
      const { data: path } = await ctx.sb.from("learning_paths").select("*,subjects(name)").eq("tenant_id", tid).eq("id", id).maybeSingle();
      if (!path) return jsonError("not found", 404);
      const [{ data: steps }, { data: students }, { data: prog }] = await Promise.all([
        ctx.sb.from("learning_path_steps").select(STEP_COLS).eq("path_id", id).order("position"),
        path.class_group_ids.length ? ctx.sb.from("students").select("id,first_name,last_name,class_group_id").eq("tenant_id", tid).eq("status", "active").in("class_group_id", path.class_group_ids).order("last_name") : { data: [] },
        ctx.sb.from("learning_path_progress").select("step_id,student_id,status,score,attempts").eq("path_id", id)
      ]);
      const pkgIds = (steps ?? []).map((s: any) => s.package_id).filter(Boolean), hwIds = (steps ?? []).map((s: any) => s.homework_id).filter(Boolean);
      const [{ data: pkgs }, { data: hws }] = await Promise.all([
        pkgIds.length ? ctx.sb.from("content_packages").select("id,title,kind").in("id", pkgIds) : { data: [] },
        hwIds.length ? ctx.sb.from("homework").select("id,title,due_at").in("id", hwIds) : { data: [] }
      ]);
      return NextResponse.json({ path, steps: steps ?? [], students: students ?? [], progress: prog ?? [], packages: pkgs ?? [], homework: hws ?? [],
        mine: path.created_by === ctx.userId || hasAny(ctx, ROLES.admin) });
    }
    const { data, error } = await ctx.sb.from("learning_paths").select("id,title,status,class_group_ids,updated_at,created_by,subjects(name),learning_path_steps(count)")
      .eq("tenant_id", tid).order("updated_at", { ascending: false }).limit(300);
    return error ? jsonError(error.message) : NextResponse.json({ items: data ?? [], staff: true, me: ctx.userId });
  }

  // ---------- students ----------
  const me = await myStudent(ctx);
  if (!me) return NextResponse.json({ items: [], staff: false });
  if (!id) {
    const { data: paths } = await ctx.sb.from("learning_paths").select(`id,title,description,subjects(name),learning_path_steps(${STEP_COLS})`).eq("tenant_id", tid).eq("status", "published").order("updated_at", { ascending: false });
    const { data: prog } = await ctx.sb.from("learning_path_progress").select("step_id,status,score").eq("student_id", me.id);
    return NextResponse.json({ staff: false, items: (paths ?? []).map((p: any) => ({ id: p.id, title: p.title, description: p.description, subject: p.subjects?.name ?? null, ...pathSummary(p.learning_path_steps, prog ?? []) })) });
  }
  const { data: path } = await ctx.sb.from("learning_paths").select("id,title,description,subjects(name)").eq("tenant_id", tid).eq("id", id).eq("status", "published").maybeSingle();
  if (!path) return jsonError("not found", 404);
  const { data: steps } = await ctx.sb.from("learning_path_steps").select(STEP_COLS).eq("path_id", id).order("position");
  const { data: prog0 } = await ctx.sb.from("learning_path_progress").select("step_id,status,score").eq("student_id", me.id).eq("path_id", id);
  const prog = await syncAuto(svc, tid, me.id, ctx.userId, steps ?? [], prog0 ?? []);
  const states = stepStates<any>((steps ?? []).map((s: any) => ({ ...s, requires: s.requires ?? [] })), prog);
  // Questions for open quiz steps (never the answers); titles for linked items.
  const qIds = states.filter(s => s.kind === "quiz" && s.state !== "locked").flatMap(s => s.question_ids);
  const [{ data: qs }, { data: pkgs }, { data: hws }] = await Promise.all([
    qIds.length ? svc.from("question_bank").select("id,type,prompt,points,media_url,data,answer,explanation").eq("tenant_id", tid).in("id", qIds) : { data: [] },
    svc.from("content_packages").select("id,title,kind").in("id", states.map(s => s.package_id).filter(Boolean)),
    svc.from("homework").select("id,title,due_at").in("id", states.map(s => s.homework_id).filter(Boolean))
  ]);
  const qMap = new Map((qs ?? []).map((q: any) => [q.id, q]));
  return NextResponse.json({
    staff: false, path: { id: path.id, title: path.title, description: path.description, subject: (path as any).subjects?.name ?? null }, ...pathSummary(states, prog),
    steps: states.map(s => ({
      id: s.id, title: s.title, kind: s.kind, state: s.state, waiting: s.waiting, progress: s.progress, pass_pct: s.pass_pct,
      body: s.state === "locked" ? null : s.body, url: s.state === "locked" ? null : s.url,
      package: s.package_id ? (pkgs ?? []).find((p: any) => p.id === s.package_id) ?? null : null,
      homework: s.homework_id ? (hws ?? []).find((h: any) => h.id === s.homework_id) ?? null : null,
      questions: s.kind === "quiz" && s.state !== "locked" ? s.question_ids.map((q: string) => qMap.get(q)).filter(Boolean).map((q: any) => toPublicQuestion(q as Question)) : []
    }))
  });
}

const PathBody = z.object({ action: z.literal("save_path"), id: z.string().uuid().nullish(), title: z.string().trim().min(2).max(160), description: z.string().trim().max(4000).nullish(),
  subject_id: z.string().uuid().nullish(), class_group_ids: z.array(z.string().uuid()).max(50).default([]), status: z.enum(["draft", "published", "archived"]).default("draft") });
const StepBody = z.object({ action: z.literal("save_step"), id: z.string().uuid().nullish(), path_id: z.string().uuid(), title: z.string().trim().min(1).max(160),
  kind: z.enum(["text", "link", "video", "content", "quiz", "homework"]), body: z.string().max(20000).nullish(), url: z.string().trim().url().max(1000).nullish(),
  package_id: z.string().uuid().nullish(), homework_id: z.string().uuid().nullish(), question_ids: z.array(z.string().uuid()).max(50).default([]),
  pass_pct: z.number().int().min(0).max(100).default(60), requires: z.array(z.string().uuid()).max(30).default([]), position: z.number().int().min(0).max(1000).nullish() });
const Body = z.discriminatedUnion("action", [
  PathBody, StepBody,
  z.object({ action: z.literal("delete_path"), id: z.string().uuid() }),
  z.object({ action: z.literal("delete_step"), id: z.string().uuid() }),
  z.object({ action: z.literal("reorder"), path_id: z.string().uuid(), ids: z.array(z.string().uuid()).max(200) }),
  z.object({ action: z.literal("complete"), step_id: z.string().uuid() }),
  z.object({ action: z.literal("quiz"), step_id: z.string().uuid(), answers: z.record(z.string(), z.unknown()) })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(undefined, "lms");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const now = new Date().toISOString();
  const staff = hasAny(ctx, ROLES.staff);

  if (b.action === "complete" || b.action === "quiz") {
    const me = await myStudent(ctx);
    if (!me) return jsonError("only students work through paths", 403);
    const svc = createServiceClient();
    const { data: step } = await ctx.sb.from("learning_path_steps").select(STEP_COLS).eq("tenant_id", tid).eq("id", b.step_id).maybeSingle();
    if (!step) return jsonError("not found", 404);
    const [{ data: all }, { data: prog }] = await Promise.all([
      ctx.sb.from("learning_path_steps").select("id,position,kind,requires,pass_pct").eq("path_id", step.path_id),
      ctx.sb.from("learning_path_progress").select("step_id,status,score,attempts").eq("student_id", me.id).eq("path_id", step.path_id)
    ]);
    const st = stepStates(all ?? [], prog ?? []).find(s => s.id === step.id);
    if (st?.state === "locked") return jsonError("finish the earlier steps first", 409);
    const prev = (prog ?? []).find((p: any) => p.step_id === step.id);
    let row: Record<string, unknown>;
    let result: Record<string, unknown> = {};
    if (b.action === "complete") {
      if (!["text", "link", "video"].includes(step.kind)) return jsonError("this step finishes when its work is done", 400);
      row = { status: "done", score: null };
    } else {
      if (step.kind !== "quiz") return jsonError("not a quiz", 400);
      const { data: qs } = await svc.from("question_bank").select("id,type,prompt,points,data,answer,explanation").eq("tenant_id", tid).in("id", step.question_ids);
      const m = markQuizStep((qs ?? []) as Question[], b.answers, step.pass_pct);
      // A pass is kept; a lower score later does not undo it.
      const status = m.passed || prev?.status === "passed" ? "passed" : "failed";
      row = { status, score: Math.max(m.pct, prev?.status === "passed" ? Number(prev.score ?? 0) : 0), answers: b.answers };
      result = { pct: m.pct, passed: m.passed, right: m.right, explanations: Object.fromEntries((qs ?? []).map((q: any) => [q.id, q.explanation ?? null])) };
    }
    await svc.from("learning_path_progress").upsert({ step_id: step.id, student_id: me.id, tenant_id: tid, path_id: step.path_id, ...row, attempts: (prev?.attempts ?? 0) + 1, completed_at: now },
      { onConflict: "step_id,student_id" });
    if (row.status === "done" || row.status === "passed") {
      await svc.from("learning_activity").upsert({ tenant_id: tid, student_id: me.id, kind: "path_step", points: POINTS.path_step, ref_id: step.id }, { onConflict: "student_id,kind,ref_id", ignoreDuplicates: true });
    }
    return NextResponse.json({ ok: true, ...result });
  }

  if (!staff) return jsonError("forbidden", 403);
  const sb = ctx.sb;
  const deny = (e: any) => jsonError(e?.message ?? "only the teacher who made this path or an admin can change it", e ? 400 : 403);
  switch (b.action) {
    case "save_path": {
      const { action: _a, id, ...row } = b;
      if (row.class_group_ids.length) {
        const { count } = await sb.from("class_groups").select("id", { count: "exact", head: true }).eq("tenant_id", tid).in("id", row.class_group_ids);
        if (count !== row.class_group_ids.length) return jsonError("choose classes from this school");
      }
      if (id) {
        const { data, error } = await sb.from("learning_paths").update({ ...row, updated_at: now }).eq("tenant_id", tid).eq("id", id).select("id").maybeSingle();
        return error || !data ? deny(error) : NextResponse.json({ ok: true, id });
      }
      const { data, error } = await sb.from("learning_paths").insert({ ...row, tenant_id: tid, created_by: ctx.userId }).select("id").single();
      return error ? deny(error) : NextResponse.json({ ok: true, id: data.id }, { status: 201 });
    }
    case "save_step": {
      const { action: _a, id, ...row } = b;
      const { data: steps } = await sb.from("learning_path_steps").select("id,requires,position").eq("path_id", row.path_id);
      const list = (steps ?? []) as { id: string; requires: string[]; position: number }[];
      if (row.requires.some(r => r === id || !list.some(s => s.id === r))) return jsonError("prerequisites must be other steps in this path");
      if (row.kind === "quiz" && !row.question_ids.length) return jsonError("choose at least one question for the quiz");
      if (row.kind === "content" && !row.package_id) return jsonError("choose the content to open");
      if (row.kind === "homework" && !row.homework_id) return jsonError("choose the homework");
      if ((row.kind === "link" || row.kind === "video") && !row.url) return jsonError("add the https link");
      const tempId = id ?? "new";
      const cycle = prerequisiteCycle([...list.filter(s => s.id !== id), { id: tempId, requires: row.requires }]);
      if (cycle) return jsonError("those prerequisites would make a loop, so the step could never be opened");
      const position = row.position ?? (id ? list.find(s => s.id === id)?.position ?? 0 : Math.max(-1, ...list.map(s => s.position)) + 1);
      const fields = { ...row, position, body: row.body ?? null, url: row.url ?? null, package_id: row.kind === "content" ? row.package_id : null,
        homework_id: row.kind === "homework" ? row.homework_id : null, question_ids: row.kind === "quiz" ? row.question_ids : [], updated_at: now };
      const res = id ? await sb.from("learning_path_steps").update(fields).eq("tenant_id", tid).eq("id", id).select("id").maybeSingle()
        : await sb.from("learning_path_steps").insert({ ...fields, tenant_id: tid }).select("id").single();
      if (res.error || !res.data) return deny(res.error);
      await sb.from("learning_paths").update({ updated_at: now }).eq("id", row.path_id);
      return NextResponse.json({ ok: true, id: res.data.id });
    }
    case "delete_path": {
      const { data, error } = await sb.from("learning_paths").delete().eq("tenant_id", tid).eq("id", b.id).select("id").maybeSingle();
      return error || !data ? deny(error) : NextResponse.json({ ok: true });
    }
    case "delete_step": {
      const { data: s } = await sb.from("learning_path_steps").select("id,path_id").eq("tenant_id", tid).eq("id", b.id).maybeSingle();
      if (!s) return jsonError("not found", 404);
      const { data, error } = await sb.from("learning_path_steps").delete().eq("id", b.id).select("id").maybeSingle();
      if (error || !data) return deny(error);
      // Steps that needed it no longer do.
      const { data: dep } = await sb.from("learning_path_steps").select("id,requires").eq("path_id", s.path_id).contains("requires", [b.id]);
      for (const d of dep ?? []) await sb.from("learning_path_steps").update({ requires: d.requires.filter((r: string) => r !== b.id) }).eq("id", d.id);
      return NextResponse.json({ ok: true });
    }
    case "reorder": {
      for (const [i, sid] of b.ids.entries()) {
        const { error } = await sb.from("learning_path_steps").update({ position: i }).eq("tenant_id", tid).eq("path_id", b.path_id).eq("id", sid);
        if (error) return deny(error);
      }
      return NextResponse.json({ ok: true });
    }
  }
}
