"use client";
import { useEffect, useState } from "react";
import { useApi, send, Page, PageHeader, Alert, Loading, Field, Stat } from "@/components/ui";

type Data = {
  available: boolean; used: number; limit: number; by_task: { task: string; label: string; n: number }[];
  split: { staff: number; share: number; tutor: { on: boolean; pool: number; used: number } };
  people: { name: string; role: string; used: number; share: number | null }[];
  settings: { comments: { tone: string; length: string }; admissions: { autopilot?: boolean; auto_reply?: boolean; auto_chase?: boolean; weekly_report?: boolean } };
  admissions_report: { headline: string; highlights: string[]; bottlenecks: string[]; actions: string[]; at: string } | null;
};

/** The school's AI assistant: how much it has been used, how it writes, and what the admissions assistant may do by itself (phase 14p). */
export default function SchoolAi() {
  const { data, error, reload } = useApi<Data>("/api/school/ai");
  const [c, setC] = useState({ tone: "warm", length: "short" });
  const [a, setA] = useState({ autopilot: false, auto_reply: false, auto_chase: false, weekly_report: true });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (!data) return;
    setC({ tone: data.settings.comments.tone ?? "warm", length: data.settings.comments.length ?? "short" });
    setA({ autopilot: Boolean(data.settings.admissions.autopilot), auto_reply: Boolean(data.settings.admissions.auto_reply),
      auto_chase: Boolean(data.settings.admissions.auto_chase), weekly_report: data.settings.admissions.weekly_report !== false });
  }, [data]);
  if (error) return <Page><Alert>{error}</Alert></Page>;
  if (!data) return <Page><Loading /></Page>;
  const pct = data.limit ? Math.min(100, Math.round((data.used / data.limit) * 100)) : 0;
  async function save(body: Record<string, unknown>, ok: string) {
    const r = await send("/api/school/ai", body);
    setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" });
    if (r.ok) reload();
  }
  const toggle = (k: keyof typeof a, label: string, hint: string, disabled = false) => (
    <label className={"flex items-start gap-3 rounded-lg border border-slate-200 p-3 " + (disabled ? "opacity-50" : "")}>
      <input type="checkbox" className="mt-1" disabled={disabled} checked={a[k]} onChange={e => setA({ ...a, [k]: e.target.checked })} />
      <span><span className="block font-medium">{label}</span><span className="block text-sm text-slate-600">{hint}</span></span>
    </label>
  );
  return (
    <Page>
      <PageHeader eyebrow="School settings" title="AI assistant" subtitle="Report comments, lesson notes, slides, quiz questions, translation for parents and the admissions assistant. Staff always see a draft before anything goes out, unless you switch on the admissions autopilot below." />
      {!data.available && <div className="mb-4"><Alert tone="amber">AI is not switched on for this site yet. Your Synergy Swift administrator adds the Gemini key.</Alert></div>}
      {msg && <div className="mb-4"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}

      <section className="card mb-4 p-4">
        <h2 className="font-semibold">This month</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Requests used" value={data.used.toLocaleString()} />
          <Stat label="Monthly allowance" value={data.limit.toLocaleString()} hint="renews on the 1st" />
          <Stat label="Left" value={Math.max(0, data.limit - data.used).toLocaleString()} tone={pct >= 90 ? "bad" : pct >= 75 ? "warn" : undefined} />
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Allowance used">
          <div className={"h-full " + (pct >= 90 ? "bg-rose-500" : pct >= 75 ? "bg-amber-500" : "bg-brand-600")} style={{ width: `${pct}%` }} />
        </div>
        {data.by_task.length > 0 && <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2">{data.by_task.map(t => <li key={t.task} className="flex justify-between border-b border-slate-100 py-1"><span>{t.label}</span><span className="tabular-nums text-slate-600">{t.n}</span></li>)}</ul>}
      </section>

      <section className="card mb-4 p-4">
        <h2 className="font-semibold">Each person&apos;s share</h2>
        <p className="text-sm text-slate-600">AI tools are for teachers and staff: lesson notes, report comments, slides, quiz questions, notices and the admissions assistant. Students use only the study helper (switched on under Learning), and parents nothing. While the study helper is on, 30% of the allowance is kept for it; the rest is shared evenly across your staff so one person can&apos;t use it all up. School admins and the principal aren&apos;t held to a share (they draft for the whole school), but everything still comes out of the school&apos;s total.</p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Stat label="Staff" value={data.split.staff.toLocaleString()} />
          <Stat label="Each staff member" value={`${data.split.share.toLocaleString()} a month`} />
        </div>
        <p className="mt-2 text-sm text-slate-600">{data.split.tutor.on
          ? `Study helper for students: ${data.split.tutor.used.toLocaleString()} of ${data.split.tutor.pool.toLocaleString()} questions used this month (each student also has the daily limit set under Learning).`
          : "The study helper for students is switched off, so the whole allowance goes to staff."}</p>
        {data.people.length > 0 && (
          <table className="mt-3 w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th className="py-1">Most use this month</th><th className="py-1 text-right">Used</th><th className="py-1 text-right">Share</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{data.people.map((p, i) => (
              <tr key={i}><td className="py-1">{p.name} <span className="text-xs text-slate-500">{p.role.replace(/_/g, " ")}</span></td>
                <td className={"py-1 text-right tabular-nums " + (p.share !== null && p.used >= p.share ? "font-semibold text-rose-700" : "")}>{p.used}</td>
                <td className="py-1 text-right tabular-nums text-slate-600">{p.share ?? "no limit"}</td></tr>))}</tbody></table>
        )}
      </section>

      <section className="card mb-4 p-4">
        <h2 className="font-semibold">Report card comments</h2>
        <p className="text-sm text-slate-600">The starting style for drafted comments. Teachers can change it for a class before drafting.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Tone"><select className="input" value={c.tone} onChange={e => setC({ ...c, tone: e.target.value })}>
            <option value="warm">Warm: like a teacher who knows the child well</option><option value="formal">Formal: a traditional school report</option>
            <option value="encouraging">Encouraging: celebrates effort and growth</option><option value="firm">Firm: honest about what must change</option></select></Field>
          <Field label="Length"><select className="input" value={c.length} onChange={e => setC({ ...c, length: e.target.value })}>
            <option value="short">Short: one or two sentences</option><option value="medium">Longer: two or three sentences</option></select></Field>
        </div>
        <div className="mt-3 flex justify-end"><button className="btn btn-primary" onClick={() => save({ comments: c }, "Comment style saved.")}>Save</button></div>
      </section>

      <section className="card mb-4 p-4">
        <h2 className="font-semibold">Admissions assistant</h2>
        <p className="text-sm text-slate-600">Every few minutes it looks at enquiries nobody has answered and applications that have gone quiet, writes a reply in the school&apos;s voice, and tells the officer what the family still has to do.</p>
        <div className="mt-3 space-y-2">
          {toggle("autopilot", "Work through enquiries and applications by itself", "Drafts replies and puts them on the family's timeline for the officer to check and send.")}
          {toggle("auto_reply", "Answer new enquiries straight away", "Sends the drafted reply to a family whose enquiry has waited 15 minutes with no answer. Families hear back in minutes, even at night.", !a.autopilot)}
          {toggle("auto_chase", "Chase applications that have gone quiet", "Sends a friendly reminder when an application has had no contact for 3 days (form fee, documents, test, offer).", !a.autopilot)}
          {toggle("weekly_report", "Weekly admissions report", "Monday mornings: enquiries, how fast families were answered, where they are stuck, and actions for the week, by email to admissions staff and the head.", !a.autopilot)}
        </div>
        <div className="mt-3 flex justify-end"><button className="btn btn-primary" onClick={() => save({ admissions: a }, "Admissions assistant saved.")}>Save</button></div>
      </section>

      {data.admissions_report && (
        <section className="card p-4">
          <h2 className="font-semibold">Last admissions report</h2>
          <p className="mt-1 font-medium">{data.admissions_report.headline}</p>
          <ul className="ml-5 mt-2 list-disc text-sm">{data.admissions_report.highlights.map((x, i) => <li key={i}>{x}</li>)}</ul>
          {data.admissions_report.bottlenecks.length > 0 && <><p className="mt-2 text-sm font-medium">Where families are stuck</p><ul className="ml-5 list-disc text-sm">{data.admissions_report.bottlenecks.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
          <p className="mt-2 text-sm font-medium">This week</p><ul className="ml-5 list-disc text-sm">{data.admissions_report.actions.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </section>
      )}
    </Page>
  );
}
