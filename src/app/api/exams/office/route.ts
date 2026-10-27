import { NextResponse } from "next/server";
import { requireCtx, ROLES } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { localDate } from "@/lib/staff-time";

export const dynamic = "force-dynamic";
const DAY = 86_400_000;

/** The exams office at a glance (phase 14j): live papers, what is coming, marking, releases, requests, arrangements, incidents, the planner. */
export async function GET() {
  const ctx = await requireCtx(ROLES.examOffice, "exams");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id, tz = ctx.tenant.timezone;
  const svc = createServiceClient();
  const now = new Date(), today = localDate(now, tz);
  const [{ data: exams }, { data: requests }, { data: series }, { data: sen }] = await Promise.all([
    svc.from("exams").select("id,title,status,opens_at,closes_at,duration_minutes,results_released,class_group_id,created_by,class_groups(name),users:created_by(full_name)")
      .eq("tenant_id", tid).neq("status", "draft").gte("created_at", new Date(now.getTime() - 120 * DAY).toISOString()).order("opens_at", { ascending: true }).limit(500),
    svc.from("exam_requests").select("id,kind,status,created_at,minutes,arrangement,students(first_name,last_name),exams(title)").eq("tenant_id", tid).eq("status", "pending").order("created_at").limit(50),
    svc.from("exam_series").select("id,name,starts_on,ends_on,status").eq("tenant_id", tid).gte("ends_on", today).order("starts_on").limit(10),
    svc.from("sen_profiles").select("student_id,extra_time_pct,arrangements,status").eq("tenant_id", tid).neq("status", "closed").or("extra_time_pct.gt.0,arrangements.neq.{}")
  ]);
  const t = now.getTime();
  const open = (e: any) => e.status === "published" && (!e.opens_at || Date.parse(e.opens_at) <= t) && (!e.closes_at || Date.parse(e.closes_at) >= t);
  const live = (exams ?? []).filter(open);
  const ids = (exams ?? []).map((e: any) => e.id);
  const { data: attempts } = ids.length ? await svc.from("exam_attempts").select("exam_id,status,violations").eq("tenant_id", tid).in("exam_id", ids).limit(20000) : { data: [] };
  const by = new Map<string, any[]>();
  for (const a of attempts ?? []) by.set(a.exam_id, [...(by.get(a.exam_id) ?? []), a]);
  const count = (id: string, f: (a: any) => boolean) => (by.get(id) ?? []).filter(f).length;
  const label = (e: any) => ({ id: e.id, title: e.title, class_name: e.class_groups?.name ?? null, teacher: e.users?.full_name ?? null, opens_at: e.opens_at, closes_at: e.closes_at });
  const today0 = Date.parse(`${today}T00:00:00Z`);
  const papersToday = series?.length ? (await svc.from("exam_papers").select("id,series_id").eq("tenant_id", tid).eq("slot_date", today)).data ?? [] : [];
  const checkins = papersToday.length ? (await svc.from("exam_checkins").select("paper_id").eq("tenant_id", tid).in("paper_id", papersToday.map((p: any) => p.id))).data ?? [] : [];
  const seats = papersToday.length ? (await svc.from("exam_seats").select("paper_id").eq("tenant_id", tid).in("paper_id", papersToday.map((p: any) => p.id))).data ?? [] : [];
  return NextResponse.json({
    now: now.toISOString(),
    live: live.map((e: any) => ({ ...label(e), writing: count(e.id, a => a.status === "in_progress"), locked: count(e.id, a => a.status === "locked"),
      submitted: count(e.id, a => ["submitted", "graded"].includes(a.status)), flagged: count(e.id, a => (a.violations ?? 0) >= 3) })),
    upcoming: (exams ?? []).filter((e: any) => e.status === "published" && e.opens_at && Date.parse(e.opens_at) > t && Date.parse(e.opens_at) < t + 14 * DAY).slice(0, 30).map(label),
    marking: (exams ?? []).map((e: any) => ({ ...label(e), waiting: count(e.id, a => a.status === "submitted") })).filter((e: any) => e.waiting > 0).sort((a: any, b: any) => b.waiting - a.waiting).slice(0, 30),
    to_release: (exams ?? []).filter((e: any) => !e.results_released && !open(e) && count(e.id, a => a.status === "graded") > 0 && count(e.id, a => a.status === "submitted") === 0).slice(0, 30).map(label),
    requests: (requests ?? []).map((r: any) => ({ id: r.id, kind: r.kind, created_at: r.created_at, minutes: r.minutes, arrangement: r.arrangement,
      student: `${r.students?.first_name ?? ""} ${r.students?.last_name ?? ""}`.trim(), exam: r.exams?.title ?? null })),
    arrangements: { extra_time: (sen ?? []).filter((s: any) => s.extra_time_pct > 0).length, other: (sen ?? []).filter((s: any) => (s.arrangements ?? []).length > 0).length },
    incidents: (attempts ?? []).filter((a: any) => (a.violations ?? 0) >= 3).length,
    series: (series ?? []).map((s: any) => ({ ...s, running: s.starts_on <= today && s.ends_on >= today })),
    today: { papers: papersToday.length, seated: seats.length, checked_in: checkins.length, day_start: new Date(today0).toISOString() }
  });
}
