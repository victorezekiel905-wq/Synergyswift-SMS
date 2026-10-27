import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { resolvePerson } from "@/lib/gate";
import { appUrl, startOfTodayIso, studentName } from "@/lib/school";
import { tellStaff } from "@/lib/hr-server";
import { localDate } from "@/lib/staff-time";
import { slotTimes, currentSession, hallBoard, coverCandidates, type SeriesSession } from "@/lib/exam-hall";

export const dynamic = "force-dynamic";

/** The slot's papers, seats and invigilators. Every query filters on the school. */
async function slotData(svc: any, tid: string, seriesId: string, date: string, session: number) {
  const { data: series } = await svc.from("exam_series").select("*").eq("tenant_id", tid).eq("id", seriesId).maybeSingle();
  if (!series) return null;
  const { data: papers } = await svc.from("exam_papers").select("id,title,exam_id").eq("tenant_id", tid).eq("series_id", seriesId).eq("slot_date", date).eq("slot_session", session);
  const ids = (papers ?? []).map((p: any) => p.id);
  const [{ data: seats }, { data: duties }, { data: halls }] = await Promise.all([
    ids.length ? svc.from("exam_seats").select("student_id,paper_id,hall_id,label,students(first_name,last_name,other_names,user_id,photo_url)").eq("tenant_id", tid).in("paper_id", ids).limit(5000) : { data: [] },
    svc.from("exam_invigilations").select("*,users:staff_user_id(full_name)").eq("tenant_id", tid).eq("series_id", seriesId).eq("slot_date", date).eq("slot_session", session),
    svc.from("exam_halls").select("id,name").eq("tenant_id", tid).order("name")
  ]);
  return { series, papers: papers ?? [], ids, seats: seats ?? [], duties: duties ?? [], halls: halls ?? [] };
}

/** May this person run check-in for the slot? Admins, and the slot's invigilators. */
const mayRun = (ctx: any, duties: any[]) => hasAny(ctx, ROLES.examOffice) || duties.some((d: any) => d.staff_user_id === ctx.userId);

/** GET ?series=&date=&session= : the live board for one session (any staff). */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "exams");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url).searchParams;
  const tid = ctx.tenant.id, tz = ctx.tenant.timezone;
  const svc = createServiceClient();
  const now = new Date();
  const seriesId = u.get("series") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(seriesId)) return jsonError("choose an exam period");
  const { data: s0 } = await svc.from("exam_series").select("sessions,starts_on,ends_on").eq("tenant_id", tid).eq("id", seriesId).maybeSingle();
  if (!s0) return jsonError("not found", 404);
  const today = localDate(now, tz);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(u.get("date") ?? "") ? u.get("date")! : today >= s0.starts_on && today <= s0.ends_on ? today : s0.starts_on;
  const sessions = (s0.sessions ?? []) as SeriesSession[];
  const session = u.get("session") !== null && /^\d$/.test(u.get("session")!) ? Number(u.get("session")) : currentSession(sessions, date, tz, now);
  const d = await slotData(svc, tid, seriesId, date, session);
  if (!d) return jsonError("not found", 404);
  const times = slotTimes(sessions, date, session, tz);
  const examIds = [...new Set(d.papers.map((p: any) => p.exam_id).filter(Boolean))];
  const userIds = d.seats.map((s: any) => s.students?.user_id).filter(Boolean);
  const [{ data: checkins }, { data: attempts }, { data: absences }, { data: leave }, { data: inToday }, { data: staffUsers }] = await Promise.all([
    d.ids.length ? svc.from("exam_checkins").select("student_id,paper_id,checked_in_at").eq("tenant_id", tid).in("paper_id", d.ids) : { data: [] },
    examIds.length && userIds.length ? svc.from("exam_attempts").select("student_user_id,exam_id,status").eq("tenant_id", tid).in("exam_id", examIds).limit(5000) : { data: [] },
    svc.from("staff_absences").select("user_id").eq("tenant_id", tid).lte("starts_on", date).gte("ends_on", date),
    svc.from("leave_requests").select("staff(user_id)").eq("tenant_id", tid).eq("status", "approved").lte("starts_on", date).gte("ends_on", date),
    date === today ? svc.from("gate_events").select("staff(user_id)").eq("tenant_id", tid).eq("person_type", "staff").eq("direction", "in").gte("at", startOfTodayIso(tz, now)) : { data: [] },
    svc.from("users").select("id,full_name,role,extra_roles").eq("tenant_id", tid).eq("active", true)
  ]);
  const away = new Set<string>([...(absences ?? []).map((a: any) => a.user_id), ...(leave ?? []).map((l: any) => l.staff?.user_id).filter(Boolean)]);
  const atSchool = new Set<string>((inToday ?? []).map((g: any) => g.staff?.user_id).filter(Boolean));
  const halls = hallBoard({
    halls: d.halls, papers: d.papers,
    seats: d.seats.map((s: any) => ({ student_id: s.student_id, paper_id: s.paper_id, hall_id: s.hall_id, label: s.label, name: studentName(s.students), user_id: s.students?.user_id ?? null })),
    checkins: checkins ?? [], attempts: attempts ?? [], away, start: times?.start ?? now, now,
    duties: d.duties.map((x: any) => ({ id: x.id, hall_id: x.hall_id, staff_user_id: x.staff_user_id, name: x.users?.full_name ?? "", chief: x.chief, checked_in_at: x.checked_in_at ?? null, cover_for: x.cover_for ?? null }))
  });
  const busy = new Set<string>(d.duties.map((x: any) => x.staff_user_id));
  const staffRoles = new Set<string>(ROLES.staff);
  const candidates = hasAny(ctx, ROLES.examOffice) ? coverCandidates((staffUsers ?? []).filter((x: any) => staffRoles.has(x.role)).map((x: any) => ({ id: x.id, name: x.full_name })), busy, away, atSchool).slice(0, 40) : [];
  return NextResponse.json({
    series: { id: d.series.id, name: d.series.name, sessions, require_checkin: Boolean(d.series.require_checkin), starts_on: d.series.starts_on, ends_on: d.series.ends_on },
    date, session, times, papers: d.papers, halls, candidates,
    can_run: mayRun(ctx, d.duties), is_admin: hasAny(ctx, ROLES.examOffice), me: ctx.userId,
    totals: { expected: halls.reduce((t, h) => t + h.expected, 0), checked_in: halls.reduce((t, h) => t + h.checked_in, 0), started: halls.reduce((t, h) => t + h.started, 0), submitted: halls.reduce((t, h) => t + h.submitted, 0) }
  });
}

const Slot = { series_id: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), session: z.number().int().min(0).max(5) };
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("checkin"), ...Slot, code: z.string().trim().min(1).max(120), hall_id: z.string().uuid().nullish() }),
  z.object({ action: z.literal("manual"), ...Slot, paper_id: z.string().uuid(), student_id: z.string().uuid() }),
  z.object({ action: z.literal("undo"), ...Slot, paper_id: z.string().uuid(), student_id: z.string().uuid() }),
  z.object({ action: z.literal("here"), ...Slot, invigilation_id: z.string().uuid() }),
  z.object({ action: z.literal("cover"), ...Slot, invigilation_id: z.string().uuid(), staff_user_id: z.string().uuid() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "exams");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  const d = await slotData(svc, tid, b.series_id, b.date, b.session);
  if (!d) return jsonError("not found", 404);
  const admin = hasAny(ctx, ROLES.examOffice);

  if (b.action === "here") {
    const duty = d.duties.find((x: any) => x.id === b.invigilation_id);
    if (!duty) return jsonError("not found", 404);
    if (duty.staff_user_id !== ctx.userId && !admin) return jsonError("only the invigilator can say they are here", 403);
    const { error } = await svc.from("exam_invigilations").update({ checked_in_at: new Date().toISOString() }).eq("tenant_id", tid).eq("id", duty.id);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  if (b.action === "cover") {
    if (!admin) return jsonError("only an admin can arrange cover", 403);
    const duty = d.duties.find((x: any) => x.id === b.invigilation_id);
    if (!duty) return jsonError("not found", 404);
    if (d.duties.some((x: any) => x.staff_user_id === b.staff_user_id)) return jsonError("that person already has a duty in this session");
    const { data: person } = await svc.from("users").select("id,full_name").eq("tenant_id", tid).eq("id", b.staff_user_id).eq("active", true).maybeSingle();
    if (!person) return jsonError("not found", 404);
    const { error } = await svc.from("exam_invigilations").update({ staff_user_id: person.id, cover_for: duty.cover_for ?? duty.staff_user_id, checked_in_at: null }).eq("tenant_id", tid).eq("id", duty.id);
    if (error) return jsonError(error.message);
    const hall = d.halls.find((h: any) => h.id === duty.hall_id);
    const times = slotTimes(d.series.sessions ?? [], b.date, b.session, ctx.tenant.timezone);
    await tellStaff(svc, tid, [person.id], "exam_cover", `Exam cover: ${hall?.name ?? "a hall"}${times ? `, ${times.label}` : ""}`,
      `You are now invigilating in ${hall?.name ?? "an exam hall"}${times ? ` (${times.label})` : ""} on ${b.date}. Please go there now and tap "I'm here" on the live board.`,
      `${appUrl(req)}/school/exam-planner/hall?series=${b.series_id}&date=${b.date}&session=${b.session}`, duty.id).catch(() => null);
    await svc.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "exams.cover", meta: { invigilation_id: duty.id, from: duty.staff_user_id, to: person.id } });
    return NextResponse.json({ ok: true });
  }

  if (!mayRun(ctx, d.duties)) return jsonError("only this session's invigilators or an admin can check candidates in", 403);
  if (b.action === "undo") {
    if (!admin) return jsonError("only an admin can undo a check-in", 403);
    const { error } = await svc.from("exam_checkins").delete().eq("tenant_id", tid).eq("paper_id", b.paper_id).eq("student_id", b.student_id);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  let studentId: string, method: "card" | "manual" = "card";
  if (b.action === "manual") { studentId = b.student_id; method = "manual"; }
  else {
    const person = await resolvePerson(svc, tid, b.code);
    if (!person || person.type !== "student") return jsonError("No student matches that card or number.", 404);
    studentId = person.id;
  }
  const seats = d.seats.filter((s: any) => s.student_id === studentId && (b.action !== "manual" || s.paper_id === b.paper_id));
  if (!seats.length) return jsonError("Not on the list for this session. Check the timetable with the exams office.", 404);
  const seat: any = seats[0];
  const hall = d.halls.find((h: any) => h.id === seat.hall_id);
  const wrongHall = Boolean(b.action === "checkin" && b.hall_id && b.hall_id !== seat.hall_id);
  if (wrongHall) return NextResponse.json({ ok: false, wrong_hall: true, name: studentName(seat.students), hall: hall?.name ?? null, seat: seat.label });
  const { data: fresh, error } = await svc.from("exam_checkins").upsert(seats.map((s: any) => ({ tenant_id: tid, series_id: b.series_id, paper_id: s.paper_id, student_id: studentId,
    hall_id: s.hall_id, method, checked_in_by: ctx.userId })), { onConflict: "paper_id,student_id", ignoreDuplicates: true }).select("id");
  if (error) return jsonError(error.message);
  const paper = d.papers.find((p: any) => p.id === seat.paper_id);
  return NextResponse.json({ ok: true, already: !fresh?.length, name: studentName(seat.students), photo_url: seat.students?.photo_url ?? null, hall: hall?.name ?? null, seat: seat.label, paper: paper?.title ?? null });
}
