/**
 * Server side of attendance: parents' absence requests, clocking machines,
 * staff days, lesson-register alerts and analytics. Every query filters on
 * the tenant passed in.
 */
import { notifyGuardians } from "./notify";
import { communityNote } from "./messaging/notices";
import { staffRows, enqueue, tryDispatch, formatInZone } from "./messaging/outbox";
import { studentName } from "./school";
import { requestDays, closedDates, addDays, localParts, zonedToUtc, staffDay, summarize, schoolDays, type DevicePunch, type Mark } from "./attendance";
import { personByIdentifier, recordGateEvent, type GateMethod } from "./gate";

export const ABSENCE_KINDS = ["sick", "medical", "family", "religious", "bereavement", "travel", "other"] as const;
export const ABSENCE_LABEL: Record<(typeof ABSENCE_KINDS)[number], string> = {
  sick: "Illness", medical: "Medical or dental appointment", family: "Family matter", religious: "Religious observance", bereavement: "Bereavement", travel: "Travel", other: "Other"
};

/** Holiday dates from the school calendar between two dates. */
export async function holidayDates(svc: any, tenantId: string, from: string, to: string, timeZone: string): Promise<string[]> {
  const { data } = await svc.from("school_events").select("starts_at,ends_at").eq("tenant_id", tenantId).eq("kind", "holiday")
    .lte("starts_at", `${to}T23:59:59Z`).gte("starts_at", `${addDays(from, -60)}T00:00:00Z`);
  return closedDates((data ?? []).map((e: any) => ({ starts_on: localParts(new Date(e.starts_at), timeZone).date, ends_on: e.ends_at ? localParts(new Date(e.ends_at), timeZone).date : null })));
}

async function schoolWeekdays(svc: any, tenantId: string): Promise<number[]> {
  const { data } = await svc.from("tenant_settings").select("school_weekdays").eq("tenant_id", tenantId).maybeSingle();
  return data?.school_weekdays?.length ? data.school_weekdays : [1, 2, 3, 4, 5];
}

// ---------------- parents' absence requests ----------------

export async function requestAbsence(svc: any, p: { tenantId: string; guardianId: string; studentId: string; kind: (typeof ABSENCE_KINDS)[number]; startsOn: string; endsOn: string;
  reason: string; timezone: string; baseUrl: string }) {
  const { data: link } = await svc.from("student_guardians").select("student_id,students(first_name,last_name,other_names,class_group_id,status)")
    .eq("tenant_id", p.tenantId).eq("guardian_id", p.guardianId).eq("student_id", p.studentId).maybeSingle();
  if (!link?.students || link.students.status !== "active") throw new Error("you are not linked to this student");
  const today = localParts(new Date(), p.timezone).date;
  const check = requestDays(p.startsOn, p.endsOn, today, await holidayDates(svc, p.tenantId, p.startsOn, p.endsOn, p.timezone));
  if (!check.ok) throw new Error(check.reason);
  const { data: clash } = await svc.from("student_absence_requests").select("id").eq("tenant_id", p.tenantId).eq("student_id", p.studentId)
    .in("status", ["pending", "approved"]).lte("starts_on", p.endsOn).gte("ends_on", p.startsOn).limit(1);
  if (clash?.length) throw new Error("there is already a request for some of these days");
  const { count } = await svc.from("student_absence_requests").select("id", { count: "exact", head: true }).eq("tenant_id", p.tenantId).eq("guardian_id", p.guardianId)
    .gte("created_at", new Date(Date.now() - 86400_000).toISOString());
  if ((count ?? 0) >= 10) throw new Error("you have made several requests today; please call the school");
  const { data: row, error } = await svc.from("student_absence_requests").insert({ tenant_id: p.tenantId, student_id: p.studentId, guardian_id: p.guardianId, kind: p.kind,
    starts_on: p.startsOn, ends_on: p.endsOn, reason: p.reason }).select("id").single();
  if (error) throw new Error(error.message);
  // The form teacher (or, without one, the admins) hears about it.
  const { data: cls } = link.students.class_group_id ? await svc.from("class_groups").select("form_teacher_id").eq("id", link.students.class_group_id).maybeSingle() : { data: null };
  let to: string[] = cls?.form_teacher_id ? [cls.form_teacher_id] : [];
  if (!to.length) {
    const { data: admins } = await svc.from("users").select("id").eq("tenant_id", p.tenantId).in("role", ["school_admin", "principal"]);
    to = (admins ?? []).map((a: any) => a.id);
  }
  const name = studentName(link.students);
  const rows = await staffRows(svc, { tenantId: p.tenantId, userIds: to, kind: "absence_request", refId: row.id, subject: `Absence request: ${name}`,
    text: `${name}: ${ABSENCE_LABEL[p.kind]}, ${p.startsOn}${p.endsOn !== p.startsOn ? ` to ${p.endsOn}` : ""} (${check.days.length} school day${check.days.length === 1 ? "" : "s"}).`,
    url: `${p.baseUrl}/school/attendance?tab=requests` });
  if (rows.length) { await enqueue(svc, rows); await tryDispatch(svc, { budgetMs: 3000 }); }
  return { id: row.id, days: check.days.length };
}

export async function cancelAbsence(svc: any, p: { tenantId: string; guardianId: string; id: string }) {
  const { data } = await svc.from("student_absence_requests").update({ status: "cancelled" }).eq("tenant_id", p.tenantId).eq("id", p.id)
    .eq("guardian_id", p.guardianId).eq("status", "pending").select("id").maybeSingle();
  if (!data) throw new Error("only a request that is still waiting can be cancelled");
  return { ok: true };
}

/**
 * The form teacher or an admin decides (through their own client, so the
 * database checks who may). Approved school days are marked as excused
 * unless the register already says the child came.
 */
export async function decideAbsence(sb: any, svc: any, p: { tenantId: string; id: string; approve: boolean; note: string | null; userId: string; timezone: string }) {
  const { data: r, error } = await sb.from("student_absence_requests").update({ status: p.approve ? "approved" : "declined", decision_note: p.note })
    .eq("tenant_id", p.tenantId).eq("id", p.id).eq("status", "pending").select("id,student_id,kind,starts_on,ends_on,reason").maybeSingle();
  if (error) throw new Error(error.message.replace(/^.*?: /, ""));
  if (!r) throw new Error("this request is not waiting for a decision");
  let marked = 0;
  if (p.approve) {
    const days = schoolDays(r.starts_on, r.ends_on, { weekdays: await schoolWeekdays(svc, p.tenantId), closed: await holidayDates(svc, p.tenantId, r.starts_on, r.ends_on, p.timezone) });
    const { data: st } = await svc.from("students").select("class_group_id").eq("id", r.student_id).maybeSingle();
    const { data: existing } = await svc.from("class_attendance").select("date,status").eq("student_id", r.student_id).gte("date", r.starts_on).lte("date", r.ends_on);
    const came = new Set((existing ?? []).filter((e: any) => e.status === "present" || e.status === "late").map((e: any) => e.date));
    const rows = days.filter(d => !came.has(d)).map(d => ({ tenant_id: p.tenantId, student_id: r.student_id, class_group_id: st?.class_group_id ?? null, date: d, status: "excused",
      reason: `${ABSENCE_LABEL[r.kind as keyof typeof ABSENCE_LABEL]} (agreed with parent)`, marked_by: p.userId, marked_at: new Date().toISOString(), parent_notified: true }));
    if (rows.length) await svc.from("class_attendance").upsert(rows, { onConflict: "student_id,date" });
    marked = rows.length;
  }
  const { data: s } = await svc.from("students").select("first_name,last_name,other_names").eq("id", r.student_id).maybeSingle();
  const when = r.starts_on === r.ends_on ? r.starts_on : `${r.starts_on} to ${r.ends_on}`;
  await notifyGuardians(svc, { tenantId: p.tenantId, studentIds: [r.student_id], kind: "absence_request", refId: r.id, createdBy: p.userId, budgetMs: 2000,
    build: (brand, g) => communityNote(brand, { name: g.full_name, subject: `Absence request ${p.approve ? "agreed" : "not agreed"}: ${studentName(s)}`,
      lines: [p.approve ? `The school has agreed ${studentName(s)}'s absence (${when}).` : `The school could not agree ${studentName(s)}'s absence (${when}). ${studentName(s)} is expected in school.`,
        ...(p.note ? [`Note from the school: ${p.note}`] : [])] }) });
  return { ok: true, marked };
}

// ---------------- clocking machines ----------------

const METHOD: Record<DevicePunch["verify"], GateMethod> = { fingerprint: "fingerprint", face: "face", card: "card", palm: "fingerprint", password: "device", other: "device" };

/** Records punches from a clocking machine. Unknown user numbers are counted and skipped. */
export async function recordPunches(svc: any, device: { id: string; tenant_id: string; mode: string; name: string }, timezone: string, punches: (DevicePunch | { code: string; at: Date; direction: "in" | "out" | "auto"; method: GateMethod })[]) {
  let saved = 0, unknown = 0, skipped = 0;
  for (const p of punches.slice(0, 2000)) {
    const isLog = "pin" in p;
    const person = isLog ? await personByIdentifier(svc, device.tenant_id, "device_pin", p.pin)
      : (await personByIdentifier(svc, device.tenant_id, "card", p.code)) ?? (await personByIdentifier(svc, device.tenant_id, "device_pin", p.code));
    if (!person) { unknown++; continue; }
    const at = isLog ? zonedToUtc(p.local, timezone) : p.at;
    if (!at || at.getTime() > Date.now() + 5 * 60_000 || at.getTime() < Date.now() - 31 * 86400_000) { skipped++; continue; }
    const direction = device.mode === "in" || device.mode === "out" ? device.mode as "in" | "out" : p.direction;
    const r = await recordGateEvent(svc, { tenantId: device.tenant_id, timezone, person, direction, method: isLog ? METHOD[p.verify] : p.method,
      recordedBy: null, note: device.name, at, viaLabel: device.name });
    if (r.duplicate) skipped++; else saved++;
  }
  await svc.from("attendance_devices").update({ last_seen_at: new Date().toISOString(), last_error: unknown ? `${unknown} unknown user number(s) in the last upload` : null }).eq("id", device.id);
  return { saved, unknown, skipped };
}

// ---------------- staff attendance ----------------

export async function staffAttendance(svc: any, tenantId: string, timezone: string, date: string) {
  const from = zonedToUtc(`${date} 00:00`, timezone)!, to = new Date(from.getTime() + 86400_000);
  const [{ data: staff }, { data: events }, { data: settings }, { data: leave }, { data: absences }] = await Promise.all([
    svc.from("staff").select("id,full_name,staff_no,department,position,user_id,status").eq("tenant_id", tenantId).neq("status", "exited").order("full_name"),
    svc.from("gate_events").select("staff_id,direction,at,method").eq("tenant_id", tenantId).eq("person_type", "staff").gte("at", from.toISOString()).lt("at", to.toISOString()).order("at"),
    svc.from("tenant_settings").select("staff_start_time").eq("tenant_id", tenantId).maybeSingle(),
    svc.from("leave_requests").select("staff_id,leave_type").eq("tenant_id", tenantId).eq("status", "approved").lte("starts_on", date).gte("ends_on", date),
    svc.from("staff_absences").select("user_id,reason").eq("tenant_id", tenantId).lte("starts_on", date).gte("ends_on", date)
  ]);
  const start = settings?.staff_start_time ?? "08:00";
  const onLeave = new Map((leave ?? []).map((l: any) => [l.staff_id, l.leave_type]));
  const away = new Map((absences ?? []).map((a: any) => [a.user_id, a.reason]));
  const rows = (staff ?? []).map((s: any) => {
    const ev = (events ?? []).filter((e: any) => e.staff_id === s.id);
    const day = staffDay(ev, start, timezone);
    const status = ev.length ? (day.late ? "late" : "present") : onLeave.has(s.id) ? "on_leave" : away.has(s.user_id) ? "away" : "absent";
    return { id: s.id, name: s.full_name, staff_no: s.staff_no, department: s.department, position: s.position, ...day, status,
      note: onLeave.get(s.id) ? `Leave: ${onLeave.get(s.id)}` : away.get(s.user_id) ?? null, methods: [...new Set(ev.map((e: any) => e.method))] };
  });
  const count = (st: string) => rows.filter((r: any) => r.status === st).length;
  return { date, start, rows, summary: { present: count("present"), late: count("late"), absent: count("absent"), on_leave: count("on_leave") + count("away"), total: rows.length } };
}

// ---------------- lesson registers ----------------

/** After a lesson register: parents of children who were in school but missed the lesson are told once. */
export async function alertMissedLessons(svc: any, p: { tenantId: string; timezone: string; date: string; periodId: string; studentIds: string[]; subject: string | null; userId: string }) {
  if (!p.studentIds.length) return 0;
  const { data: settings } = await svc.from("tenant_settings").select("lesson_absence_alerts").eq("tenant_id", p.tenantId).maybeSingle();
  if (settings?.lesson_absence_alerts === false) return 0;
  const from = zonedToUtc(`${p.date} 00:00`, p.timezone)!.toISOString();
  const [{ data: daily }, { data: gate }, { data: done }, { data: period }, { data: studs }] = await Promise.all([
    svc.from("class_attendance").select("student_id,status").eq("date", p.date).in("student_id", p.studentIds),
    svc.from("gate_events").select("student_id").eq("direction", "in").gte("at", from).in("student_id", p.studentIds),
    svc.from("lesson_attendance").select("student_id").eq("date", p.date).eq("period_id", p.periodId).eq("parent_notified", true).in("student_id", p.studentIds),
    svc.from("timetable_periods").select("name,starts_at").eq("id", p.periodId).maybeSingle(),
    svc.from("students").select("id,first_name,last_name,other_names").in("id", p.studentIds)
  ]);
  const inSchool = new Set([...(daily ?? []).filter((d: any) => d.status === "present" || d.status === "late").map((d: any) => d.student_id), ...(gate ?? []).map((g: any) => g.student_id)]);
  const already = new Set((done ?? []).map((d: any) => d.student_id));
  const todo = p.studentIds.filter(id => inSchool.has(id) && !already.has(id));
  const names = new Map((studs ?? []).map((s: any) => [s.id, studentName(s)]));
  const label = `${period?.name ?? "a lesson"}${p.subject ? ` (${p.subject})` : ""}`;
  for (const id of todo) {
    await notifyGuardians(svc, { tenantId: p.tenantId, studentIds: [id], kind: "lesson_absence", createdBy: p.userId, budgetMs: 1500,
      build: (brand, g) => communityNote(brand, { name: g.full_name, subject: `${names.get(id)} missed a lesson`,
        lines: [`${names.get(id)} was in school today but was not in ${label}.`, "If you know why, please let the school know."] }) });
  }
  if (todo.length) await svc.from("lesson_attendance").update({ parent_notified: true }).eq("date", p.date).eq("period_id", p.periodId).in("student_id", todo);
  return todo.length;
}

// ---------------- analytics ----------------

export async function loadMarks(svc: any, tenantId: string, from: string, to: string, classGroupId?: string | null) {
  const out: { student_id: string; date: string; status: Mark; class_group_id: string | null }[] = [];
  for (let page = 0; page < 40; page++) {
    let q = svc.from("class_attendance").select("student_id,date,status,class_group_id").eq("tenant_id", tenantId).gte("date", from).lte("date", to).order("date").range(page * 1000, page * 1000 + 999);
    if (classGroupId) q = q.eq("class_group_id", classGroupId);
    const { data } = await q;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export { summarize, formatInZone };
