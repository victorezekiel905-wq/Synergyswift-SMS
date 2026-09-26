import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyGuardians } from "@/lib/notify";
import { absence } from "@/lib/messaging/notices";
import { formatInZone } from "@/lib/messaging/outbox";
import { startOfTodayIso, studentName, toCsv } from "@/lib/school";

/**
 * Daily class register.
 * GET ?class_group_id&date          register with gate sign-in hints (who is on site)
 * GET ?class_group_id&from&to&format=csv   attendance export with % per student
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "attendance");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url);
  const cg = u.searchParams.get("class_group_id");
  if (!cg) return jsonError("class_group_id required");
  const tid = ctx.tenant.id;
  const { data: students } = await ctx.sb.from("students").select("id,admission_no,first_name,last_name,other_names,photo_url")
    .eq("tenant_id", tid).eq("class_group_id", cg).eq("status", "active").order("last_name").order("first_name");
  const ids = (students ?? []).map((s: any) => s.id);

  if (u.searchParams.get("format") === "csv" || u.searchParams.get("from")) {
    const from = u.searchParams.get("from") ?? new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    const to = u.searchParams.get("to") ?? new Date().toISOString().slice(0, 10);
    const { data: rows } = ids.length ? await ctx.sb.from("class_attendance").select("student_id,date,status").eq("tenant_id", tid).in("student_id", ids).gte("date", from).lte("date", to).limit(50000) : { data: [] };
    const stats = new Map<string, Record<string, number>>();
    for (const r of rows ?? []) { const m = stats.get(r.student_id) ?? { present: 0, absent: 0, late: 0, excused: 0 }; m[r.status]++; stats.set(r.student_id, m); }
    const out = (students ?? []).map((s: any) => {
      const m = stats.get(s.id) ?? { present: 0, absent: 0, late: 0, excused: 0 };
      const days = m.present + m.absent + m.late + m.excused;
      return { ...s, ...m, days, rate: days ? Math.round(((m.present + m.late) / days) * 1000) / 10 : null };
    });
    if (u.searchParams.get("format") === "csv") {
      const csv = toCsv([["Admission no", "Student", "Present", "Late", "Absent", "Excused", "Days", "Attendance %"],
        ...out.map((s: any) => [s.admission_no, studentName(s), s.present, s.late, s.absent, s.excused, s.days, s.rate])]);
      return new NextResponse("﻿" + csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="attendance-${from}-${to}.csv"` } });
    }
    return NextResponse.json({ from, to, students: out });
  }

  const date = u.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  const [{ data: marks }, { data: gate }] = await Promise.all([
    ids.length ? ctx.sb.from("class_attendance").select("student_id,status,reason,marked_at").eq("tenant_id", tid).eq("date", date).in("student_id", ids) : { data: [] },
    ids.length ? ctx.sb.from("gate_events").select("student_id,direction,at").eq("tenant_id", tid).in("student_id", ids).gte("at", startOfTodayIso(ctx.tenant.timezone, new Date(`${date}T12:00:00Z`))).lt("at", new Date(new Date(`${date}T12:00:00Z`).getTime() + 86400_000).toISOString()) : { data: [] }
  ]);
  const signedIn = new Set((gate ?? []).filter((g: any) => g.direction === "in").map((g: any) => g.student_id));
  const byStudent = new Map((marks ?? []).map((m: any) => [m.student_id, m]));
  return NextResponse.json({
    date, taken: (marks ?? []).length > 0,
    students: (students ?? []).map((s: any) => ({ ...s, mark: byStudent.get(s.id) ?? null, signed_in_at_gate: signedIn.has(s.id) }))
  });
}

const Body = z.object({
  class_group_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entries: z.array(z.object({ student_id: z.string().uuid(), status: z.enum(["present", "absent", "late", "excused"]), reason: z.string().trim().max(200).nullish() })).max(500),
  notify: z.boolean().default(true)
});

/** Save the register. Guardians of absent / late students are told once per day. */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "attendance");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => i.message).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  if (b.date > new Date(Date.now() + 86400_000).toISOString().slice(0, 10)) return jsonError("you cannot mark a future date");
  const rows = b.entries.map(e => ({ tenant_id: tid, student_id: e.student_id, class_group_id: b.class_group_id, date: b.date, status: e.status,
    reason: e.reason ?? null, marked_by: ctx.userId, marked_at: new Date().toISOString() }));
  const { error } = await ctx.sb.from("class_attendance").upsert(rows, { onConflict: "student_id,date" });
  if (error) return jsonError(error.message.includes("row-level security") ? "only teachers of this class or admins can mark this register" : error.message, 403);

  let notified = 0;
  const today = b.date === new Date().toISOString().slice(0, 10) || hasAny(ctx, ROLES.admin);
  if (b.notify && today) {
    const svc = createServiceClient();
    const flagged = b.entries.filter(e => e.status === "absent" || e.status === "late");
    const { data: already } = flagged.length ? await svc.from("class_attendance").select("student_id,parent_notified,status")
      .eq("tenant_id", tid).eq("date", b.date).in("student_id", flagged.map(f => f.student_id)) : { data: [] };
    const skip = new Set((already ?? []).filter((a: any) => a.parent_notified).map((a: any) => a.student_id));
    const todo = flagged.filter(f => !skip.has(f.student_id));
    if (todo.length) {
      const { data: studs } = await svc.from("students").select("id,first_name,last_name,other_names").in("id", todo.map(t => t.student_id));
      const names = new Map<string, string>((studs ?? []).map((s: any) => [s.id, studentName(s)] as [string, string]));
      const dateLabel = formatInZone(new Date(`${b.date}T12:00:00Z`), ctx.tenant.timezone).date;
      for (const t of todo) {
        const r = await notifyGuardians(svc, { tenantId: tid, studentIds: [t.student_id], kind: "absence", createdBy: ctx.userId, budgetMs: 1500,
          build: (brand, g) => absence(brand, { guardianName: g.full_name, studentName: names.get(t.student_id) ?? "Your child", date: dateLabel, status: t.status as "absent" | "late", reason: t.reason }) });
        notified += r.queued;
      }
      await svc.from("class_attendance").update({ parent_notified: true }).eq("tenant_id", tid).eq("date", b.date).in("student_id", todo.map(t => t.student_id));
    }
  }
  return NextResponse.json({ saved: rows.length, messages_queued: notified });
}
