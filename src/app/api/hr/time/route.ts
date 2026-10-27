import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl, toCsv } from "@/lib/school";
import { tellStaff } from "@/lib/hr-server";
import { staffDays, loadShifts, lateRules, timeDeciders } from "@/lib/staff-time-server";
import { summarise, attendanceDeductions, localDate, type DayRecord } from "@/lib/staff-time";

export const dynamic = "force-dynamic";

/**
 * Staff time (phase 14i-1). GET ?view=
 *  me      my shifts, this month's days and my requests (any staff)
 *  team    requests I can decide (line managers, HR)
 *  shifts  shift patterns and who works them (HR)
 *  month   everyone's month: lates, early departures, absences, deductions (HR); &format=csv
 *  rules   deduction rules, campuses and how staff clock in from a phone (HR)
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "hr");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url).searchParams;
  const view = u.get("view") ?? "me";
  const tid = ctx.tenant.id, tz = ctx.tenant.timezone;
  const svc = createServiceClient();
  const isHr = hasAny(ctx, ROLES.hr);
  const today = localDate(new Date(), tz);
  const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(u.get("period") ?? "") ? u.get("period")! : today.slice(0, 7);
  const [py, pm] = period.split("-").map(Number);
  const monthEnd = new Date(Date.UTC(py!, pm!, 0)).toISOString().slice(0, 10);
  const to = monthEnd < today ? monthEnd : today;

  if (view === "me") {
    const { data: me } = await ctx.sb.from("staff").select("id,full_name").eq("tenant_id", tid).eq("user_id", ctx.userId).maybeSingle();
    if (!me) return NextResponse.json({ staff: null });
    const [{ shifts, assignments, records }, { data: requests }] = await Promise.all([
      staffDays(svc, tid, { from: `${period}-01`, to, timeZone: tz, staffId: me.id }),
      ctx.sb.from("staff_time_requests").select("id,kind,on_date,at_time,direction,reason,status,decision_note,created_at").eq("tenant_id", tid).eq("staff_id", me.id)
        .order("created_at", { ascending: false }).limit(30)
    ]);
    const mine = assignments.filter(a => a.staff_id === me.id && (!a.ends_on || a.ends_on >= today))
      .map(a => ({ ...a, shift: shifts.find(s => s.id === a.shift_id) ?? null }));
    const recs = records.get(me.id) ?? [];
    return NextResponse.json({ staff: me, today, period, shifts: mine, days: [...recs].reverse(), summary: summarise(recs), requests: requests ?? [] });
  }

  if (view === "team") {
    const { data } = await ctx.sb.from("staff_time_requests").select("id,staff_id,kind,on_date,at_time,direction,reason,status,decision_note,created_at,staff(full_name,department)")
      .eq("tenant_id", tid).order("created_at", { ascending: false }).limit(200);
    const { data: me } = await ctx.sb.from("staff").select("id").eq("tenant_id", tid).eq("user_id", ctx.userId).maybeSingle();
    const others = (data ?? []).filter((r: any) => r.staff_id !== me?.id);
    return NextResponse.json({ requests: others, pending: others.filter((r: any) => r.status === "pending").length });
  }

  if (!isHr) return jsonError("only HR can see this", 403);

  if (view === "shifts") {
    const [{ ready, shifts, assignments }, { data: staff }, { data: st }] = await Promise.all([
      loadShifts(svc, tid),
      svc.from("staff").select("id,full_name,department,position,status").eq("tenant_id", tid).neq("status", "exited").order("full_name"),
      svc.from("tenant_settings").select("*").eq("tenant_id", tid).maybeSingle()
    ]);
    const names = new Map((staff ?? []).map((s: any) => [s.id, s.full_name]));
    return NextResponse.json({ ready, shifts, campuses: st?.campuses ?? [], staff: staff ?? [], today,
      assignments: assignments.filter(a => !a.ends_on || a.ends_on >= today).map(a => ({ ...a, name: names.get(a.staff_id) ?? "Former staff" })) });
  }

  if (view === "month") {
    const [{ records }, rules, { data: staff }] = await Promise.all([
      staffDays(svc, tid, { from: `${period}-01`, to, timeZone: tz }),
      lateRules(svc, tid),
      svc.from("staff").select("id,full_name,staff_no,department").eq("tenant_id", tid).order("full_name")
    ]);
    const rows = (staff ?? []).filter((s: any) => records.has(s.id)).map((s: any) => {
      const recs = records.get(s.id) as DayRecord[];
      const sum = summarise(recs, rules);
      const d = attendanceDeductions(sum, rules);
      return { id: s.id, name: s.full_name, staff_no: s.staff_no, department: s.department, ...sum, deduction: d.lines.reduce((t, l) => t + l.amount, 0), unpaid_days: d.absentDays,
        campus: recs.find(r => r.campus)?.campus ?? null };
    });
    if (u.get("format") === "csv") {
      const csv = toCsv([["Staff no", "Name", "Department", "Campus", "Days on shift", "Present", "Late", "Late (excused)", "Minutes late", "Left early", "Absent", "On leave", "Lateness deduction (₦)", "Unpaid absent days"],
        ...rows.map((r: any) => [r.staff_no, r.name, r.department, r.campus, r.scheduled, r.present, r.late, r.late_excused, r.late_minutes, r.early, r.absent, r.leave, r.deduction, r.unpaid_days])]);
      return new NextResponse("﻿" + csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="staff-time-${period}.csv"` } });
    }
    return NextResponse.json({ period, through: to, rules, rows });
  }

  if (view === "rules") {
    const [rules, { data: st }] = await Promise.all([lateRules(svc, tid), svc.from("tenant_settings").select("*").eq("tenant_id", tid).maybeSingle()]);
    return NextResponse.json({ rules, campuses: st?.campuses ?? [], staff_self_clock: st?.staff_self_clock ?? "auto", has_geofence: Boolean(st?.geofence_radius_m), ready: st?.staff_self_clock !== undefined });
  }
  return jsonError("unknown view");
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_shift"), id: z.string().uuid().optional(), name: z.string().trim().min(2).max(60), starts_at: hhmm, ends_at: hhmm,
    days: z.array(z.number().int().min(1).max(7)).min(1).max(7), grace_minutes: z.number().int().min(0).max(120), early_leave_minutes: z.number().int().min(0).max(240),
    campus: z.string().trim().max(60).nullish(), works_holidays: z.boolean().default(false), active: z.boolean().default(true) }),
  z.object({ action: z.literal("delete_shift"), id: z.string().uuid() }),
  z.object({ action: z.literal("assign"), shift_id: z.string().uuid(), staff_ids: z.array(z.string().uuid()).min(1).max(500), starts_on: date, ends_on: date.nullish() }),
  z.object({ action: z.literal("end_assignment"), id: z.string().uuid(), ends_on: date }),
  z.object({ action: z.literal("standard") }),
  z.object({ action: z.literal("request"), kind: z.enum(["late_arrival", "early_departure", "missed_clock"]), on_date: date, at_time: hhmm.nullish(),
    direction: z.enum(["in", "out"]).nullish(), reason: z.string().trim().min(3).max(1000) }),
  z.object({ action: z.literal("cancel"), id: z.string().uuid() }),
  z.object({ action: z.literal("decide"), id: z.string().uuid(), approve: z.boolean(), note: z.string().trim().max(500).nullish() }),
  z.object({ action: z.literal("save_rules"), late_deduction_mode: z.enum(["off", "per_late", "per_minute"]), late_deduction_amount: z.number().min(0).max(1_000_000),
    late_free_per_month: z.number().int().min(0).max(31), early_counts_as_late: z.boolean(), absence_deduction: z.boolean(),
    staff_self_clock: z.enum(["auto", "qr", "geofence", "qr_or_geofence", "qr_and_geofence"]), campuses: z.array(z.string().trim().min(1).max(60)).max(20) })
]);

const KIND_WORDS = { late_arrival: "will be late", early_departure: "needs to leave early", missed_clock: "missed a clock-in" } as const;

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "hr");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id, tz = ctx.tenant.timezone;
  const sb = ctx.sb;
  const svc = createServiceClient();
  const isHr = hasAny(ctx, ROLES.hr);
  const today = localDate(new Date(), tz);
  const fail = (m: string) => jsonError(/row-level security/.test(m) ? "you cannot change that" : m.replace(/^.*?ERROR:\s*/, ""));
  const audit = (action: string, meta: Record<string, unknown>) => sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action, meta });

  switch (b.action) {
    case "request": {
      const { data: me } = await sb.from("staff").select("id,full_name").eq("tenant_id", tid).eq("user_id", ctx.userId).maybeSingle();
      if (!me) return jsonError("your account is not linked to a staff record; ask HR", 404);
      const back = new Date(Date.parse(`${today}T00:00:00Z`) - 14 * 86_400_000).toISOString().slice(0, 10);
      const ahead = new Date(Date.parse(`${today}T00:00:00Z`) + 60 * 86_400_000).toISOString().slice(0, 10);
      if (b.on_date < back || b.on_date > ahead) return jsonError("requests can cover the last two weeks or the next two months");
      if (b.kind === "missed_clock" && (!b.direction || !b.at_time)) return jsonError("say whether you missed signing in or out, and the time");
      if (b.kind === "missed_clock" && b.on_date > today) return jsonError("a missed clock-in is for a day that has happened");
      const { data, error } = await sb.from("staff_time_requests").insert({ tenant_id: tid, staff_id: me.id, kind: b.kind, on_date: b.on_date, at_time: b.at_time ?? null,
        direction: b.kind === "missed_clock" ? b.direction : null, reason: b.reason, created_by: ctx.userId }).select("id").single();
      if (error) return fail(error.message);
      const to = await timeDeciders(svc, tid, me.id);
      await tellStaff(svc, tid, to, "staff_time", `${me.full_name} ${KIND_WORDS[b.kind]} (${b.on_date})`, b.reason, `${appUrl(req)}/school/hr?tab=time`, data.id).catch(() => null);
      return NextResponse.json({ ok: true, id: data.id });
    }
    case "cancel": {
      const { error, data } = await sb.from("staff_time_requests").update({ status: "cancelled" }).eq("tenant_id", tid).eq("id", b.id).select("id");
      if (error) return fail(error.message);
      return data?.length ? NextResponse.json({ ok: true }) : jsonError("request not found", 404);
    }
    case "decide": {
      const { data, error } = await sb.from("staff_time_requests").update({ status: b.approve ? "approved" : "declined", decision_note: b.note ?? null })
        .eq("tenant_id", tid).eq("id", b.id).select("id,kind,on_date,staff(user_id)");
      if (error) return fail(error.message);
      const r: any = data?.[0];
      if (!r) return jsonError("request not found", 404);
      if (r.staff?.user_id) await tellStaff(svc, tid, [r.staff.user_id], "staff_time", `Your request for ${r.on_date} was ${b.approve ? "approved" : "declined"}`,
        b.note ?? (b.approve ? (r.kind === "missed_clock" ? "Your sign-in record has been added." : "It will not count against you.") : "Talk to your line manager if you have questions."),
        `${appUrl(req)}/school/hr?tab=time`, r.id).catch(() => null);
      return NextResponse.json({ ok: true });
    }
  }

  if (!isHr) return jsonError("only HR can change shifts and rules", 403);
  switch (b.action) {
    case "save_shift": {
      const { action: _a, id, ...row } = b;
      const values = { ...row, campus: row.campus || null, days: [...new Set(row.days)].sort() };
      const { data, error } = id ? await sb.from("staff_shifts").update(values).eq("tenant_id", tid).eq("id", id).select("id").single()
        : await sb.from("staff_shifts").insert({ ...values, tenant_id: tid }).select("id").single();
      if (error) return fail(error.message.includes("duplicate") ? "a shift with that name exists" : error.message);
      return NextResponse.json(data);
    }
    case "delete_shift": {
      const { count } = await sb.from("staff_shift_assignments").select("id", { count: "exact", head: true }).eq("tenant_id", tid).eq("shift_id", b.id);
      if (count) return jsonError("people have worked this shift; switch it off instead so their history stays");
      const { error } = await sb.from("staff_shifts").delete().eq("tenant_id", tid).eq("id", b.id);
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }
    case "assign": {
      if (b.ends_on && b.ends_on < b.starts_on) return jsonError("the end date is before the start date");
      const { data: people } = await sb.from("staff").select("id,full_name").eq("tenant_id", tid).in("id", b.staff_ids);
      const clashes: { name: string; error: string }[] = [];
      let assigned = 0;
      for (const p of people ?? []) {
        const { error } = await sb.from("staff_shift_assignments").insert({ tenant_id: tid, staff_id: p.id, shift_id: b.shift_id, starts_on: b.starts_on, ends_on: b.ends_on ?? null, created_by: ctx.userId });
        if (error) clashes.push({ name: p.full_name, error: error.message.replace(/^.*?ERROR:\s*/, "") }); else assigned++;
      }
      await audit("hr.shift_assigned", { shift_id: b.shift_id, assigned, clashes: clashes.length });
      return NextResponse.json({ assigned, clashes });
    }
    case "end_assignment": {
      const { data: a } = await sb.from("staff_shift_assignments").select("id,starts_on").eq("tenant_id", tid).eq("id", b.id).maybeSingle();
      if (!a) return jsonError("not found", 404);
      const { error } = b.ends_on < a.starts_on ? await sb.from("staff_shift_assignments").delete().eq("id", a.id)
        : await sb.from("staff_shift_assignments").update({ ends_on: b.ends_on }).eq("id", a.id);
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }
    case "standard": {
      const { data: st } = await sb.from("tenant_settings").select("staff_start_time,school_weekdays").eq("tenant_id", tid).maybeSingle();
      const start = String(st?.staff_start_time ?? "08:00").slice(0, 5);
      let { data: shift } = await sb.from("staff_shifts").select("id").eq("tenant_id", tid).eq("name", "School day").maybeSingle();
      if (!shift) {
        const ins = await sb.from("staff_shifts").insert({ tenant_id: tid, name: "School day", starts_at: start, ends_at: "16:00", days: st?.school_weekdays?.length ? st.school_weekdays : [1, 2, 3, 4, 5],
          grace_minutes: 10, early_leave_minutes: 15 }).select("id").single();
        if (ins.error) return fail(ins.error.message);
        shift = ins.data;
      }
      const [{ data: staff }, { assignments }] = await Promise.all([
        sb.from("staff").select("id").eq("tenant_id", tid).neq("status", "exited"), loadShifts(svc, tid)]);
      const has = new Set(assignments.filter(a => !a.ends_on || a.ends_on >= today).map(a => a.staff_id));
      const todo = (staff ?? []).filter((s: any) => !has.has(s.id));
      if (todo.length) {
        const { error } = await sb.from("staff_shift_assignments").insert(todo.map((s: any) => ({ tenant_id: tid, staff_id: s.id, shift_id: shift!.id, starts_on: today, created_by: ctx.userId })));
        if (error) return fail(error.message);
      }
      return NextResponse.json({ shift_id: shift!.id, assigned: todo.length });
    }
    case "save_rules": {
      const { action: _a, staff_self_clock, campuses, ...rules } = b;
      // HR keeps these rules (checked above); the settings tables are admin-only in the database.
      const { error } = await svc.from("hr_settings").upsert({ tenant_id: tid, ...rules, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" });
      if (error) return fail(error.message);
      const { error: e2 } = await svc.from("tenant_settings").update({ staff_self_clock, campuses: [...new Set(campuses)] }).eq("tenant_id", tid);
      if (e2) return fail(e2.message);
      await audit("hr.time_rules_saved", { ...rules, staff_self_clock, campuses });
      return NextResponse.json({ ok: true });
    }
  }
  return jsonError("unknown action");
}
