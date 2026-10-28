/**
 * The weekly report to parents (phase 14q), the server part: called by the slow
 * scheduler every few minutes. A school whose Friday afternoon has come (and that
 * has not switched the report off) gets its week gathered once, and each family
 * is sent one message on the channels they chose. Muting "Learning and results"
 * stops it, like any other learning message.
 */
import { fetchAll } from "@/lib/results";
import { guardiansByStudent, rowsForGuardian, enqueue, loadBrand, type OutboxRow, type Guardian } from "@/lib/messaging/outbox";
import { dueWeek, hasNews, renderWeekly, weekLabel, type ChildWeek } from "@/lib/weekly-report";

type Student = { id: string; first_name: string; last_name: string; class_group_id: string | null; class_groups: { name: string } | null };

/** Every active student's week, keyed by student id. */
export async function gatherWeek(svc: any, tenantId: string, from: string, to: string): Promise<Map<string, ChildWeek>> {
  const start = `${from}T00:00:00Z`, end = `${to}T23:59:59Z`;
  const students = await fetchAll<Student>(() => svc.from("students").select("id,first_name,last_name,class_group_id,class_groups(name)").eq("tenant_id", tenantId).eq("status", "active").order("id"));
  const [points, marks, homework, posts] = await Promise.all([
    fetchAll<{ student_id: string; points: number; skill_name: string | null }>(() => svc.from("point_events").select("student_id,points,skill_name").eq("tenant_id", tenantId).gte("created_at", start).lte("created_at", end).order("id")),
    fetchAll<{ student_id: string; status: string }>(() => svc.from("class_attendance").select("student_id,status").eq("tenant_id", tenantId).gte("date", from).lte("date", to).order("id")),
    fetchAll<{ id: string; class_group_id: string }>(() => svc.from("homework").select("id,class_group_id").eq("tenant_id", tenantId).gte("due_at", start).lte("due_at", end).order("id")),
    fetchAll<{ class_group_id: string }>(() => svc.from("class_story_posts").select("class_group_id").eq("tenant_id", tenantId).gte("created_at", start).lte("created_at", end).order("id"))
  ]);
  const hwIds = homework.map(h => h.id);
  const subs: { homework_id: string; student_id: string }[] = [];
  for (let i = 0; i < hwIds.length; i += 200) {
    const chunk = hwIds.slice(i, i + 200);
    subs.push(...await fetchAll<{ homework_id: string; student_id: string }>(() => svc.from("homework_submissions").select("homework_id,student_id").eq("tenant_id", tenantId).in("homework_id", chunk).order("id")));
  }
  const hwByClass = new Map<string, string[]>();
  for (const h of homework) hwByClass.set(h.class_group_id, [...(hwByClass.get(h.class_group_id) ?? []), h.id]);
  const handedIn = new Set(subs.map(s => `${s.student_id}|${s.homework_id}`));
  const postsByClass = new Map<string, number>();
  for (const p of posts) postsByClass.set(p.class_group_id, (postsByClass.get(p.class_group_id) ?? 0) + 1);

  const out = new Map<string, ChildWeek>();
  for (const s of students) {
    out.set(s.id, { name: `${s.first_name} ${s.last_name}`.trim(), className: s.class_groups?.name ?? null, points: 0, skills: [],
      present: 0, late: 0, absent: 0, excused: 0, homeworkSet: 0, homeworkDone: 0, storyPosts: s.class_group_id ? postsByClass.get(s.class_group_id) ?? 0 : 0 });
    const set = s.class_group_id ? hwByClass.get(s.class_group_id) ?? [] : [];
    const c = out.get(s.id)!;
    c.homeworkSet = set.length;
    c.homeworkDone = set.filter(h => handedIn.has(`${s.id}|${h}`)).length;
  }
  const skillCount = new Map<string, Map<string, number>>();
  for (const p of points) {
    const c = out.get(p.student_id);
    if (!c) continue;
    c.points += Number(p.points) || 0;
    if (p.skill_name && Number(p.points) > 0) {
      const m = skillCount.get(p.student_id) ?? new Map<string, number>();
      m.set(p.skill_name, (m.get(p.skill_name) ?? 0) + 1);
      skillCount.set(p.student_id, m);
    }
  }
  for (const [id, m] of skillCount) out.get(id)!.skills = [...m].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k);
  for (const m of marks) {
    const c = out.get(m.student_id);
    if (c && (m.status === "present" || m.status === "late" || m.status === "absent" || m.status === "excused")) c[m.status] += 1;
  }
  return out;
}

/** The messages for every family with news this week. */
export async function weeklyRows(svc: any, tenantId: string, week: { from: string; to: string }, base: string): Promise<{ rows: OutboxRow[]; families: number }> {
  const [kids, brand] = await Promise.all([gatherWeek(svc, tenantId, week.from, week.to), loadBrand(svc, tenantId)]);
  const withNews = [...kids].filter(([, c]) => hasNews(c));
  const byStudent = await guardiansByStudent(svc, tenantId, withNews.map(([id]) => id));
  const families = new Map<string, { g: Guardian; children: ChildWeek[] }>();
  for (const [sid, c] of withNews) for (const g of byStudent.get(sid) ?? []) {
    const f = families.get(g.id) ?? { g, children: [] };
    f.children.push(c);
    families.set(g.id, f);
  }
  const label = weekLabel(week.from, week.to);
  const rows: OutboxRow[] = [];
  for (const { g, children } of families.values()) {
    const link = g.user_id ? `${base}/parent` : g.portal_token ? `${base}/g/${g.portal_token}` : base;
    rows.push(...rowsForGuardian(tenantId, g, "weekly_report", renderWeekly(brand, { guardianName: g.full_name, weekLabel: label, children, link }), null, null));
  }
  return { rows, families: families.size };
}

/** The scheduler's part: send each due school's week once. At most a few schools per run. */
export async function runWeeklyParentReports(svc: any, base: string, opts: { now?: Date; maxSchools?: number } = {}) {
  const now = opts.now ?? new Date();
  const out = { schools: 0, families: 0, messages: 0 };
  const { data: schools, error } = await svc.from("tenant_settings").select("tenant_id,tenants(status,timezone)").eq("weekly_parent_report", true).limit(5000);
  if (error) return out;   // before migration 8100
  for (const s of schools ?? []) {
    if (out.schools >= (opts.maxSchools ?? 5)) break;
    if (s.tenants?.status !== "active") continue;
    const week = dueWeek(now, s.tenants?.timezone ?? "Africa/Lagos");
    if (!week) continue;
    // Claim this school's week; a second run (or a second server) gets a conflict and moves on.
    const { error: claimed } = await svc.from("weekly_report_runs").insert({ tenant_id: s.tenant_id, week_key: week.key });
    if (claimed) continue;
    out.schools++;
    try {
      const { rows, families } = await weeklyRows(svc, s.tenant_id, week, base);
      if (rows.length) await enqueue(svc, rows);
      out.families += families; out.messages += rows.length;
      await svc.from("weekly_report_runs").update({ finished_at: new Date().toISOString(), families, messages: rows.length }).eq("tenant_id", s.tenant_id).eq("week_key", week.key);
    } catch (e) {
      console.error("[weekly report]", s.tenant_id, (e as Error).message);
    }
  }
  return out;
}
