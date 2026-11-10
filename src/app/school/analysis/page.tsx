"use client";
import Link from "next/link";
import { useApi, Page, PageHeader, Stat, Alert, Loading, money, fmtDate, type Me } from "@/components/ui";
import { Card, Figure, Figures, Bars, Columns, Split, Table, num, per, MONTH, tone, type Count } from "@/components/analysis/Charts";
type Data = {
  school: string; generated_at: string; today: string; timezone: string;
  term: { id: string; name: string; starts_on: string | null; ends_on: string | null } | null;
  people: { students: number; new_30: number; gender: Count[]; by_class: Count[]; classes: number; staff: number; staff_on_leave: number; by_department: Count[]; parents: number; ratio: number | null } | null;
  attendance: { today: { date: string; marked: number; rate: number | null }; rate_30: number | null; daily: { date: string; marked: number; rate: number | null }[]; absent_today: number; late_today: number } | null;
  fees: { term: { billed: number; collected: number; outstanding: number; rate: number | null; overdue_invoices: number; overdue_amount: number };
    by_month: { month: string; amount: number }[]; collected_30: number; by_method: Count[]; expenses_30: number } | null;
  academics: { report_cards: { total: number; published: number; not_published: number; average: number | null; bands: Count[] } | null;
    exams_open: number | null; exam_attempts_30: number | null; homework_30: number | null; homework_submissions_30: number | null } | null;
  admissions: { open_leads: number; by_stage: Count[]; by_source: Count[]; no_follow_up: number; applications_30: number; enrolled_30: number } | null;
  welfare: { behaviour_30: number | null; sickbay_30: number | null; tickets_open: number | null } | null;
  library: { on_loan: number; overdue: number } | null;
  engagement: { notices_30: number; live_lessons_30: number | null; gate_signins_30: number | null } | null;
  activity: { actions: number; people: number; by_area: Count[]; by_role: Count[]; by_day: { date: string; count: number }[]; accounts: { role: string; accounts: number; active_30: number }[] } | null;
  shop: { sales_30: number; takings_30: number; buyers_30: number; refused_30: number; topups_30: number; emptied_30: number } | null;
  learning: { active_students_30: number; lessons_completed_30: number | null; online_joins_30: number | null } | null;
  boarding: { boarders: number | null; out_on_exeat: number | null; clubs: number | null; students_in_clubs: number } | null;
  unavailable: string[];
  highlights: { tone: "bad" | "warn" | "good"; text: string; href: string }[];
  share_female: number | null;
};


/** The whole school in one view, in the school's own colour (school admins and principals). */
export default function AnalysisPage() {
  const { data, error, reload } = useApi<Data>("/api/school/analysis");
  const { data: me } = useApi<Me>("/api/me");
  const cur = me?.prefs?.currency ?? "NGN";
  if (error) return <Page wide><PageHeader eyebrow="Analysis" title="Analysis dashboard" /><Alert>{error}</Alert></Page>;
  if (!data) return <Page wide><PageHeader eyebrow="Analysis" title="Analysis dashboard" /><Loading label="Bringing the school's figures together…" /></Page>;
  const { people, attendance, fees, academics, admissions, welfare, library, engagement, activity, shop, learning, boarding } = data;

  return (
    <Page wide>
      <PageHeader eyebrow="Analysis" title="Analysis dashboard"
        subtitle={`${data.school}${data.term ? ` · ${data.term.name}` : ""} · everything in the school, in one place. Updated ${new Date(data.generated_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}.`}
        actions={<button className="btn btn-outline text-xs" onClick={reload}>Refresh</button>} />

      {data.unavailable.length > 0 && <div className="mb-4"><Alert tone="amber">Some figures could not be loaded right now ({data.unavailable.join(", ")}). Press Refresh to try again.</Alert></div>}

      {/* What needs attention */}
      <section className="card mb-5 p-5">
        <h2 className="mb-3 font-semibold">Needs your attention</h2>
        <ul className="space-y-2">
          {data.highlights.map((h, i) => (
            <li key={i} className="flex items-start gap-3 text-sm">
              <span aria-hidden className={"mt-1.5 h-2 w-2 shrink-0 rounded-full " + (h.tone === "bad" ? "bg-rose-600" : h.tone === "warn" ? "bg-amber-500" : "bg-emerald-500")} />
              <span className="flex-1">{h.text}</span>
              {h.tone !== "good" && <Link href={h.href} className="text-xs font-medium text-brand-700 hover:underline">Open →</Link>}
            </li>
          ))}
        </ul>
      </section>

      {/* The headline figures */}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Students" value={num(people?.students)} hint={people ? `${people.new_30} joined in 30 days` : undefined} />
        <Stat label="Staff" value={num(people?.staff)} hint={people?.ratio ? `${people.ratio} students per active staff` : undefined} />
        <Stat label="Attendance today" value={per(attendance?.today.rate)} tone={tone(attendance?.today.rate, 90, 85)}
          hint={attendance ? (attendance.today.marked ? `${attendance.absent_today} absent, ${attendance.late_today} late` : "Registers not taken yet") : "Class register is switched off"} />
        <Stat label="Fees collected this term" value={per(fees?.term.rate)} tone={tone(fees?.term.rate, 80, 60)}
          hint={fees ? `${money(fees.term.collected, cur)} of ${money(fees.term.billed, cur)}` : "Fees are switched off"} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {people && (
          <Card title="Students and staff" href="/school/students">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <Figure label="Classes" value={num(people.classes)} />
              <Figure label="Parents and guardians" value={num(people.parents)} />
              <Figure label="Staff on leave" value={num(people.staff_on_leave)} />
            </div>
            <Bars title="Students by class" rows={people.by_class.slice(0, 12)} />
            <Split title="Boys and girls" rows={people.gender} />
          </Card>
        )}

        {attendance && (
          <Card title="Attendance, last 30 days" href="/school/attendance">
            <p className="text-sm text-slate-600">Average <b className="text-slate-900">{per(attendance.rate_30)}</b> present (late counts as present).</p>
            <Columns rows={attendance.daily.filter(d => d.marked > 0).map(d => ({ label: fmtDate(d.date), value: d.rate ?? 0, text: per(d.rate) }))} max={100} empty="No registers taken in the last 30 days." />
          </Card>
        )}

        {fees && (
          <Card title="Money" href="/school/fees">
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Figure label="Billed this term" value={money(fees.term.billed, cur)} />
              <Figure label="Collected" value={money(fees.term.collected, cur)} />
              <Figure label="Still owed" value={money(fees.term.outstanding, cur)} />
              <Figure label="Overdue" value={`${fees.term.overdue_invoices} · ${money(fees.term.overdue_amount, cur)}`} />
            </div>
            <Columns rows={fees.by_month.map(m => ({ label: MONTH(m.month), value: m.amount, text: money(m.amount, cur) }))} title="Fees received by month" />
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <Figure label="Received, last 30 days" value={money(fees.collected_30, cur)} />
              <Figure label="Spent, last 30 days" value={money(fees.expenses_30, cur)} />
            </div>
            {fees.by_method.length > 0 && <Split title="How parents paid (30 days)" rows={fees.by_method} />}
          </Card>
        )}

        {academics && (
          <Card title="Learning and results" href="/school/results/report-cards">
            {academics.report_cards ? (
              <>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <Figure label="Average this term" value={academics.report_cards.average === null ? "—" : `${academics.report_cards.average}%`} />
                  <Figure label="Report cards published" value={`${academics.report_cards.published} of ${academics.report_cards.total}`} />
                  <Figure label="Not yet published" value={num(academics.report_cards.not_published)} />
                </div>
                <Bars title="Students by average" rows={academics.report_cards.bands} />
              </>
            ) : <p className="text-sm text-slate-500">No report cards for this term yet.</p>}
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Figure label="Exams open" value={num(academics.exams_open)} />
              <Figure label="Exams sat (30 days)" value={num(academics.exam_attempts_30)} />
              <Figure label="Homework set (30 days)" value={num(academics.homework_30)} />
              <Figure label="Homework handed in (30 days)" value={num(academics.homework_submissions_30)} />
            </div>
          </Card>
        )}

        {admissions && (
          <Card title="Admissions" href="/school/admissions">
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Figure label="Open enquiries" value={num(admissions.open_leads)} />
              <Figure label="No follow-up booked" value={num(admissions.no_follow_up)} />
              <Figure label="Applications (30 days)" value={num(admissions.applications_30)} />
              <Figure label="Enrolled (30 days)" value={num(admissions.enrolled_30)} />
            </div>
            <Bars title="Enquiries by stage" rows={admissions.by_stage.map(s => ({ ...s, key: s.key.replace(/_/g, " ") }))} />
            <Bars title="Where enquiries come from" rows={admissions.by_source.slice(0, 8).map(s => ({ ...s, key: s.key.replace(/_/g, " ") }))} />
          </Card>
        )}

        <Card title="Welfare, library and communication">
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <Figure label="Behaviour incidents (30 days)" value={num(welfare?.behaviour_30)} href="/school/behaviour" />
            <Figure label="Sick bay visits (30 days)" value={num(welfare?.sickbay_30)} href="/school/health" />
            <Figure label="Parent requests open" value={num(welfare?.tickets_open)} href="/school/community" />
            <Figure label="Library books out" value={num(library?.on_loan)} href="/school/library" />
            <Figure label="Library books overdue" value={num(library?.overdue)} href="/school/library" />
            <Figure label="Notices sent (30 days)" value={num(engagement?.notices_30)} href="/school/notices" />
            <Figure label="Live lessons (30 days)" value={num(engagement?.live_lessons_30)} />
            <Figure label="Gate sign-ins (30 days)" value={num(engagement?.gate_signins_30)} href="/school/gate" />
          </div>
        </Card>

        {(shop || learning || boarding) && (
          <Card title="Tuck shop, online learning, boarding and clubs">
            {shop && <Figures>
              <Figure label="Tuck shop sales (30 days)" value={num(shop.sales_30)} hint={money(shop.takings_30, cur)} href="/school/shop" />
              <Figure label="Students who bought" value={num(shop.buyers_30)} />
              <Figure label="Wallets topped up" value={money(shop.topups_30, cur)} />
              <Figure label="Refused · emptied" value={`${shop.refused_30} · ${shop.emptied_30}`} />
            </Figures>}
            {learning && <Figures>
              <Figure label="Students learning online (30 days)" value={num(learning.active_students_30)} href="/school/learning" />
              <Figure label="Online lessons completed" value={num(learning.lessons_completed_30)} />
              <Figure label="Online lesson joins" value={num(learning.online_joins_30)} />
            </Figures>}
            {boarding && <Figures>
              <Figure label="Boarders" value={num(boarding.boarders)} href="/school/hostel" />
              <Figure label="Out on exeat now" value={num(boarding.out_on_exeat)} />
              <Figure label="Clubs" value={num(boarding.clubs)} href="/school/activities" />
              <Figure label="Students in clubs" value={num(boarding.students_in_clubs)} />
            </Figures>}
          </Card>
        )}
      </div>

      {activity && (
        <section className="mt-5 grid gap-5 lg:grid-cols-2">
          <Card title="Activity across the school, last 30 days" href="/school/audit">
            <Figures>
              <Figure label="Things done" value={num(activity.actions)} />
              <Figure label="People active" value={num(activity.people)} />
            </Figures>
            <Columns title="Activity per day" rows={activity.by_day.map(d => ({ label: fmtDate(d.date), value: d.count, text: `${d.count} actions` }))} empty="Nothing recorded in the last 30 days." />
            <Bars title="By area" rows={activity.by_area} />
          </Card>
          <Card title="Who is using the system" href="/school/roles">
            <Bars title="Actions by role" rows={activity.by_role} />
            <Table head={["Role", "Accounts", "Active in 30 days", "Share active"]} rows={activity.accounts.map(r => [<span key="r" className="capitalize">{r.role}</span>, r.accounts, r.active_30, r.accounts ? `${Math.round((r.active_30 / r.accounts) * 100)}%` : "—"])} />
            <p className="text-xs text-slate-500">&quot;Active&quot; means the person changed something (marks, registers, payments, messages and so on). Reading only is not counted.</p>
          </Card>
        </section>
      )}
      <p className="mt-6 text-xs text-slate-500">Figures are for {data.school} only, counted in the school&apos;s time zone ({data.timezone}). Parts for switched-off modules are left out. Colours follow your school colour (School setup).</p>
    </Page>
  );
}
