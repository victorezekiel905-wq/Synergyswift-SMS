"use client";
import { useState } from "react";
import { useApi, send, Alert, Loading, Empty, Badge, fmtDate } from "@/components/ui";

type Target = { id: string; area: string | null; target: string; strategies: string | null; success_criteria: string | null; progress: string; position: number };
type Data = {
  who: "parent" | "student"; student: string;
  profile: { summary: string | null; strengths: string | null; strategies: string | null; extra_time_pct: number; arrangements: string[]; coordinator: string | null } | null;
  plan: { id: string; title: string; starts_on: string; review_on: string | null; student_voice: string | null; parent_views: string | null; parent_agreed_at: string | null; parent_agreed_name: string | null; iep_targets: Target[] } | null;
  feedback: { target_id: string; author_kind: string; author_name: string; rating: number; comment: string | null; created_at: string }[];
  notes: { id: string; author_kind: string; author_name: string; kind: string; body: string; mood: number | null; created_at: string }[];
};

const PROGRESS: Record<string, { label: string; kid: string; tone: "slate" | "amber" | "blue" | "green" }> = {
  not_started: { label: "Not started", kid: "Just starting", tone: "slate" }, emerging: { label: "Emerging", kid: "Starting to get it", tone: "amber" },
  developing: { label: "Developing", kid: "Getting better", tone: "blue" }, secure: { label: "Secure", kid: "I can do this", tone: "green" }, achieved: { label: "Achieved", kid: "Done it!", tone: "green" }
};
const RATING = ["", "Hard", "Getting there", "OK", "Good", "Great"];
const MOOD = ["", "A hard day", "Not great", "OK", "Good", "A great day"];

/** The support plan for a parent or the child themself (phase 14h). */
export default function FamilyPlan({ studentId }: { studentId: string }) {
  const { data, error, reload } = useApi<Data>(`/api/sen/family?student=${studentId}`, [studentId]);
  const [note, setNote] = useState({ body: "", mood: 0 });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [agree, setAgree] = useState({ name: "", views: "" });
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const kid = data.who === "student";
  const act = async (body: Record<string, unknown>, text: string) => {
    const r = await send("/api/sen/family", { ...body, student_id: studentId });
    setMsg({ ok: r.ok, text: r.ok ? text : r.error ?? "failed" });
    if (r.ok) reload();
    return r.ok;
  };
  const p = data.plan;
  return (
    <div className="space-y-5">
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      {data.profile && (
        <section className="card space-y-2 p-4">
          <h2 className="font-semibold">{kid ? "What helps me" : `How the school supports ${data.student.split(" ")[0]}`}</h2>
          {data.profile.strengths && <p><b>{kid ? "I'm good at" : "Strengths"}:</b> {data.profile.strengths}</p>}
          {data.profile.strategies && <p className="whitespace-pre-wrap"><b>{kid ? "Things that help me in class" : "What helps in class"}:</b> {data.profile.strategies}</p>}
          {!kid && data.profile.summary && <p className="whitespace-pre-wrap text-slate-700">{data.profile.summary}</p>}
          {(data.profile.extra_time_pct > 0 || data.profile.arrangements.length > 0) && <p className="text-sm text-slate-600">In tests: {[data.profile.extra_time_pct ? `${data.profile.extra_time_pct}% extra time` : null, ...data.profile.arrangements.map(a => a.replace(/_/g, " "))].filter(Boolean).join(", ")}</p>}
          {data.profile.coordinator && <p className="text-xs text-slate-500">Coordinated by {data.profile.coordinator}</p>}
        </section>
      )}

      {!p ? <Empty>{kid ? "You don't have a support plan at the moment." : "There is no active support plan at the moment."}</Empty> : (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-2"><h2 className="mr-auto text-lg font-semibold">{kid ? "My targets" : p.title}</h2>
            <span className="text-sm text-slate-600">since {fmtDate(p.starts_on)}{p.review_on ? ` · next review ${fmtDate(p.review_on)}` : ""}</span></div>
          {p.iep_targets.map(t => {
            const mine = data.feedback.filter(f => f.target_id === t.id);
            const pr = PROGRESS[t.progress] ?? PROGRESS.not_started!;
            return (
              <div key={t.id} className="card p-4">
                <div className="flex flex-wrap items-start gap-2"><p className="mr-auto font-medium">{t.target}</p><Badge tone={pr.tone}>{kid ? pr.kid : pr.label}</Badge></div>
                {t.strategies && <p className="mt-1 text-sm text-slate-600"><b>{kid ? "How we'll do it" : "How we work on it"}:</b> {t.strategies}</p>}
                {!kid && t.success_criteria && <p className="text-sm text-slate-600"><b>We&apos;ll know it&apos;s working when:</b> {t.success_criteria}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label={kid ? "How is it going?" : "How is it going at home?"}>
                  <span className="mr-1 text-sm text-slate-600">{kid ? "How is it going?" : "How is it going at home?"}</span>
                  {[1, 2, 3, 4, 5].map(r => <button key={r} className="rounded-full border border-slate-300 px-2.5 py-1 text-xs hover:border-brand-600"
                    onClick={() => act({ action: "feedback", target_id: t.id, rating: r, comment: null }, "Thank you. The school can see this.")}>{RATING[r]}</button>)}
                </div>
                {mine.length > 0 && <ul className="mt-2 space-y-1 text-xs text-slate-500">{mine.slice(0, 4).map((f, i) => <li key={i}>{f.author_name} ({f.author_kind}): <b>{RATING[f.rating]}</b>{f.comment ? `, ${f.comment}` : ""} · {fmtDate(f.created_at)}</li>)}</ul>}
              </div>
            );
          })}
          {!kid && (p.parent_agreed_at ? <p className="text-sm text-emerald-800">Agreed by {p.parent_agreed_name} on {fmtDate(p.parent_agreed_at)}.</p> : (
            <div className="card space-y-2 p-4">
              <h3 className="font-semibold">Agree the plan</h3>
              <textarea className="input" rows={3} placeholder="Your views (optional): what you see at home, what you'd like the school to know" value={agree.views} onChange={e => setAgree({ ...agree, views: e.target.value })} />
              <input className="input" placeholder="Your full name" value={agree.name} onChange={e => setAgree({ ...agree, name: e.target.value })} />
              <button className="btn btn-primary" disabled={agree.name.trim().length < 2} onClick={() => act({ action: "agree", iep_id: p.id, name: agree.name, views: agree.views || null }, "Thank you: the plan is agreed.")}>I agree with this plan</button>
            </div>
          ))}
        </section>
      )}

      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">{kid ? "Tell my teachers" : "Home–school book"}</h2>
        {kid && <p className="text-sm text-slate-600">Only school staff read what you write here.</p>}
        <textarea className="input" rows={3} value={note.body} onChange={e => setNote({ ...note, body: e.target.value })}
          placeholder={kid ? "Anything you want your teachers to know" : "How things are at home, what worked, what was hard"} />
        {!kid && <div className="flex flex-wrap items-center gap-1.5 text-sm"><span className="text-slate-600">How was the day?</span>
          {[1, 2, 3, 4, 5].map(m => <button key={m} onClick={() => setNote({ ...note, mood: note.mood === m ? 0 : m })}
            className={"rounded-full border px-2.5 py-1 text-xs " + (note.mood === m ? "border-brand-700 bg-brand-700 text-white" : "border-slate-300")}>{MOOD[m]}</button>)}</div>}
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" disabled={!note.body.trim()} onClick={async () => { if (await act({ action: "note", body: note.body, mood: note.mood || null }, "Sent to the school.")) setNote({ body: "", mood: 0 }); }}>Send</button>
          {!kid && <button className="btn btn-ghost border border-slate-300" disabled={!note.body.trim()} onClick={async () => { if (await act({ action: "note", body: note.body, meeting: true }, "Meeting requested. The school will be in touch.")) setNote({ body: "", mood: 0 }); }}>Ask for a review meeting</button>}
        </div>
        <ul className="space-y-2 text-sm">{data.notes.map(n => (
          <li key={n.id} className={"rounded-lg p-3 " + (n.author_kind === "staff" ? "bg-brand-50" : "bg-slate-50")}>
            <p className="text-xs text-slate-500">{n.author_name} · {fmtDate(n.created_at, true)}{n.kind === "meeting_request" ? " · asked for a meeting" : n.kind === "praise" ? " · good news" : ""}{n.mood ? ` · ${MOOD[n.mood]}` : ""}</p>
            <p className="whitespace-pre-wrap">{n.body}</p>
          </li>))}</ul>
      </section>
    </div>
  );
}
