import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { buildSlots, scheduleExams, allocateSeats, assignInvigilators, type Candidate, type HallSession } from "@/lib/exams/schedule";
import { studentName } from "@/lib/school";

const slotKey = (date: string, session: number) => `${date}#${session}`;

/** GET: halls and series list, or one series in full with ?series_id=. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "exams");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const seriesId = new URL(req.url).searchParams.get("series_id");
  const { data: halls } = await ctx.sb.from("exam_halls").select("*").eq("tenant_id", tid).order("name");
  if (!seriesId) {
    const { data: series } = await ctx.sb.from("exam_series").select("id,name,starts_on,ends_on,status,term_id,created_at").eq("tenant_id", tid).order("starts_on", { ascending: false });
    return NextResponse.json({ halls: halls ?? [], series: series ?? [], can_edit: hasAny(ctx, ROLES.examOffice) });
  }
  const { data: series } = await ctx.sb.from("exam_series").select("*").eq("tenant_id", tid).eq("id", seriesId).maybeSingle();
  if (!series) return jsonError("exam series not found", 404);
  const [{ data: papers }, { data: seats }, { data: duties }, { data: groups }, { data: subjects }] = await Promise.all([
    ctx.sb.from("exam_papers").select("*").eq("series_id", seriesId).order("slot_date", { nullsFirst: false }).order("slot_session").order("title"),
    ctx.sb.from("exam_seats").select("paper_id,hall_id,student_id,row,col,label,students(first_name,last_name,other_names,admission_no,class_group_id)").eq("series_id", seriesId).limit(20000),
    ctx.sb.from("exam_invigilations").select("slot_date,slot_session,hall_id,staff_user_id,chief,users(full_name)").eq("series_id", seriesId),
    ctx.sb.from("class_groups").select("id,name,level").eq("tenant_id", tid).order("name"),
    ctx.sb.from("subjects").select("id,name").eq("tenant_id", tid).order("name")
  ]);
  return NextResponse.json({
    series, halls: halls ?? [], papers: papers ?? [], class_groups: groups ?? [], subjects: subjects ?? [],
    seats: (seats ?? []).map((s: any) => ({ paper_id: s.paper_id, hall_id: s.hall_id, student_id: s.student_id, row: s.row, col: s.col, label: s.label,
      name: s.students ? studentName(s.students) : "", admission_no: s.students?.admission_no ?? null, class_group_id: s.students?.class_group_id ?? null })),
    duties: (duties ?? []).map((d: any) => ({ ...d, name: d.users?.full_name ?? "", users: undefined })),
    can_edit: hasAny(ctx, ROLES.examOffice)
  });
}

const Session = z.object({ label: z.string().trim().min(1).max(40), start: z.string().regex(/^\d{2}:\d{2}$/), minutes: z.number().int().min(15).max(600) });
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("hall_save"), id: z.string().uuid().optional(), name: z.string().trim().min(1).max(80), capacity: z.number().int().min(1).max(5000),
    rows: z.number().int().min(0).max(200).default(0), cols: z.number().int().min(0).max(200).default(0), notes: z.string().max(500).nullish(), active: z.boolean().default(true) }),
  z.object({ action: z.literal("hall_delete"), id: z.string().uuid() }),
  z.object({ action: z.literal("series_save"), id: z.string().uuid().optional(), name: z.string().trim().min(2).max(120), term_id: z.string().uuid().nullish().or(z.literal("")),
    starts_on: z.string().date(), ends_on: z.string().date(), sessions: z.array(Session).min(1).max(6), skip_dates: z.array(z.string().date()).max(60).default([]),
    max_per_day: z.number().int().min(1).max(6).default(2), invigilator_ratio: z.number().int().min(5).max(200).default(30), spacing: z.enum(["every_seat", "alternate"]).default("every_seat"),
    require_checkin: z.boolean().default(false) }),
  z.object({ action: z.literal("series_delete"), id: z.string().uuid() }),
  z.object({ action: z.literal("paper_save"), id: z.string().uuid().optional(), series_id: z.string().uuid(), title: z.string().trim().min(1).max(160),
    subject_id: z.string().uuid().nullish().or(z.literal("")), class_group_ids: z.array(z.string().uuid()).min(1).max(60), duration_minutes: z.number().int().min(5).max(600),
    slot_date: z.string().date().nullish().or(z.literal("")), slot_session: z.number().int().min(0).max(5).nullish(), locked: z.boolean().default(false), exam_id: z.string().uuid().nullish().or(z.literal("")) }),
  z.object({ action: z.literal("paper_delete"), id: z.string().uuid() }),
  // One paper per subject offered; classes on the same level sit the same subject together.
  z.object({ action: z.literal("papers_from_offerings"), series_id: z.string().uuid(), class_group_ids: z.array(z.string().uuid()).min(1).max(100),
    duration_minutes: z.number().int().min(5).max(600).default(120), combine_levels: z.boolean().default(true) }),
  z.object({ action: z.literal("generate_timetable"), series_id: z.string().uuid() }),
  z.object({ action: z.literal("allocate_seats"), series_id: z.string().uuid() }),
  z.object({ action: z.literal("assign_invigilators"), series_id: z.string().uuid(), exclude_user_ids: z.array(z.string().uuid()).max(500).default([]) }),
  z.object({ action: z.literal("publish"), series_id: z.string().uuid(), publish: z.boolean() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.examOffice, "exams");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const sb = ctx.sb;
  const ok = (extra: Record<string, unknown> = {}) => NextResponse.json({ ok: true, ...extra });
  const fail = (e: { message: string } | null) => (e ? jsonError(e.message.includes("duplicate") ? "that name is already used" : e.message) : null);

  if (b.action === "hall_save") {
    const { id, action: _a, ...row } = b;
    const q = id ? sb.from("exam_halls").update(row).eq("tenant_id", tid).eq("id", id) : sb.from("exam_halls").insert({ ...row, tenant_id: tid });
    const { error } = await q;
    return fail(error) ?? ok();
  }
  if (b.action === "hall_delete") {
    const { error } = await sb.from("exam_halls").delete().eq("tenant_id", tid).eq("id", b.id);
    return fail(error) ?? ok();
  }
  if (b.action === "series_save") {
    if (b.ends_on < b.starts_on) return jsonError("the end date is before the start date");
    const { id, action: _a, require_checkin, ...row } = b;
    // Hall check-in (phase 14i) is only written when switched on, or on an update once the column exists, so saving works before migration 6900.
    const data = { ...row, term_id: row.term_id || null, ...(require_checkin ? { require_checkin } : {}) };
    if (id) {
      let { error } = await sb.from("exam_series").update({ ...data, require_checkin }).eq("tenant_id", tid).eq("id", id);
      if (error && !require_checkin && /require_checkin/.test(error.message)) ({ error } = await sb.from("exam_series").update(data).eq("tenant_id", tid).eq("id", id));
      return fail(error) ?? ok({ id });
    }
    const { data: created, error } = await sb.from("exam_series").insert({ ...data, tenant_id: tid, created_by: ctx.userId }).select("id").single();
    return fail(error) ?? ok({ id: created.id });
  }
  if (b.action === "series_delete") {
    const { error } = await sb.from("exam_series").delete().eq("tenant_id", tid).eq("id", b.id);
    return fail(error) ?? ok();
  }

  const seriesId = b.action === "paper_delete" ? null : b.series_id;
  const series = seriesId ? (await sb.from("exam_series").select("*").eq("tenant_id", tid).eq("id", seriesId).maybeSingle()).data : null;
  if (seriesId && !series) return jsonError("exam series not found", 404);

  if (b.action === "paper_save") {
    const { id, action: _a, ...row } = b;
    const data = { ...row, subject_id: row.subject_id || null, slot_date: row.slot_date || null, exam_id: row.exam_id || null,
      slot_session: row.slot_date ? row.slot_session ?? 0 : null };
    const { error } = id ? await sb.from("exam_papers").update(data).eq("tenant_id", tid).eq("id", id) : await sb.from("exam_papers").insert({ ...data, tenant_id: tid });
    return fail(error) ?? ok();
  }
  if (b.action === "paper_delete") {
    const { error } = await sb.from("exam_papers").delete().eq("tenant_id", tid).eq("id", b.id);
    return fail(error) ?? ok();
  }
  if (b.action === "papers_from_offerings") {
    const [{ data: offerings }, { data: groups }, { data: existing }] = await Promise.all([
      sb.from("subject_offerings").select("class_group_id,subject_id,subjects(name)").eq("tenant_id", tid).in("class_group_id", b.class_group_ids),
      sb.from("class_groups").select("id,name,level").eq("tenant_id", tid).in("id", b.class_group_ids),
      sb.from("exam_papers").select("subject_id,class_group_ids").eq("series_id", series.id)
    ]);
    const levelOf = new Map((groups ?? []).map((g: any) => [g.id, b.combine_levels && g.level ? g.level : g.name]));
    const have = new Set((existing ?? []).flatMap((p: any) => (p.class_group_ids ?? []).map((c: string) => `${p.subject_id}|${c}`)));
    const bucket = new Map<string, { subject_id: string; subject: string; level: string; classes: string[] }>();
    for (const o of offerings ?? []) {
      if (have.has(`${o.subject_id}|${o.class_group_id}`)) continue;
      const level = String(levelOf.get(o.class_group_id) ?? "");
      const k = `${o.subject_id}|${level}`;
      const cur = bucket.get(k) ?? { subject_id: o.subject_id, subject: (o as any).subjects?.name ?? "Subject", level, classes: [] as string[] };
      cur.classes.push(o.class_group_id);
      bucket.set(k, cur);
    }
    const rows = [...bucket.values()].map(x => ({ tenant_id: tid, series_id: series.id, subject_id: x.subject_id, title: `${x.level} ${x.subject}`.trim(), class_group_ids: x.classes, duration_minutes: b.duration_minutes }));
    if (!rows.length) return jsonError("no new papers: the chosen classes have no subjects set up, or every subject already has a paper");
    const { error } = await sb.from("exam_papers").insert(rows);
    return fail(error) ?? ok({ created: rows.length });
  }

  const { data: papers } = await sb.from("exam_papers").select("*").eq("series_id", series.id);
  const sessions: { label: string; start: string; minutes: number }[] = series.sessions ?? [];

  if (b.action === "generate_timetable") {
    const slots = buildSlots(series.starts_on, series.ends_on, sessions, { skipDates: series.skip_dates ?? [] });
    if (!slots.length) return jsonError("the series has no exam days; check the dates and skipped days");
    const valid = new Set(slots.map(s => s.key));
    const input = (papers ?? []).map((p: any) => ({ id: p.id, classGroupIds: p.class_group_ids ?? [], duration: p.duration_minutes,
      fixedSlot: p.locked && p.slot_date !== null && valid.has(slotKey(p.slot_date, p.slot_session ?? 0)) ? slotKey(p.slot_date, p.slot_session ?? 0) : null }));
    const { assignments, unscheduled } = scheduleExams(input, slots, { maxPerDay: series.max_per_day });
    for (const p of papers ?? []) {
      const k = assignments.get(p.id);
      const [date, session] = k ? k.split("#") : [null, null];
      await sb.from("exam_papers").update({ slot_date: date, slot_session: session === null ? null : Number(session) }).eq("id", p.id);
    }
    // A new timetable invalidates seating and duties.
    await sb.from("exam_seats").delete().eq("series_id", series.id);
    await sb.from("exam_invigilations").delete().eq("series_id", series.id);
    const names = new Map((papers ?? []).map((p: any) => [p.id, p.title]));
    return ok({ scheduled: assignments.size, unscheduled: unscheduled.map(id => names.get(id)) });
  }

  if (b.action === "allocate_seats") {
    const { data: halls } = await sb.from("exam_halls").select("id,name,capacity,rows,cols").eq("tenant_id", tid).eq("active", true);
    if (!halls?.length) return jsonError("add at least one exam hall first");
    const placed = (papers ?? []).filter((p: any) => p.slot_date);
    if (!placed.length) return jsonError("generate the timetable first");
    const classIds = [...new Set(placed.flatMap((p: any) => p.class_group_ids ?? []))];
    const { data: students } = await sb.from("students").select("id,first_name,last_name,other_names,class_group_id")
      .eq("tenant_id", tid).eq("status", "active").in("class_group_id", classIds).limit(20000);
    const bySlot = new Map<string, any[]>();
    for (const p of placed) { const k = slotKey(p.slot_date, p.slot_session ?? 0); bySlot.set(k, [...(bySlot.get(k) ?? []), p]); }
    const rows: Record<string, unknown>[] = [];
    const unseated: { slot: string; count: number }[] = [];
    for (const [k, ps] of bySlot) {
      const cands: Candidate[] = ps.flatMap((p: any) => (students ?? []).filter((s: any) => (p.class_group_ids ?? []).includes(s.class_group_id))
        .map((s: any) => ({ studentId: s.id, paperId: p.id, classGroupId: s.class_group_id, name: studentName(s) })));
      const r = allocateSeats(cands, halls, { spacing: series.spacing });
      if (r.unseated.length) unseated.push({ slot: k, count: r.unseated.length });
      for (const s of r.seats) rows.push({ tenant_id: tid, series_id: series.id, paper_id: s.paperId, hall_id: s.hallId, student_id: s.studentId, row: s.row, col: s.col, label: s.label });
    }
    await sb.from("exam_seats").delete().eq("series_id", series.id);
    for (let i = 0; i < rows.length; i += 1000) {
      const { error } = await sb.from("exam_seats").insert(rows.slice(i, i + 1000));
      if (error) return jsonError(error.message);
    }
    return ok({ seated: rows.length, unseated });
  }

  if (b.action === "assign_invigilators") {
    const { data: seats } = await sb.from("exam_seats").select("paper_id,hall_id").eq("series_id", series.id).limit(50000);
    if (!seats?.length) return jsonError("allocate seats first");
    const paperBy = new Map((papers ?? []).map((p: any) => [p.id, p]));
    const sessionsMap = new Map<string, HallSession>();
    for (const s of seats) {
      const p: any = paperBy.get(s.paper_id);
      if (!p?.slot_date) continue;
      const key = `${slotKey(p.slot_date, p.slot_session ?? 0)}|${s.hall_id}`;
      const cur = sessionsMap.get(key) ?? { slotKey: slotKey(p.slot_date, p.slot_session ?? 0), hallId: s.hall_id, candidates: 0, subjectIds: [] as string[] };
      cur.candidates++;
      if (p.subject_id && !cur.subjectIds.includes(p.subject_id)) cur.subjectIds.push(p.subject_id);
      sessionsMap.set(key, cur);
    }
    const [{ data: teachers }, { data: offerings }, { data: absences }] = await Promise.all([
      sb.from("users").select("id,role,extra_roles").eq("tenant_id", tid),
      sb.from("subject_offerings").select("teacher_id,subject_id").eq("tenant_id", tid).not("teacher_id", "is", null),
      sb.from("staff_absences").select("user_id,starts_on,ends_on").eq("tenant_id", tid).lte("starts_on", series.ends_on).gte("ends_on", series.starts_on)
    ]);
    const exclude = new Set(b.exclude_user_ids);
    const pool = (teachers ?? []).filter((u: any) => [u.role, ...(u.extra_roles ?? [])].includes("teacher") && !exclude.has(u.id));
    if (!pool.length) return jsonError("no teachers available to invigilate");
    const slotDates = [...new Set([...sessionsMap.values()].map(s => s.slotKey))];
    const staff = pool.map((u: any) => ({
      id: u.id,
      subjectIds: (offerings ?? []).filter((o: any) => o.teacher_id === u.id).map((o: any) => o.subject_id),
      busySlots: slotDates.filter(k => (absences ?? []).some((a: any) => a.user_id === u.id && a.starts_on <= k.split("#")[0] && a.ends_on >= k.split("#")[0]))
    }));
    const r = assignInvigilators([...sessionsMap.values()], staff, { ratio: series.invigilator_ratio });
    await sb.from("exam_invigilations").delete().eq("series_id", series.id);
    const rows = r.duties.map(d => ({ tenant_id: tid, series_id: series.id, slot_date: d.slotKey.split("#")[0], slot_session: Number(d.slotKey.split("#")[1]), hall_id: d.hallId, staff_user_id: d.staffId, chief: d.chief }));
    if (rows.length) { const { error } = await sb.from("exam_invigilations").insert(rows); if (error) return jsonError(error.message); }
    return ok({ duties: rows.length, short: r.short });
  }

  if (b.action === "publish") {
    const { error } = await sb.from("exam_series").update({ status: b.publish ? "published" : "draft" }).eq("id", series.id);
    return fail(error) ?? ok();
  }
  return jsonError("unknown action");
}
