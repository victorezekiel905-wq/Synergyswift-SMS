"use client";
import { Stat, Alert, money, fmtDate } from "@/components/ui";
import { Card, Figure, Figures, Bars, Columns, Notes, Table, num, per, MONTH, tone } from "@/components/analysis/Charts";
import type { StudentAnalysis } from "@/lib/analysis-student-server";

/**
 * One student's analysis, module by module: what parents see for each child and what the
 * student sees of themselves. Parts for modules the school doesn't use are left out.
 */
export default function StudentAnalysisView({ a, currency, forParent }: { a: StudentAnalysis; currency: string; forParent: boolean }) {
  const who = forParent ? a.student.first_name : "You";
  const whose = forParent ? `${a.student.first_name}'s` : "Your";
  const period = a.term ? `${a.term.name} (since ${fmtDate(a.from)})` : `the last 90 days (since ${fmtDate(a.from)})`;
  const r = a.results, hw = a.homework, att = a.attendance, beh = a.behaviour;
  const latestAvg = r?.trend.length ? r.trend[r.trend.length - 1]!.average : null;
  const latestPos = r?.trend.length ? r.trend[r.trend.length - 1]! : null;
  return (
    <div>
      {a.unavailable.length > 0 && <div className="mb-4"><Alert tone="amber">Some parts could not be loaded right now ({a.unavailable.join(", ")}). Try again in a moment.</Alert></div>}
      <p className="mb-4 text-sm text-slate-600">{a.student.name}{a.student.class_name ? ` · ${a.student.class_name}` : ""} · figures for {period}.</p>

      <Notes title={forParent ? `About ${a.student.first_name}` : "How you are doing"} notes={a.notes} />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Attendance" value={per(att?.rate)} tone={tone(att?.rate, 95, 90)} hint={att ? `${att.absent} absent · ${att.late} late` : "Not recorded"} />
        <Stat label="Latest average" value={latestAvg === null ? "—" : `${latestAvg}%`} tone={tone(latestAvg, 60, 45)}
          hint={latestPos?.position && latestPos.class_size ? `Position ${latestPos.position} of ${latestPos.class_size}` : r?.term ?? "No published report card yet"} />
        <Stat label="Homework handed in" value={per(hw?.completion)} tone={tone(hw?.completion, 90, 70)} hint={hw ? `${hw.handed_in} of ${hw.set} set · ${hw.missing} missing` : "Not used"} />
        <Stat label="Behaviour" value={beh ? `${beh.positive} good · ${beh.negative} concern${beh.negative === 1 ? "" : "s"}` : "—"} hint={beh?.class_points ? `${beh.class_points} classroom points` : undefined} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {r && (
          <Card title="Results" href={forParent ? `/parent/transcript?student=${a.student.id}` : "/student/transcript"}>
            {r.trend.length ? <Columns title="Average, term by term" max={100} rows={r.trend.map(t => ({ label: t.term, value: t.average, text: `${t.average}%` }))} />
              : <p className="text-sm text-slate-500">No published report card yet.</p>}
            {r.subjects.length > 0 && (
              <>
                <Table head={["Subject", "Score", "Class avg.", "Change"]} rows={r.subjects.map(s => [
                  <span key="s">{s.subject}{s.grade ? <span className="ml-1 text-xs text-slate-500">({s.grade})</span> : null}</span>,
                  s.score, s.class_average ?? "—",
                  s.change === null ? "—" : <span key="c" className={s.change > 0 ? "text-emerald-700" : s.change < 0 ? "text-rose-700" : ""}>{s.change > 0 ? "+" : ""}{s.change}</span>])} />
                <p className="text-xs text-slate-500">{r.term}: above the class average in {r.above_class_average} of {r.subjects.length} subjects.</p>
              </>
            )}
          </Card>
        )}

        {att && (
          <Card title="Attendance">
            <Figures>
              <Figure label="Days marked" value={num(att.days)} />
              <Figure label="Absent" value={num(att.absent)} />
              <Figure label="Late" value={num(att.late)} />
              <Figure label="Excused" value={num(att.excused)} />
            </Figures>
            <Columns title="Present, month by month" max={100} rows={att.by_month.map(m => ({ label: MONTH(m.month), value: m.rate, text: `${m.rate}%` }))} empty="No register marks yet this term." />
            {att.absent_weekdays.length > 0 && <Bars title="Absences by day of the week" rows={att.absent_weekdays} />}
            {a.arrivals && <p className="text-sm text-slate-600">At the gate: arrived on {a.arrivals.days} day{a.arrivals.days === 1 ? "" : "s"}, late on {a.arrivals.late}.</p>}
          </Card>
        )}

        {hw && (
          <Card title="Homework">
            <Figures>
              <Figure label="Set" value={num(hw.set)} />
              <Figure label="Handed in on time" value={num(hw.on_time)} />
              <Figure label="Late" value={num(hw.late)} />
              <Figure label="Missing" value={num(hw.missing)} />
            </Figures>
            {hw.average_mark !== null && <p className="text-sm text-slate-600">Average mark on marked homework: <b className="text-slate-900">{hw.average_mark}%</b>.</p>}
            <Bars title="Handed in, by subject" suffix="%" max={100} rows={hw.by_subject.map(s => ({ key: `${s.key} (${s.done}/${s.set})`, count: s.count }))} />
          </Card>
        )}

        {a.tests && (a.tests.exams.count > 0 || a.tests.practice.count > 0) && (
          <Card title="Tests and practice" href={forParent ? undefined : "/student/practice"}>
            <Figures>
              <Figure label="Online exams" value={num(a.tests.exams.count)} />
              <Figure label="Exam average" value={a.tests.exams.average === null ? "—" : `${a.tests.exams.average}%`} />
              <Figure label="Practice sessions" value={num(a.tests.practice.count)} />
              <Figure label="Practice average" value={a.tests.practice.average === null ? "—" : `${a.tests.practice.average}%`} />
            </Figures>
            <Table head={["Exam", "Score"]} rows={a.tests.exams.recent.map(e => [<span key="t">{e.title}<span className="block text-xs text-slate-500">{fmtDate(e.at)}</span></span>, `${e.percent}%`])} />
          </Card>
        )}

        {beh && (
          <Card title="Behaviour and classroom points">
            <Figures>
              <Figure label="Good-behaviour marks" value={num(beh.positive)} />
              <Figure label="Concerns" value={num(beh.negative)} />
              <Figure label="House points" value={num(beh.house_points)} />
              <Figure label="Classroom points" value={num(beh.class_points)} />
            </Figures>
            <Bars title="Praised most for" rows={beh.top_skills} />
            {beh.needs_work.length > 0 && <Bars title="To work on" rows={beh.needs_work} />}
          </Card>
        )}

        {a.learning && (
          <Card title="Online learning" href={forParent ? undefined : "/student/learn"}>
            <Figures>
              <Figure label="Learning steps done" value={num(a.learning.steps_done)} hint={a.learning.step_average !== null ? `average ${a.learning.step_average}%` : undefined} />
              <Figure label="Lessons completed" value={num(a.learning.lessons_completed)} hint={a.learning.minutes ? `${a.learning.minutes} min` : undefined} />
              <Figure label="Online lessons joined" value={num(a.learning.online_lessons_joined)} />
              <Figure label="Days active" value={num(a.learning.active_days)} hint={a.learning.learning_points ? `${a.learning.learning_points} points` : undefined} />
            </Figures>
          </Card>
        )}

        {a.activities && (a.activities.clubs.length > 0 || a.activities.achievements > 0 || a.activities.competitions > 0 || a.activities.badges > 0) && (
          <Card title="Clubs, achievements and awards" href={forParent ? "/parent/portfolio" : undefined}>
            <Figures>
              <Figure label="Clubs" value={num(a.activities.clubs.length)} />
              <Figure label="Competitions" value={num(a.activities.competitions)} hint={a.activities.placed ? `${a.activities.placed} top-3 finish${a.activities.placed === 1 ? "" : "es"}` : undefined} />
              <Figure label="Achievements" value={num(a.activities.achievements)} />
              <Figure label="Badges" value={num(a.activities.badges)} />
            </Figures>
            {a.activities.clubs.length > 0 && <p className="text-sm text-slate-600">{who === "You" ? "Your" : `${who}'s`} clubs: {a.activities.clubs.join(", ")}.</p>}
            <Table head={["Recent achievement", "Date"]} rows={a.activities.recent.map(x => [x.title, x.on ? fmtDate(x.on) : "—"])} />
          </Card>
        )}

        {(a.health || a.library) && (
          <Card title="Health and library">
            <Figures>
              {a.health && <Figure label="Sick bay visits" value={num(a.health.visits)} />}
              {a.library && <Figure label="Books borrowed" value={num(a.library.borrowed_this_term)} hint={`${a.library.read_all_time} read in all`} />}
              {a.library && <Figure label="Books out now" value={num(a.library.on_loan)} />}
              {a.library && <Figure label="Overdue" value={num(a.library.overdue)} />}
            </Figures>
            {a.health && a.health.by_reason.length > 0 && <Bars title="Reasons for sick bay visits" rows={a.health.by_reason} />}
          </Card>
        )}

        {(a.fees || a.shop) && (
          <Card title={forParent ? "Fees and tuck shop" : "Tuck shop"} href={forParent ? undefined : "/student#shop"}>
            {a.fees && (
              <Figures>
                <Figure label="Billed this term" value={money(a.fees.this_term?.billed ?? 0, currency)} />
                <Figure label="Paid" value={money(a.fees.this_term?.collected ?? 0, currency)} />
                <Figure label="Still owed (all terms)" value={money(a.fees.all_time.outstanding, currency)} />
                <Figure label="Past due" value={money(a.fees.all_time.overdue_amount, currency)} />
              </Figures>
            )}
            {a.shop && (
              <>
                <p className="text-sm text-slate-600">{whose} tuck shop: <b className="text-slate-900">{money(a.shop.spent, currency)}</b> in {a.shop.buys} buy{a.shop.buys === 1 ? "" : "s"}.{a.shop.balance !== null && <> Balance now <b className="text-slate-900">{money(a.shop.balance, currency)}</b>{a.shop.frozen ? " (frozen)" : ""}.</>}</p>
                <Bars title="Spent on" rows={a.shop.by_category.map(c => ({ key: c.key, count: c.count }))} />
              </>
            )}
          </Card>
        )}
      </div>
      <p className="mt-6 text-xs text-slate-500">Results come from published report cards; exam scores show once the school releases them. Parts for modules your school doesn&apos;t use are left out.</p>
    </div>
  );
}
