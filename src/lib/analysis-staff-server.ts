/**
 * "My analysis" for a member of staff, by what their roles allow: a teacher's own classes and
 * subjects; then a part for each role they hold (bursar: money, librarian: library, nurse:
 * sick bay, and so on), each only when the school has that module. Service client: the route
 * passes the signed-in person's own id and roles.
 */
import { fetchAll, chunks } from "./fetch-all";
import { countBy, dayIn, feeSummary, pct, attendanceRate } from "./analysis";
import { classSubjectAverages, studentsNeedingHelp } from "./analysis-staff";

type Svc = any;
const r1 = (n: number) => Math.round(n * 10) / 10;

export async function staffAnalysis(svc: Svc, p: { tenantId: string; userId: string; roles: Set<string>; timezone: string; modules: Record<string, boolean> | null }) {
  const tid = p.tenantId, uid = p.userId;
  const on = (m: string) => p.modules?.[m] !== false;
  const has = (...r: string[]) => r.some(x => p.roles.has(x));
  const admin = has("school_admin", "principal", "platform_admin");
  const failed: string[] = [];
  async function part<T>(name: string, run: () => Promise<T>): Promise<T | null> {
    try { return await run(); } catch { failed.push(name); return null; }
  }
  const today = dayIn(new Date(), p.timezone);
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const day30 = since30.slice(0, 10);
  const nowIso = new Date().toISOString();
  const { data: term } = await svc.from("terms").select("id,name,starts_on").eq("tenant_id", tid).eq("is_current", true).maybeSingle();
  const count = async (table: string, where: (q: any) => any) => {
    const { count: n, error } = await where(svc.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", tid));
    if (error) throw new Error(error.message);
    return n ?? 0;
  };

  // ---------- Teaching: the classes and subjects this person teaches ----------
  const teaching = await part("teaching", async () => {
    const [offers, forms, team] = await Promise.all([
      svc.from("subject_offerings").select("class_group_id,subject_id,subjects(name),class_groups(name)").eq("tenant_id", tid).eq("teacher_id", uid).then((r: any) => r.data ?? []),
      svc.from("class_groups").select("id,name").eq("tenant_id", tid).eq("form_teacher_id", uid).then((r: any) => r.data ?? []),
      svc.from("class_staff").select("class_group_id,subject_id,class_groups(name)").eq("tenant_id", tid).eq("user_id", uid).then((r: any) => r.data ?? []).catch(() => [])
    ]);
    const classIds = [...new Set<string>([...offers.map((o: any) => o.class_group_id), ...forms.map((f: any) => f.id), ...team.map((t: any) => t.class_group_id)])];
    if (!classIds.length) return null;
    const className = new Map<string, string>();
    for (const o of offers) className.set(o.class_group_id, o.class_groups?.name ?? "Class");
    for (const f of forms) className.set(f.id, f.name);
    for (const t of team) className.set(t.class_group_id, t.class_groups?.name ?? "Class");
    const students = await fetchAll<any>(() => svc.from("students").select("id,first_name,last_name,class_group_id").eq("tenant_id", tid).eq("status", "active").in("class_group_id", classIds).order("id"));
    const classOf = new Map<string, string>(students.map((s: any) => [s.id, s.class_group_id]));
    const ids = students.map((s: any) => s.id as string);

    const [marks, scores, hw, pointsGiven, exams] = await Promise.all([
      on("attendance") && ids.length ? Promise.all(chunks(ids).map(c => fetchAll<any>(() => svc.from("class_attendance").select("id,student_id,class_group_id,status").eq("tenant_id", tid).in("student_id", c).gte("date", day30).order("id")))).then(x => x.flat()) : Promise.resolve([]),
      on("results") && term && offers.length && ids.length ? Promise.all(chunks(ids).map(c => fetchAll<any>(() => svc.from("score_entries").select("id,student_id,subject_id,score").eq("tenant_id", tid).eq("term_id", term.id).in("subject_id", [...new Set(offers.map((o: any) => o.subject_id))]).in("student_id", c).order("id")))).then(x => x.flat()) : Promise.resolve([]),
      on("homework") ? fetchAll<any>(() => svc.from("homework").select("id,class_group_id,due_at,created_at").eq("tenant_id", tid).eq("set_by", uid).gte("created_at", since30).order("id")) : Promise.resolve([]),
      on("classroom") ? count("point_events", q => q.eq("given_by", uid).gte("created_at", since30)).catch(() => null) : Promise.resolve(null),
      on("exams") ? fetchAll<any>(() => svc.from("exams").select("id,title,status").eq("tenant_id", tid).eq("created_by", uid).order("id")) : Promise.resolve([])
    ]);

    // Attendance per class, and per student.
    const perStudent = new Map<string, { marked: number; present: number }>();
    for (const m of marks) { const v = perStudent.get(m.student_id) ?? { marked: 0, present: 0 }; v.marked++; if (m.status === "present" || m.status === "late") v.present++; perStudent.set(m.student_id, v); }
    const classes = classIds.map(id => {
      const mine = marks.filter((m: any) => m.class_group_id === id);
      return { class_group_id: id, name: className.get(id) ?? "Class", students: students.filter((s: any) => s.class_group_id === id).length,
        attendance_30: attendanceRate(mine), form_class: forms.some((f: any) => f.id === id),
        subjects: offers.filter((o: any) => o.class_group_id === id).map((o: any) => o.subjects?.name ?? "Subject") };
    }).sort((a, b) => a.name.localeCompare(b.name));

    // Marks in this teacher's subjects.
    const subjectName = new Map<string, string>(offers.map((o: any) => [o.subject_id, o.subjects?.name ?? "Subject"]));
    const averages = classSubjectAverages(scores, classOf, offers.map((o: any) => ({ class_group_id: o.class_group_id, subject_id: o.subject_id })))
      .map(a => ({ ...a, class: className.get(a.class_group_id) ?? "Class", subject: subjectName.get(a.subject_id) ?? "Subject" }))
      .sort((a, b) => a.class.localeCompare(b.class) || a.subject.localeCompare(b.subject));
    const totals = new Map<string, number>();
    for (const s of scores) if (s.score !== null) totals.set(`${s.student_id}:${s.subject_id}`, (totals.get(`${s.student_id}:${s.subject_id}`) ?? 0) + Number(s.score));
    const low = new Map<string, string[]>();
    for (const [k, v] of totals) if (v < 40) { const [sid, sub] = k.split(":") as [string, string]; low.set(sid, [...(low.get(sid) ?? []), subjectName.get(sub) ?? "a subject"]); }
    const help = studentsNeedingHelp(students.map((s: any) => ({ id: s.id, name: `${s.first_name} ${s.last_name}`, class_name: className.get(s.class_group_id) ?? null })), perStudent, low);

    // Homework this person set in 30 days: handed in, and waiting to be marked.
    let handedIn = 0, toMark = 0, expected = 0;
    if (hw.length) {
      const subs = (await Promise.all(chunks(hw.map((h: any) => h.id as string)).map(c => fetchAll<any>(() => svc.from("homework_submissions").select("id,homework_id,submitted_at,score,marked_at").eq("tenant_id", tid).in("homework_id", c).order("id"))))).flat();
      const handed = subs.filter((s: any) => s.submitted_at);
      handedIn = handed.length; toMark = handed.filter((s: any) => s.score === null && !s.marked_at).length;
      for (const h of hw) if (!h.due_at || h.due_at < nowIso) expected += students.filter((s: any) => s.class_group_id === h.class_group_id).length;
    }
    // Online exams this person wrote.
    let examFigures = null as null | { published: number; attempts: number; average: number | null };
    if (exams.length) {
      const att = (await Promise.all(chunks(exams.map((e: any) => e.id as string)).map(c => fetchAll<any>(() => svc.from("exam_attempts").select("id,total_score,auto_score,max_score,submitted_at").eq("tenant_id", tid).in("exam_id", c).not("submitted_at", "is", null).order("id"))))).flat();
      const pcts = att.filter((a: any) => Number(a.max_score) > 0).map((a: any) => (Number(a.total_score ?? a.auto_score) / Number(a.max_score)) * 100);
      examFigures = { published: exams.filter((e: any) => e.status === "published").length, attempts: att.length, average: pcts.length ? r1(pcts.reduce((a: number, b: number) => a + b, 0) / pcts.length) : null };
    }
    return {
      classes, students: students.length, averages, needing_help: help,
      homework: on("homework") ? { set_30: hw.length, handed_in: handedIn, completion: pct(handedIn, expected), to_mark: toMark } : null,
      points_given_30: pointsGiven, exams: examFigures,
      attendance_30: attendanceRate(marks)
    };
  });

  // ---------- A part for each role ----------
  const roles: Record<string, unknown> = {};
  const jobs: Promise<void>[] = [];
  const add = (key: string, when: boolean, run: () => Promise<unknown>) => { if (when) jobs.push(part(key, run).then(v => { if (v !== null) roles[key] = v; })); };

  add("money", (admin || has("bursar")) && on("fees"), async () => {
    const [invoices, payments] = await Promise.all([
      term ? fetchAll<any>(() => svc.from("fee_invoices").select("id,total,amount_paid,status,due_date").eq("tenant_id", tid).eq("term_id", term.id).order("id")) : Promise.resolve([]),
      fetchAll<any>(() => svc.from("fee_payments").select("id,amount,method,paid_at").eq("tenant_id", tid).eq("status", "success").gte("paid_at", since30).order("id"))
    ]);
    return { term: feeSummary(invoices, today), collected_30: r1(payments.reduce((a: number, x: any) => a + (Number(x.amount) || 0), 0)), payments_30: payments.length, by_method: countBy(payments, (x: any) => x.method) };
  });
  add("shop", (admin || has("bursar", "cashier")) && on("wallet"), async () => {
    const ev = await fetchAll<any>(() => svc.from("shop_events").select("id,kind,amount,operator,created_at").eq("tenant_id", tid).gte("created_at", since30).in("kind", ["purchase", "refused", "bad_code"]).order("id"));
    const sales = ev.filter((e: any) => e.kind === "purchase"), mine = sales.filter((e: any) => e.operator === uid);
    const todayRows = sales.filter((e: any) => dayIn(e.created_at, p.timezone) === today);
    return { sales_30: sales.length, takings_30: r1(sales.reduce((a: number, e: any) => a + (Number(e.amount) || 0), 0)),
      my_sales_30: mine.length, my_takings_30: r1(mine.reduce((a: number, e: any) => a + (Number(e.amount) || 0), 0)),
      today: todayRows.length, takings_today: r1(todayRows.reduce((a: number, e: any) => a + (Number(e.amount) || 0), 0)),
      refused_30: ev.filter((e: any) => e.kind === "refused").length, wrong_codes_30: ev.filter((e: any) => e.kind === "bad_code").length };
  });
  add("library", (admin || has("librarian")) && on("library"), async () => {
    const loans = await fetchAll<any>(() => svc.from("library_loans").select("id,book_id,issued_at,due_at,returned_at,library_books(title)").eq("tenant_id", tid).gte("issued_at", new Date(Date.now() - 90 * 86_400_000).toISOString()).order("id"));
    const open = await count("library_loans", q => q.is("returned_at", null));
    const overdue = await count("library_loans", q => q.is("returned_at", null).lt("due_at", nowIso));
    return { on_loan: open, overdue, issued_30: loans.filter((l: any) => l.issued_at >= since30).length, popular: countBy(loans, (l: any) => l.library_books?.title).filter(x => x.key !== "Not set").slice(0, 8) };
  });
  add("health", (admin || has("nurse")) && on("health"), async () => {
    const v = await fetchAll<any>(() => svc.from("sickbay_visits").select("id,complaint,outcome,follow_up_on,at").eq("tenant_id", tid).gte("at", since30).order("id"));
    return { visits_30: v.length, today: v.filter((x: any) => dayIn(x.at, p.timezone) === today).length, sent_home: v.filter((x: any) => /home/i.test(x.outcome ?? "")).length,
      follow_ups_due: v.filter((x: any) => x.follow_up_on && x.follow_up_on <= today).length,
      by_reason: countBy(v, (x: any) => (x.complaint ?? "").trim().toLowerCase() || null).filter(x => x.key !== "Not set").slice(0, 8) };
  });
  add("gate", (admin || has("gate_officer")) && on("gate"), async () => {
    const ev = await fetchAll<any>(() => svc.from("gate_events").select("id,person_type,direction,late,at").eq("tenant_id", tid).eq("direction", "in").gte("at", since30).order("id"));
    const t = ev.filter((e: any) => dayIn(e.at, p.timezone) === today);
    return { in_today: t.length, late_today: t.filter((e: any) => e.late).length, late_30: ev.filter((e: any) => e.late).length, staff_late_30: ev.filter((e: any) => e.late && e.person_type === "staff").length };
  });
  add("admissions", (admin || has("admissions_officer")) && on("admissions"), async () => {
    const leads = await fetchAll<any>(() => svc.from("admission_leads").select("id,stage,next_follow_up_at,source").eq("tenant_id", tid).not("stage", "in", "(enrolled,lost)").order("id"));
    return { open: leads.length, no_follow_up: leads.filter((l: any) => !l.next_follow_up_at).length, follow_ups_overdue: leads.filter((l: any) => l.next_follow_up_at && l.next_follow_up_at < nowIso).length,
      by_stage: countBy(leads, (l: any) => l.stage?.replace(/_/g, " ")), applications_30: await count("applications", q => q.gte("created_at", since30)) };
  });
  add("hr", (admin || has("hr_manager")) && on("hr"), async () => {
    const [staff, pending, onLeave] = await Promise.all([
      fetchAll<any>(() => svc.from("staff").select("id,status,department").eq("tenant_id", tid).neq("status", "exited").order("id")),
      count("leave_requests", q => q.eq("status", "pending")),
      count("leave_requests", q => q.eq("status", "approved").lte("starts_on", today).gte("ends_on", today))
    ]);
    return { staff: staff.length, on_leave_today: onLeave, leave_pending: pending, by_department: countBy(staff, (s: any) => s.department).slice(0, 8) };
  });
  add("welfare", (admin || has("counsellor")) && (on("behaviour") || on("sen")), async () => {
    const [checks, referrals] = await Promise.all([
      fetchAll<any>(() => svc.from("wellbeing_checkins").select("id,mood,wants_to_talk,followed_up_at,created_at").eq("tenant_id", tid).gte("created_at", since30).order("id")).catch(() => []),
      count("pastoral_referrals", q => q.eq("status", "new")).catch(() => null)
    ]);
    const moods = checks.map((c: any) => Number(c.mood)).filter(Number.isFinite);
    return { checkins_30: checks.length, average_mood: moods.length ? r1(moods.reduce((a: number, b: number) => a + b, 0) / moods.length) : null,
      want_to_talk: checks.filter((c: any) => c.wants_to_talk && !c.followed_up_at).length, referrals_open: referrals };
  });
  add("exams_office", (admin || has("exam_officer")) && on("exams"), async () => ({
    published: await count("exams", q => q.eq("status", "published")),
    sat_30: await count("exam_attempts", q => q.gte("submitted_at", since30)),
    requests_pending: await count("exam_requests", q => q.eq("status", "pending")).catch(() => null),
    not_released: await count("exams", q => q.eq("status", "closed").eq("results_released", false)).catch(() => null)
  }));
  add("boarding", (admin || has("hostel_warden")) && on("hostel"), async () => ({
    boarders: await count("hostel_allocations", q => q.is("ended_at", null)),
    exeat_pending: await count("exeat_requests", q => q.eq("status", "pending")),
    out_now: await count("exeat_requests", q => q.eq("status", "out")),
    overdue_back: await count("exeat_requests", q => q.eq("status", "out").lt("return_by", nowIso))
  }));
  add("transport", (admin || has("transport_officer")) && on("transport"), async () => {
    const ev = await fetchAll<any>(() => svc.from("transport_events").select("id,kind,route_id,at").eq("tenant_id", tid).gte("at", since30).order("id"));
    return { routes: await count("transport_routes", q => q), trips_30: ev.length, by_kind: countBy(ev, (e: any) => e.kind?.replace(/_/g, " ")) };
  });
  add("quality", (admin || has("qa_officer")) && on("qa"), async () => {
    const obs = await fetchAll<any>(() => svc.from("qa_observations").select("id,total,max_total,observed_on,acknowledged_at").eq("tenant_id", tid).gte("observed_on", new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)).order("id"));
    const scored = obs.filter((o: any) => Number(o.max_total) > 0).map((o: any) => (Number(o.total) / Number(o.max_total)) * 100);
    return { observations_90: obs.length, average: scored.length ? r1(scored.reduce((a: number, b: number) => a + b, 0) / scored.length) : null,
      not_acknowledged: obs.filter((o: any) => !o.acknowledged_at).length,
      notes_to_review: on("lesson_notes") ? await count("lesson_notes", q => q.eq("status", "submitted")).catch(() => null) : null };
  });
  await Promise.all(jobs);

  // ---------- Me: my own sign-ins, leave and observations ----------
  const me = await part("me", async () => {
    const { data: st } = await svc.from("staff").select("id,leave_allowance").eq("tenant_id", tid).eq("user_id", uid).maybeSingle();
    if (!st) return null;
    const yearStart = `${today.slice(0, 4)}-01-01`;
    const [leave, gate, obs] = await Promise.all([
      on("hr") ? fetchAll<any>(() => svc.from("leave_requests").select("id,days,status").eq("tenant_id", tid).eq("staff_id", st.id).gte("starts_on", yearStart).order("id")) : Promise.resolve(null),
      on("gate") ? fetchAll<any>(() => svc.from("gate_events").select("id,late,at").eq("tenant_id", tid).eq("staff_id", st.id).eq("direction", "in").gte("at", since30).order("id")) : Promise.resolve(null),
      on("qa") ? fetchAll<any>(() => svc.from("qa_observations").select("id,total,max_total").eq("tenant_id", tid).eq("staff_id", st.id).order("id")).catch(() => null) : Promise.resolve(null)
    ]);
    const used = (leave ?? []).filter((l: any) => l.status === "approved").reduce((a: number, l: any) => a + (Number(l.days) || 0), 0);
    const obsPct = (obs ?? []).filter((o: any) => Number(o.max_total) > 0).map((o: any) => (Number(o.total) / Number(o.max_total)) * 100);
    return {
      leave: leave ? { used: r1(used), allowance: st.leave_allowance ?? null, pending: leave.filter((l: any) => l.status === "pending").length } : null,
      sign_ins_30: gate ? new Set(gate.map((g: any) => dayIn(g.at, p.timezone))).size : null, late_30: gate ? gate.filter((g: any) => g.late).length : null,
      observations: obs ? { count: obs.length, average: obsPct.length ? r1(obsPct.reduce((a: number, b: number) => a + b, 0) / obsPct.length) : null } : null
    };
  });

  return { term: term ? { id: term.id, name: term.name } : null, today, admin, teaching, roles, me, unavailable: failed, generated_at: nowIso };
}

export type StaffAnalysis = Awaited<ReturnType<typeof staffAnalysis>>;
