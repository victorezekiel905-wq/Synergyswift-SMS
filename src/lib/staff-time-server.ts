/**
 * Staff time on the server (phase 14i-1): loads shifts, sign-ins, approved requests,
 * leave and holidays, and turns them into day records with the pure rules in
 * staff-time.ts. Every query filters on the tenant. Before migration 6800 the shift
 * tables do not exist: everything degrades to "no shifts".
 */
import { fetchAll } from "@/lib/results";
import { holidayDates } from "@/lib/attendance-server";
import { shiftsOn, dayRecord, shiftWindow, clockFlags, localDate, zonedInstant, datesBetween, NO_RULES,
  type Shift, type Assignment, type DayRecord, type LateRules, type TimeRequest, type ClockEvent } from "@/lib/staff-time";

const DAY = 86_400_000;

export async function loadShifts(svc: any, tenantId: string) {
  const [s, a] = await Promise.all([
    svc.from("staff_shifts").select("*").eq("tenant_id", tenantId).order("starts_at"),
    svc.from("staff_shift_assignments").select("id,staff_id,shift_id,starts_on,ends_on").eq("tenant_id", tenantId).order("starts_on").limit(10000)
  ]);
  if (s.error || a.error) return { ready: false, shifts: [] as Shift[], assignments: [] as (Assignment & { id: string })[] };
  return { ready: true, shifts: (s.data ?? []) as Shift[], assignments: (a.data ?? []) as (Assignment & { id: string })[] };
}

export async function lateRules(svc: any, tenantId: string): Promise<LateRules> {
  const { data } = await svc.from("hr_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (!data || data.late_deduction_mode === undefined) return NO_RULES;
  return {
    late_deduction_mode: data.late_deduction_mode, late_deduction_amount: Number(data.late_deduction_amount) || 0,
    late_free_per_month: Number(data.late_free_per_month ?? 3), early_counts_as_late: data.early_counts_as_late !== false, absence_deduction: Boolean(data.absence_deduction)
  };
}

function groupBy<T>(rows: T[], key: (r: T) => string) {
  const m = new Map<string, T[]>();
  for (const r of rows) { const k = key(r); const list = m.get(k); if (list) list.push(r); else m.set(k, [r]); }
  return m;
}

/**
 * Day records for everyone with a shift (or the given staff) between two dates, inclusive.
 * `from`/`to` are dates in the school's time zone.
 */
export async function staffDays(svc: any, tenantId: string, p: { from: string; to: string; timeZone: string; staffId?: string; now?: Date }) {
  const { ready, shifts, assignments } = await loadShifts(svc, tenantId);
  const now = p.now ?? new Date();
  const empty = { ready, shifts, assignments, records: new Map<string, DayRecord[]>() };
  if (!ready || !assignments.length) return empty;
  const fromIso = new Date(zonedInstant(p.from, "00:00", p.timeZone).getTime() - DAY).toISOString();
  const toIso = new Date(zonedInstant(p.to, "00:00", p.timeZone).getTime() + 2 * DAY).toISOString();
  const one = <T>(q: any): T => (p.staffId ? q.eq("staff_id", p.staffId) : q);
  const [events, { data: requests }, { data: leave }, holidays] = await Promise.all([
    fetchAll<{ id: string; staff_id: string; direction: "in" | "out"; at: string }>(() =>
      one<any>(svc.from("gate_events").select("id,staff_id,direction,at").eq("tenant_id", tenantId).eq("person_type", "staff").gte("at", fromIso).lt("at", toIso)).order("at").order("id")),
    one<any>(svc.from("staff_time_requests").select("staff_id,kind,on_date,status").eq("tenant_id", tenantId).eq("status", "approved").gte("on_date", p.from).lte("on_date", p.to)).limit(10000),
    one<any>(svc.from("leave_requests").select("staff_id,starts_on,ends_on,half_day").eq("tenant_id", tenantId).eq("status", "approved").lte("starts_on", p.to).gte("ends_on", p.from)).limit(10000),
    holidayDates(svc, tenantId, p.from, p.to, p.timeZone)
  ]);
  const evBy = groupBy(events, e => e.staff_id);
  const reqBy = groupBy((requests ?? []) as (TimeRequest & { staff_id: string })[], r => r.staff_id);
  const leaveBy = groupBy((leave ?? []) as { staff_id: string; starts_on: string; ends_on: string; half_day: boolean }[], l => l.staff_id);
  const hol = new Set(holidays);
  const byId = new Map(shifts.map(s => [s.id, s]));
  const dates = datesBetween(p.from, p.to);
  const who = p.staffId ? [p.staffId] : [...new Set(assignments.map(a => a.staff_id))];
  const records = new Map<string, DayRecord[]>();
  for (const sid of who) {
    const evs: ClockEvent[] = (evBy.get(sid) ?? []).map(e => ({ direction: e.direction, at: e.at }));
    const recs: DayRecord[] = [];
    for (const d of dates) for (const sh of shiftsOn(sid, d, assignments, byId)) {
      const onLeave = (leaveBy.get(sid) ?? []).some(l => !l.half_day && l.starts_on <= d && l.ends_on >= d);
      recs.push(dayRecord({ shift: sh, date: d, timeZone: p.timeZone, events: evs, requests: reqBy.get(sid) ?? [], onLeave, holiday: hol.has(d), now }));
    }
    records.set(sid, recs);
  }
  return { ready, shifts, assignments, records };
}

/**
 * Late / early flags for a staff sign-in from their shift, and the shift's campus.
 * Null when the person has no shift around this time (the gate then uses the school's start time).
 */
export async function shiftFlags(svc: any, tenantId: string, staffId: string, at: Date, direction: "in" | "out", timeZone: string) {
  const { data: asg, error } = await svc.from("staff_shift_assignments").select("staff_id,shift_id,starts_on,ends_on,staff_shifts(*)").eq("tenant_id", tenantId).eq("staff_id", staffId);
  if (error || !asg?.length) return null;
  const shifts = new Map<string, Shift>(asg.filter((a: any) => a.staff_shifts).map((a: any) => [a.shift_id, a.staff_shifts as Shift]));
  const today = localDate(at, timeZone);
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - DAY).toISOString().slice(0, 10);
  for (const d of [today, yesterday]) {
    for (const sh of shiftsOn(staffId, d, asg, shifts)) {
      const w = shiftWindow(sh, d, timeZone);
      if (at < w.from || at > w.to) continue;
      const f = clockFlags(sh, d, timeZone, at, direction);
      if (direction === "in" && f.late) {
        // Only the first sign-in of the shift can be late (not coming back from lunch).
        const { data: before } = await svc.from("gate_events").select("id").eq("tenant_id", tenantId).eq("staff_id", staffId).eq("direction", "in")
          .gte("at", w.from.toISOString()).lt("at", at.toISOString()).limit(1);
        if (before?.length) f.late = false;
      }
      return { ...f, campus: sh.campus, shift: sh.name };
    }
  }
  return null;
}

/** Users who decide a person's time requests: their line manager, else HR (else admins). */
export async function timeDeciders(svc: any, tenantId: string, staffId: string): Promise<string[]> {
  const { data: s } = await svc.from("staff").select("line_manager_id").eq("tenant_id", tenantId).eq("id", staffId).maybeSingle();
  if (s?.line_manager_id) {
    const { data: m } = await svc.from("staff").select("user_id").eq("tenant_id", tenantId).eq("id", s.line_manager_id).maybeSingle();
    if (m?.user_id) return [m.user_id];
  }
  const { data } = await svc.from("users").select("id,role,extra_roles").eq("tenant_id", tenantId).eq("active", true);
  const has = (u: any, r: string) => u.role === r || (u.extra_roles ?? []).includes(r);
  const hr = (data ?? []).filter((u: any) => has(u, "hr_manager")).map((u: any) => u.id);
  return hr.length ? hr : (data ?? []).filter((u: any) => has(u, "school_admin") || has(u, "principal")).map((u: any) => u.id);
}
