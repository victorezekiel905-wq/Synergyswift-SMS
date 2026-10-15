import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { objectiveCoverage } from "@/lib/lms";

export const dynamic = "force-dynamic";

/**
 * Schemes of work and curriculum objectives. ?id= one scheme with its weeks,
 * objectives and coverage; ?objectives=1&subject_id=&level= the objectives list.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "lesson_notes");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const u = new URL(req.url).searchParams;
  const subject = u.get("subject_id"), level = u.get("level");
  if (u.get("objectives")) {
    let q = ctx.sb.from("curriculum_objectives").select("id,subject_id,level,framework,code,strand,statement,position,subjects(name)").eq("tenant_id", tid).order("level").order("position").order("code").limit(5000);
    if (subject) q = q.eq("subject_id", subject);
    if (level) q = q.eq("level", level);
    const { data, error } = await q;
    return error ? jsonError(error.message) : NextResponse.json({ items: data ?? [] });
  }
  const id = u.get("id");
  if (id) {
    const { data: s } = await ctx.sb.from("schemes_of_work").select("*,subjects(name,department_id),terms(name),owner:owner_id(full_name),reviewer:reviewed_by(full_name)").eq("tenant_id", tid).eq("id", id).maybeSingle();
    if (!s) return jsonError("not found", 404);
    const [{ data: weeks }, { data: objectives }, { data: canReview }] = await Promise.all([
      ctx.sb.from("scheme_weeks").select("*").eq("scheme_id", id).order("week_no"),
      ctx.sb.from("curriculum_objectives").select("id,code,strand,statement,position").eq("tenant_id", tid).eq("subject_id", s.subject_id).eq("level", s.level).order("position").order("code"),
      ctx.sb.rpc("can_review_scheme", { p_subject: s.subject_id })
    ]);
    const weekIds = (weeks ?? []).map((w: any) => w.id);
    const { data: linked } = weekIds.length ? await ctx.sb.from("lesson_notes").select("id,scheme_week_id,status,topic").in("scheme_week_id", weekIds) : { data: [] };
    const cov = objectiveCoverage((objectives ?? []).map((o: any) => o.id), weeks ?? []);
    return NextResponse.json({
      scheme: s, weeks: (weeks ?? []).map((w: any) => ({ ...w, lesson_notes: (linked ?? []).filter((n: any) => n.scheme_week_id === w.id) })),
      objectives: objectives ?? [], coverage: cov, can_review: Boolean(canReview) && s.owner_id !== ctx.userId, mine: s.owner_id === ctx.userId
    });
  }
  let q = ctx.sb.from("schemes_of_work").select("id,title,level,status,updated_at,owner_id,subjects(name),terms(name),owner:owner_id(full_name),scheme_weeks(count)").eq("tenant_id", tid).order("updated_at", { ascending: false }).limit(300);
  if (subject) q = q.eq("subject_id", subject);
  if (u.get("mine")) q = q.eq("owner_id", ctx.userId);
  const [{ data, error }, { data: subjects }, { data: terms }, { data: levels }] = await Promise.all([
    q,
    ctx.sb.from("subjects").select("id,name").eq("tenant_id", tid).order("name"),
    ctx.sb.from("terms").select("id,name,is_current,academic_sessions(name)").eq("tenant_id", tid).order("starts_on", { ascending: false }).limit(12),
    ctx.sb.from("class_groups").select("level").eq("tenant_id", tid)
  ]);
  if (error) return jsonError(error.message);
  return NextResponse.json({ items: data ?? [], subjects: subjects ?? [], terms: terms ?? [], levels: [...new Set((levels ?? []).map((l: any) => l.level).filter(Boolean))].sort(), me: ctx.userId });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("objective"), id: z.string().uuid().nullish(), subject_id: z.string().uuid(), level: z.string().trim().min(1).max(40), code: z.string().trim().max(30).nullish(),
    strand: z.string().trim().max(120).nullish(), statement: z.string().trim().min(3).max(1000), position: z.number().int().min(0).max(10000).default(0) }),
  z.object({ action: z.literal("objectives_paste"), subject_id: z.string().uuid(), level: z.string().trim().min(1).max(40), strand: z.string().trim().max(120).nullish(), text: z.string().max(50000) }),
  z.object({ action: z.literal("delete_objective"), id: z.string().uuid() }),
  z.object({ action: z.literal("scheme"), id: z.string().uuid().nullish(), subject_id: z.string().uuid(), level: z.string().trim().min(1).max(40), term_id: z.string().uuid().nullish(),
    title: z.string().trim().min(2).max(160), weeks: z.number().int().min(0).max(20).default(0) }),
  z.object({ action: z.literal("week"), id: z.string().uuid().nullish(), scheme_id: z.string().uuid(), week_no: z.number().int().min(1).max(52), topic: z.string().trim().min(1).max(200),
    objective_ids: z.array(z.string().uuid()).max(30).default([]), activities: z.string().trim().max(4000).nullish(), resources: z.string().trim().max(2000).nullish(), assessment: z.string().trim().max(2000).nullish() }),
  z.object({ action: z.literal("taught"), id: z.string().uuid(), status: z.enum(["planned", "taught", "skipped"]), taught_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(), note: z.string().trim().max(1000).nullish() }),
  z.object({ action: z.literal("delete_week"), id: z.string().uuid() }),
  z.object({ action: z.literal("status"), id: z.string().uuid(), status: z.enum(["draft", "submitted", "approved", "returned"]), note: z.string().trim().max(2000).nullish() }),
  z.object({ action: z.literal("copy"), id: z.string().uuid(), term_id: z.string().uuid().nullish() }),
  z.object({ action: z.literal("delete"), id: z.string().uuid() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "lesson_notes");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const sb = ctx.sb;
  // Trigger and RLS refusals come back as errors; an update that matched nothing means no access.
  const fail = (e: any) => e ? jsonError(/row-level/.test(e.message) ? "you cannot change this" : e.message, 403) : jsonError("not found or not yours to change", 404);
  const now = new Date().toISOString();
  switch (b.action) {
    case "objective": {
      const { action: _a, id, ...row } = b;
      const { error } = id ? await sb.from("curriculum_objectives").update(row).eq("tenant_id", tid).eq("id", id) : await sb.from("curriculum_objectives").insert({ ...row, tenant_id: tid });
      return error ? fail(error) : NextResponse.json({ ok: true });
    }
    case "objectives_paste": {
      // One objective per line; a leading code such as "BSc.1.2" or "1.2" is kept as the code.
      const lines = b.text.split(/\r?\n/).map(l => l.replace(/^[-*•]\s*/, "").trim()).filter(l => l.length >= 3).slice(0, 500);
      const { count } = await sb.from("curriculum_objectives").select("id", { count: "exact", head: true }).eq("tenant_id", tid).eq("subject_id", b.subject_id).eq("level", b.level);
      const rows = lines.map((l, i) => { const m = l.match(/^([A-Za-z]{0,6}\.?\d+(?:\.\d+)*[a-z]?)[\s:.)-]+(.{3,})$/); return { tenant_id: tid, subject_id: b.subject_id, level: b.level, strand: b.strand ?? null,
        code: m ? m[1] : null, statement: (m ? m[2] : l).slice(0, 1000), position: (count ?? 0) + i }; });
      if (!rows.length) return jsonError("paste one objective per line");
      const { error } = await sb.from("curriculum_objectives").insert(rows);
      return error ? fail(error) : NextResponse.json({ ok: true, added: rows.length });
    }
    case "delete_objective": {
      const { error } = await sb.from("curriculum_objectives").delete().eq("tenant_id", tid).eq("id", b.id);
      return error ? fail(error) : NextResponse.json({ ok: true });
    }
    case "scheme": {
      const row = { subject_id: b.subject_id, level: b.level, term_id: b.term_id ?? null, title: b.title, updated_at: now };
      if (b.id) {
        const { error } = await sb.from("schemes_of_work").update(row).eq("tenant_id", tid).eq("id", b.id);
        return error ? fail(error) : NextResponse.json({ ok: true, id: b.id });
      }
      const { data, error } = await sb.from("schemes_of_work").insert({ ...row, tenant_id: tid, owner_id: ctx.userId }).select("id").single();
      if (error) return fail(error);
      if (b.weeks) await sb.from("scheme_weeks").insert(Array.from({ length: b.weeks }, (_, i) => ({ tenant_id: tid, scheme_id: data.id, week_no: i + 1, topic: `Week ${i + 1}` })));
      return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
    }
    case "week": {
      const { action: _a, id, ...row } = b;
      const { error } = id ? await sb.from("scheme_weeks").update({ ...row, updated_at: now }).eq("tenant_id", tid).eq("id", id)
        : await sb.from("scheme_weeks").upsert({ ...row, tenant_id: tid, updated_at: now }, { onConflict: "scheme_id,week_no" });
      if (error) return fail(error);
      await sb.from("schemes_of_work").update({ updated_at: now }).eq("id", b.scheme_id);
      return NextResponse.json({ ok: true });
    }
    case "taught": {
      const { data, error } = await sb.from("scheme_weeks").update({ status: b.status, taught_on: b.status === "taught" ? b.taught_on ?? now.slice(0, 10) : null, note: b.note ?? null, updated_at: now })
        .eq("tenant_id", tid).eq("id", b.id).select("id").maybeSingle();
      return error || !data ? fail(error) : NextResponse.json({ ok: true });
    }
    case "delete_week": {
      const { error } = await sb.from("scheme_weeks").delete().eq("tenant_id", tid).eq("id", b.id);
      return error ? fail(error) : NextResponse.json({ ok: true });
    }
    case "status": {
      const patch: Record<string, unknown> = { status: b.status, updated_at: now };
      if (b.status === "approved" || b.status === "returned") Object.assign(patch, { review_note: b.note ?? null, reviewed_by: ctx.userId, reviewed_at: now });
      const { data, error } = await sb.from("schemes_of_work").update(patch).eq("tenant_id", tid).eq("id", b.id).select("id").maybeSingle();
      return error || !data ? fail(error) : NextResponse.json({ ok: true });
    }
    case "copy": {
      // Next term or next year: same weeks and objectives, nothing marked as taught.
      const { data: s } = await sb.from("schemes_of_work").select("*").eq("tenant_id", tid).eq("id", b.id).maybeSingle();
      if (!s) return jsonError("not found", 404);
      const { data: weeks } = await sb.from("scheme_weeks").select("week_no,topic,objective_ids,activities,resources,assessment").eq("scheme_id", s.id);
      const { data: copy, error } = await sb.from("schemes_of_work").insert({ tenant_id: tid, subject_id: s.subject_id, level: s.level, term_id: b.term_id ?? s.term_id, title: `${s.title} (copy)`.slice(0, 160), owner_id: ctx.userId }).select("id").single();
      if (error) return fail(error);
      if (weeks?.length) await sb.from("scheme_weeks").insert(weeks.map((w: any) => ({ ...w, tenant_id: tid, scheme_id: copy.id })));
      return NextResponse.json({ ok: true, id: copy.id }, { status: 201 });
    }
    case "delete": {
      const { data, error } = await sb.from("schemes_of_work").delete().eq("tenant_id", tid).eq("id", b.id).select("id").maybeSingle();
      return error || !data ? jsonError(error?.message ?? "only drafts you own can be deleted", 403) : NextResponse.json({ ok: true });
    }
  }
}
