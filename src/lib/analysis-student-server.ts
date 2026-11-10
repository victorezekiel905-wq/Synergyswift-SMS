/**
 * One student's analysis across every module the school uses, for their parents and for the
 * student. Service client: callers must check first that the viewer may see this student.
 * Results come from published report cards only, and exam scores only once released, so
 * families never see marks the school has not finished with. Fees show to parents only.
 */
import { fetchAll } from "./fetch-all";
import { countBy, dayIn, feeSummary } from "./analysis";
import { attendanceSummary, cardSubjects, subjectChanges, termTrend, homeworkStats, testScores, childNotes, type ChildNote } from "./analysis-student";

type Svc = any;
const r1 = (n: number) => Math.round(n * 10) / 10;

export async function studentAnalysis(svc: Svc, p: { tenantId: string; studentId: string; timezone: string; modules: Record<string, boolean> | null; forParent: boolean }) {
  const tid = p.tenantId, sid = p.studentId;
  const on = (m: string) => p.modules?.[m] !== false;
  const failed: string[] = [];
  async function part<T>(name: string, run: () => Promise<T>): Promise<T | null> {
    try { return await run(); } catch { failed.push(name); return null; }
  }

  const { data: st } = await svc.from("students").select("id,first_name,last_name,class_group_id,user_id,class_groups(name)").eq("tenant_id", tid).eq("id", sid).maybeSingle();
  if (!st) return null;
  const { data: term } = await svc.from("terms").select("id,name,starts_on,ends_on").eq("tenant_id", tid).eq("is_current", true).maybeSingle();
  const today = dayIn(new Date(), p.timezone);
  // This term, or the last 90 days when the school has no current term.
  const from = term?.starts_on && term.starts_on <= today ? term.starts_on : new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const fromIso = `${from}T00:00:00Z`;
  const nowIso = new Date().toISOString();

  const [attendance, arrivals, results, tests, homework, behaviour, learning, activities, health, library, fees, shop] = await Promise.all([
    on("attendance") ? part("attendance", async () => {
      const marks = await fetchAll<{ date: string; status: string }>(() => svc.from("class_attendance").select("id,date,status").eq("tenant_id", tid).eq("student_id", sid).gte("date", from).order("id"));
      return attendanceSummary(marks);
    }) : null,

    on("gate") ? part("arrivals", async () => {
      const ev = await fetchAll<{ late: boolean | null; at: string }>(() => svc.from("gate_events").select("id,late,at").eq("tenant_id", tid).eq("student_id", sid).eq("direction", "in").gte("at", fromIso).order("id"));
      const days = new Map<string, boolean>();
      for (const e of ev) { const d = dayIn(e.at, p.timezone); days.set(d, (days.get(d) ?? false) || Boolean(e.late)); }
      return { days: days.size, late: [...days.values()].filter(Boolean).length };
    }) : null,

    on("results") ? part("results", async () => {
      const [cards, terms] = await Promise.all([
        fetchAll<any>(() => svc.from("report_cards").select("id,term_id,average,position,class_size,status,data,kind").eq("tenant_id", tid).eq("student_id", sid).eq("status", "published").order("id")),
        fetchAll<{ id: string; name: string; starts_on: string | null }>(() => svc.from("terms").select("id,name,starts_on").eq("tenant_id", tid).order("id"))
      ]);
      const termCards = cards.filter(c => (c.kind ?? "term") === "term");
      const trend = termTrend(termCards, terms);
      const latest = trend.length ? termCards.find(c => c.term_id === trend[trend.length - 1]!.term_id) : null;
      const previous = trend.length > 1 ? termCards.find(c => c.term_id === trend[trend.length - 2]!.term_id) : null;
      const subjects = latest ? cardSubjects(latest.data) : [];
      const changes = previous ? subjectChanges(subjects, cardSubjects(previous.data)) : [];
      const change = new Map(changes.map(c => [c.subject_id, c.change]));
      return {
        trend, term: trend.length ? trend[trend.length - 1]!.term : null,
        subjects: subjects.map(s => ({ ...s, change: change.get(s.subject_id) ?? null })),
        strongest: subjects[0] ?? null, weakest: subjects.length > 1 ? subjects[subjects.length - 1]! : null,
        above_class_average: subjects.filter(s => s.class_average !== null && s.score >= s.class_average).length,
        falling: changes.filter(c => c.change <= -8).map(c => ({ subject: subjects.find(s => s.subject_id === c.subject_id)?.subject ?? "A subject", change: c.change })).sort((a, b) => a.change - b.change)
      };
    }) : null,

    on("exams") && st.user_id ? part("tests", async () => {
      const [attempts, practice] = await Promise.all([
        fetchAll<any>(() => svc.from("exam_attempts").select("id,submitted_at,total_score,auto_score,max_score,exams!inner(title,results_released)").eq("tenant_id", tid).eq("student_user_id", st.user_id).not("submitted_at", "is", null).eq("exams.results_released", true).order("id")),
        fetchAll<any>(() => svc.from("practice_sessions").select("id,finished_at,score,max_score").eq("tenant_id", tid).eq("student_user_id", st.user_id).not("finished_at", "is", null).gte("finished_at", fromIso).order("id")).catch(() => [])
      ]);
      return {
        exams: testScores(attempts.map(a => ({ title: a.exams?.title ?? "Exam", at: a.submitted_at, score: a.total_score ?? a.auto_score, max: a.max_score }))),
        practice: testScores(practice.map(s => ({ title: "Practice", at: s.finished_at, score: s.score, max: s.max_score })))
      };
    }) : null,

    on("homework") && st.class_group_id ? part("homework", async () => {
      const [work, subs] = await Promise.all([
        fetchAll<any>(() => svc.from("homework").select("id,due_at,max_score,created_at,subjects(name)").eq("tenant_id", tid).eq("class_group_id", st.class_group_id).gte("created_at", fromIso).order("id")),
        fetchAll<any>(() => svc.from("homework_submissions").select("id,homework_id,submitted_at,late,score").eq("tenant_id", tid).eq("student_id", sid).gte("submitted_at", fromIso).order("id"))
      ]);
      return homeworkStats(work.map(w => ({ id: w.id, due_at: w.due_at, subject: w.subjects?.name ?? null, max_score: w.max_score })), subs, nowIso);
    }) : null,

    on("behaviour") || on("classroom") ? part("behaviour", async () => {
      const [records, points] = await Promise.all([
        on("behaviour") ? fetchAll<{ kind: string; points: number | null; occurred_at: string }>(() => svc.from("behaviour_records").select("id,kind,points,occurred_at").eq("tenant_id", tid).eq("student_id", sid).gte("occurred_at", fromIso).order("id")) : Promise.resolve([]),
        on("classroom") ? fetchAll<{ points: number; skill_name: string | null }>(() => svc.from("point_events").select("id,points,skill_name").eq("tenant_id", tid).eq("student_id", sid).gte("created_at", fromIso).order("id")).catch(() => []) : Promise.resolve([])
      ]);
      const positive = records.filter(r => r.kind === "positive" || (r.points ?? 0) > 0).length;
      const negative = records.filter(r => r.kind === "negative" || (r.points ?? 0) < 0).length;
      const good = points.filter(x => x.points > 0), needs = points.filter(x => x.points < 0);
      return {
        positive, negative, house_points: records.reduce((a, r) => a + (r.points ?? 0), 0),
        class_points: points.reduce((a, x) => a + x.points, 0),
        top_skills: countBy(good, x => x.skill_name).filter(x => x.key !== "Not set").slice(0, 5),
        needs_work: countBy(needs, x => x.skill_name).filter(x => x.key !== "Not set").slice(0, 3)
      };
    }) : null,

    on("lms") ? part("learning", async () => {
      const [steps, content, joins, activity] = await Promise.all([
        fetchAll<{ status: string; score: number | null }>(() => svc.from("learning_path_progress").select("step_id,status,score").eq("tenant_id", tid).eq("student_id", sid).order("step_id")).catch(() => []),
        fetchAll<{ status: string; score: number | null; time_seconds: number | null }>(() => svc.from("content_attempts").select("id,status,score,time_seconds").eq("tenant_id", tid).eq("student_id", sid).gte("started_at", fromIso).order("id")).catch(() => []),
        fetchAll<{ joined_at: string }>(() => svc.from("online_lesson_joins").select("lesson_id,joined_at").eq("tenant_id", tid).eq("student_id", sid).gte("joined_at", fromIso).order("lesson_id")).catch(() => []),
        fetchAll<{ points: number | null; on_date: string }>(() => svc.from("learning_activity").select("id,points,on_date").eq("tenant_id", tid).eq("student_id", sid).gte("on_date", from).order("id")).catch(() => [])
      ]);
      const done = steps.filter(s => s.status === "done" || s.status === "passed");
      const scored = done.map(s => Number(s.score)).filter(Number.isFinite);
      return {
        steps_done: done.length, steps_started: steps.length,
        step_average: scored.length ? r1(scored.reduce((a, b) => a + b, 0) / scored.length) : null,
        lessons_completed: content.filter(c => c.status === "completed" || c.status === "passed").length,
        minutes: Math.round(content.reduce((a, c) => a + (c.time_seconds ?? 0), 0) / 60),
        online_lessons_joined: joins.length,
        active_days: new Set(activity.map(a => a.on_date)).size,
        learning_points: activity.reduce((a, x) => a + (x.points ?? 0), 0)
      };
    }) : null,

    part("activities", async () => {
      const [clubs, entries, achievements, badges] = await Promise.all([
        on("events") ? fetchAll<any>(() => svc.from("cc_members").select("group_id,status,cc_groups(name)").eq("tenant_id", tid).eq("student_id", sid).order("group_id")).catch(() => []) : Promise.resolve([]),
        on("events") ? fetchAll<any>(() => svc.from("competition_entries").select("id,position,award,created_at").eq("tenant_id", tid).eq("student_id", sid).order("id")).catch(() => []) : Promise.resolve([]),
        fetchAll<any>(() => svc.from("student_achievements").select("id,title,achieved_on,shared_with_family,status").eq("tenant_id", tid).eq("student_id", sid).order("id")).catch(() => []),
        fetchAll<any>(() => svc.from("student_badges").select("id,awarded_at").eq("tenant_id", tid).eq("student_id", sid).order("id")).catch(() => [])
      ]);
      const shown = achievements.filter((a: any) => (p.forParent ? a.shared_with_family !== false : true) && a.status !== "rejected");
      return {
        clubs: clubs.filter((c: any) => c.status === "active").map((c: any) => c.cc_groups?.name ?? "Club"),
        competitions: entries.length, placed: entries.filter((e: any) => e.position && e.position <= 3).length,
        achievements: shown.length, recent: shown.sort((a: any, b: any) => String(b.achieved_on ?? "").localeCompare(String(a.achieved_on ?? ""))).slice(0, 5).map((a: any) => ({ title: a.title, on: a.achieved_on })),
        badges: badges.length
      };
    }),

    on("health") ? part("health", async () => {
      const visits = await fetchAll<{ complaint: string | null; at: string }>(() => svc.from("sickbay_visits").select("id,complaint,at").eq("tenant_id", tid).eq("student_id", sid).gte("at", fromIso).order("id"));
      return { visits: visits.length, by_reason: countBy(visits, v => (v.complaint ?? "").trim().toLowerCase() || null).filter(x => x.key !== "Not set").slice(0, 5) };
    }) : null,

    on("library") ? part("library", async () => {
      const loans = await fetchAll<{ issued_at: string; due_at: string | null; returned_at: string | null }>(() => svc.from("library_loans").select("id,issued_at,due_at,returned_at").eq("tenant_id", tid).eq("student_id", sid).order("id"));
      return { borrowed_this_term: loans.filter(l => l.issued_at >= fromIso).length, read_all_time: loans.filter(l => l.returned_at).length,
        on_loan: loans.filter(l => !l.returned_at).length, overdue: loans.filter(l => !l.returned_at && l.due_at && l.due_at < nowIso).length };
    }) : null,

    p.forParent && on("fees") ? part("fees", async () => {
      const inv = await fetchAll<any>(() => svc.from("fee_invoices").select("id,total,amount_paid,status,due_date,term_id").eq("tenant_id", tid).eq("student_id", sid).order("id"));
      const all = feeSummary(inv, today), thisTerm = term ? feeSummary(inv.filter((i: any) => i.term_id === term.id), today) : null;
      return { this_term: thisTerm, all_time: all, overdue: all.overdue_invoices };
    }) : null,

    on("wallet") ? part("shop", async () => {
      const tx = await fetchAll<{ amount: number; items: any; created_at: string }>(() => svc.from("wallet_transactions").select("id,amount,items,created_at").eq("tenant_id", tid).eq("student_id", sid).eq("kind", "purchase").eq("status", "success").gte("created_at", fromIso).order("id"));
      const cats = new Map<string, number>();
      for (const t of tx) {
        const lines = Array.isArray(t.items) ? t.items : [];
        if (!lines.length) cats.set("Other", (cats.get("Other") ?? 0) + Math.abs(Number(t.amount) || 0));
        for (const l of lines) cats.set(l.category ?? "Other", (cats.get(l.category ?? "Other") ?? 0) + (Number(l.qty) || 0) * (Number(l.price) || 0));
      }
      const spent = tx.reduce((a, t) => a + Math.abs(Number(t.amount) || 0), 0);
      return { buys: tx.length, spent: Math.round(spent * 100) / 100, by_category: [...cats.entries()].map(([key, v]) => ({ key, count: Math.round(v) })).sort((a, b) => b.count - a.count) };
    }) : null
  ]);

  const first = st.first_name as string;
  const notes: ChildNote[] = childNotes({
    attendance, homework, behaviour, library, lateArrivals: arrivals?.late ?? null,
    results: results ? { trend: results.trend, weakest: results.weakest, strongest: results.strongest, falling: results.falling } : null,
    fees: fees ? { overdue: fees.overdue } : null
  }, { forParent: p.forParent, name: first });

  return {
    student: { id: st.id, name: `${st.first_name} ${st.last_name}`, first_name: first, class_name: st.class_groups?.name ?? null },
    term: term ? { id: term.id, name: term.name, starts_on: term.starts_on, ends_on: term.ends_on } : null,
    from, today, generated_at: nowIso,
    attendance, arrivals, results, tests, homework, behaviour, learning, activities, health, library, fees, shop,
    notes, unavailable: failed
  };
}

export type StudentAnalysis = NonNullable<Awaited<ReturnType<typeof studentAnalysis>>>;
