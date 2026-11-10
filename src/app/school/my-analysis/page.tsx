"use client";
import Link from "next/link";
import { useApi, Page, PageHeader, Stat, Alert, Loading, Empty, money } from "@/components/ui";
import { Card, Figure, Figures, Bars, Split, Notes, Table, num, per, tone, type Note } from "@/components/analysis/Charts";
import type { StaffAnalysis } from "@/lib/analysis-staff-server";

type Data = { currency: string; name: string; roles: string[]; analysis: StaffAnalysis };
const R = (x: unknown) => x as any;

/** Staff: the figures their roles cover, starting with their own classes. */
export default function MyAnalysisPage() {
  const { data, error, reload } = useApi<Data>("/api/staff/analysis");
  if (error) return <Page wide><PageHeader eyebrow="Analysis" title="My analysis" /><Alert>{error}</Alert></Page>;
  if (!data) return <Page wide><PageHeader eyebrow="Analysis" title="My analysis" /><Loading label="Bringing your figures together…" /></Page>;
  const a = data.analysis, t = a.teaching, roles = a.roles as Record<string, any>, cur = data.currency;
  const notes: Note[] = [];
  if (t) {
    for (const c of t.classes) if (c.attendance_30 !== null && c.attendance_30 < 90) notes.push({ tone: "warn", text: `${c.name}: attendance is ${c.attendance_30}% over 30 days.`, href: "/school/attendance" });
    for (const x of t.averages) if (x.students && x.below_pass / x.students >= 0.3) notes.push({ tone: "bad", text: `${x.class} ${x.subject}: ${x.below_pass} of ${x.students} students are below the pass mark this term.`, href: "/school/results" });
    if (t.homework?.to_mark) notes.push({ tone: "warn", text: `${t.homework.to_mark} homework submission${t.homework.to_mark === 1 ? "" : "s"} waiting for you to mark.`, href: "/school/homework" });
    if (t.needing_help.length) notes.push({ tone: "warn", text: `${t.needing_help.length} student${t.needing_help.length === 1 ? "" : "s"} in your classes may need help (see below).`, href: null });
  }
  if (roles.money?.term.overdue_invoices) notes.push({ tone: "warn", text: `${roles.money.term.overdue_invoices} fee invoices are past the due date.`, href: "/school/fees" });
  if (roles.library?.overdue) notes.push({ tone: "warn", text: `${roles.library.overdue} library books are overdue.`, href: "/school/library" });
  if (roles.health?.follow_ups_due) notes.push({ tone: "warn", text: `${roles.health.follow_ups_due} sick bay follow-ups are due.`, href: "/school/health" });
  if (roles.admissions?.no_follow_up) notes.push({ tone: "warn", text: `${roles.admissions.no_follow_up} enquiries have no follow-up booked.`, href: "/school/admissions" });
  if (roles.hr?.leave_pending) notes.push({ tone: "warn", text: `${roles.hr.leave_pending} leave requests waiting for a decision.`, href: "/school/hr?tab=leave" });
  if (roles.welfare?.want_to_talk) notes.push({ tone: "bad", text: `${roles.welfare.want_to_talk} students asked to talk and have not been followed up.`, href: "/school/pastoral" });
  if (roles.exams_office?.requests_pending) notes.push({ tone: "warn", text: `${roles.exams_office.requests_pending} exam requests waiting.`, href: "/school/exams-office" });
  if (roles.boarding?.overdue_back) notes.push({ tone: "bad", text: `${roles.boarding.overdue_back} boarders are past their return time.`, href: "/school/hostel" });
  if (!notes.length) notes.push({ tone: "good", text: "Nothing in your areas needs attention right now.", href: null });
  const nothing = !t && !Object.keys(roles).length && !a.me;

  return (
    <Page wide>
      <PageHeader eyebrow="Analysis" title="My analysis"
        subtitle={`${data.name} · the figures your roles cover${a.term ? ` · ${a.term.name}` : ""}.`}
        actions={<>{a.admin && <Link href="/school/analysis" className="btn btn-outline text-xs">Whole-school dashboard</Link>}<button className="btn btn-outline text-xs" onClick={reload}>Refresh</button></>} />
      {a.unavailable.length > 0 && <div className="mb-4"><Alert tone="amber">Some parts could not be loaded right now ({a.unavailable.join(", ")}). Press Refresh to try again.</Alert></div>}
      <Notes title="Needs your attention" notes={notes} />
      {nothing && <Empty>No figures for your roles yet. When you are given classes or duties, they show here.</Empty>}

      {t && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="My classes" value={num(t.classes.length)} hint={`${t.students} students`} />
            <Stat label="Attendance (30 days)" value={per(t.attendance_30)} tone={tone(t.attendance_30, 95, 90)} />
            <Stat label="Homework handed in" value={per(t.homework?.completion)} tone={tone(t.homework?.completion, 85, 65)} hint={t.homework ? `${t.homework.set_30} set in 30 days` : undefined} />
            <Stat label="To mark" value={num(t.homework?.to_mark)} tone={t.homework?.to_mark ? "warn" : undefined} hint={t.points_given_30 !== null ? `${t.points_given_30} points given` : undefined} />
          </div>
          <div className="mb-5 grid gap-5 lg:grid-cols-2">
            <Card title="My classes" href="/school/attendance">
              <Table head={["Class", "Students", "Attendance (30 days)"]} rows={t.classes.map(c => [
                <span key="c">{c.name}{c.form_class && <span className="ml-1 text-xs text-slate-500">(form class)</span>}{c.subjects.length > 0 && <span className="block text-xs text-slate-500">{c.subjects.join(", ")}</span>}</span>,
                c.students, per(c.attendance_30)])} />
            </Card>
            <Card title="My subjects this term" href="/school/results">
              <Table head={["Class and subject", "Students marked", "Average", "Below pass"]} empty="No marks entered for your subjects this term yet."
                rows={t.averages.map(x => [`${x.class} · ${x.subject}`, x.students, x.average ?? "—", <span key="b" className={x.below_pass ? "text-rose-700" : ""}>{x.below_pass}</span>])} />
            </Card>
            <Card title="Students who may need help">
              <Table head={["Student", "Why"]} empty="No one in your classes stands out right now."
                rows={t.needing_help.map(s => [<span key="s">{s.name}<span className="block text-xs text-slate-500">{s.class_name}</span></span>, <span key="r" className="text-xs">{s.reasons.join("; ")}</span>])} />
            </Card>
            {t.exams && (
              <Card title="My online exams" href="/exams">
                <Figures>
                  <Figure label="Published" value={num(t.exams.published)} />
                  <Figure label="Scripts" value={num(t.exams.attempts)} />
                  <Figure label="Average" value={t.exams.average === null ? "—" : `${t.exams.average}%`} />
                </Figures>
              </Card>
            )}
          </div>
        </>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {roles.money && <Card title="Fees" href="/school/fees">
          <Figures>
            <Figure label="Collected this term" value={per(R(roles.money).term.rate)} hint={`${money(roles.money.term.collected, cur)} of ${money(roles.money.term.billed, cur)}`} />
            <Figure label="Still owed" value={money(roles.money.term.outstanding, cur)} />
            <Figure label="Past due" value={`${roles.money.term.overdue_invoices} · ${money(roles.money.term.overdue_amount, cur)}`} />
            <Figure label="Received (30 days)" value={money(roles.money.collected_30, cur)} hint={`${roles.money.payments_30} payments`} />
          </Figures>
          <Split title="How parents paid (30 days)" rows={roles.money.by_method} />
        </Card>}
        {roles.shop && <Card title="Tuck shop" href="/school/shop">
          <Figures>
            <Figure label="Sales today" value={num(roles.shop.today)} hint={money(roles.shop.takings_today, cur)} />
            <Figure label="Sales (30 days)" value={num(roles.shop.sales_30)} hint={money(roles.shop.takings_30, cur)} />
            <Figure label="My sales (30 days)" value={num(roles.shop.my_sales_30)} hint={money(roles.shop.my_takings_30, cur)} />
            <Figure label="Refused · wrong codes" value={`${roles.shop.refused_30} · ${roles.shop.wrong_codes_30}`} />
          </Figures>
        </Card>}
        {roles.library && <Card title="Library" href="/school/library">
          <Figures>
            <Figure label="Books out" value={num(roles.library.on_loan)} />
            <Figure label="Overdue" value={num(roles.library.overdue)} />
            <Figure label="Issued (30 days)" value={num(roles.library.issued_30)} />
          </Figures>
          <Bars title="Most borrowed (90 days)" rows={roles.library.popular} />
        </Card>}
        {roles.health && <Card title="Sick bay" href="/school/health">
          <Figures>
            <Figure label="Visits today" value={num(roles.health.today)} />
            <Figure label="Visits (30 days)" value={num(roles.health.visits_30)} />
            <Figure label="Sent home" value={num(roles.health.sent_home)} />
            <Figure label="Follow-ups due" value={num(roles.health.follow_ups_due)} />
          </Figures>
          <Bars title="Reasons (30 days)" rows={roles.health.by_reason} />
        </Card>}
        {roles.gate && <Card title="Gate" href="/school/gate">
          <Figures>
            <Figure label="Signed in today" value={num(roles.gate.in_today)} />
            <Figure label="Late today" value={num(roles.gate.late_today)} />
            <Figure label="Late (30 days)" value={num(roles.gate.late_30)} />
            <Figure label="Staff late (30 days)" value={num(roles.gate.staff_late_30)} />
          </Figures>
        </Card>}
        {roles.admissions && <Card title="Admissions" href="/school/admissions">
          <Figures>
            <Figure label="Open enquiries" value={num(roles.admissions.open)} />
            <Figure label="No follow-up booked" value={num(roles.admissions.no_follow_up)} />
            <Figure label="Follow-ups overdue" value={num(roles.admissions.follow_ups_overdue)} />
            <Figure label="Applications (30 days)" value={num(roles.admissions.applications_30)} />
          </Figures>
          <Bars title="Enquiries by stage" rows={roles.admissions.by_stage} />
        </Card>}
        {roles.hr && <Card title="Staff and leave" href="/school/hr">
          <Figures>
            <Figure label="Staff" value={num(roles.hr.staff)} />
            <Figure label="On leave today" value={num(roles.hr.on_leave_today)} />
            <Figure label="Leave to decide" value={num(roles.hr.leave_pending)} />
          </Figures>
          <Bars title="Staff by department" rows={roles.hr.by_department} />
        </Card>}
        {roles.welfare && <Card title="Wellbeing" href="/school/pastoral">
          <Figures>
            <Figure label="Check-ins (30 days)" value={num(roles.welfare.checkins_30)} />
            <Figure label="Average mood" value={roles.welfare.average_mood ?? "—"} hint="1 low · 5 high" />
            <Figure label="Asked to talk" value={num(roles.welfare.want_to_talk)} />
            <Figure label="New referrals" value={num(roles.welfare.referrals_open)} />
          </Figures>
        </Card>}
        {roles.exams_office && <Card title="Exams office" href="/school/exams-office">
          <Figures>
            <Figure label="Exams published" value={num(roles.exams_office.published)} />
            <Figure label="Sat (30 days)" value={num(roles.exams_office.sat_30)} />
            <Figure label="Requests waiting" value={num(roles.exams_office.requests_pending)} />
            <Figure label="Closed, not released" value={num(roles.exams_office.not_released)} />
          </Figures>
        </Card>}
        {roles.boarding && <Card title="Boarding" href="/school/hostel">
          <Figures>
            <Figure label="Boarders" value={num(roles.boarding.boarders)} />
            <Figure label="Exeat to decide" value={num(roles.boarding.exeat_pending)} />
            <Figure label="Out now" value={num(roles.boarding.out_now)} />
            <Figure label="Late back" value={num(roles.boarding.overdue_back)} />
          </Figures>
        </Card>}
        {roles.transport && <Card title="Buses" href="/school/transport">
          <Figures>
            <Figure label="Routes" value={num(roles.transport.routes)} />
            <Figure label="Bus events (30 days)" value={num(roles.transport.trips_30)} />
          </Figures>
          <Bars title="What happened" rows={roles.transport.by_kind} />
        </Card>}
        {roles.quality && <Card title="Quality" href="/school/qa">
          <Figures>
            <Figure label="Observations (90 days)" value={num(roles.quality.observations_90)} />
            <Figure label="Average score" value={roles.quality.average === null ? "—" : `${roles.quality.average}%`} />
            <Figure label="Not acknowledged" value={num(roles.quality.not_acknowledged)} />
            <Figure label="Lesson notes to review" value={num(roles.quality.notes_to_review)} />
          </Figures>
        </Card>}
        {a.me && <Card title="Me" href="/school/hr?tab=me">
          <Figures>
            {a.me.leave && <Figure label="Leave used this year" value={`${a.me.leave.used}${a.me.leave.allowance !== null ? ` of ${a.me.leave.allowance}` : ""} days`} hint={a.me.leave.pending ? `${a.me.leave.pending} waiting` : undefined} />}
            {a.me.sign_ins_30 !== null && <Figure label="Days signed in (30 days)" value={num(a.me.sign_ins_30)} hint={a.me.late_30 ? `${a.me.late_30} late` : undefined} />}
            {a.me.observations && <Figure label="My lesson observations" value={num(a.me.observations.count)} hint={a.me.observations.average !== null ? `average ${a.me.observations.average}%` : undefined} />}
          </Figures>
        </Card>}
      </div>
    </Page>
  );
}
