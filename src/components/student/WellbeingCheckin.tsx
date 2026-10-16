"use client";
import { useState } from "react";
import { useApi, send } from "@/components/ui";

const FACES = ["", "😢", "🙁", "😐", "🙂", "😄"];
const LABELS = ["", "Very low", "Low", "Okay", "Good", "Great"];

/** A quick daily check-in for students: how they feel, and whether they would like to talk to someone. */
export default function WellbeingCheckin() {
  const { data, reload } = useApi<{ enabled: boolean; anonymous_allowed?: boolean; done_today?: boolean; feelings?: string[] }>("/api/student/wellbeing");
  const [mood, setMood] = useState(0);
  const [feelings, setFeelings] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [talk, setTalk] = useState(false);
  const [anon, setAnon] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!data?.enabled) return null;
  if (data.done_today || done) return (
    <section className="card mb-6 p-4 text-sm">
      <p className="font-semibold">Thanks for checking in today.</p>
      <p className="text-slate-600">{done ?? "Come back tomorrow."} If you ever feel unsafe, speak to any teacher straight away.</p>
    </section>
  );
  return (
    <section className="card mb-6 space-y-3 p-4">
      <h2 className="font-semibold">How are you today?</h2>
      <div className="flex gap-2" role="radiogroup" aria-label="How you feel">{[1, 2, 3, 4, 5].map(m => (
        <button key={m} type="button" role="radio" aria-checked={mood === m} aria-label={LABELS[m]} onClick={() => setMood(m)}
          className={"flex flex-1 flex-col items-center rounded-lg border p-2 text-2xl " + (mood === m ? "border-brand-500 bg-brand-50" : "border-slate-200")}>
          {FACES[m]}<span className="text-xs text-slate-600">{LABELS[m]}</span></button>))}</div>
      {mood > 0 && <>
        <div className="flex flex-wrap gap-1">{(data.feelings ?? []).map(f => (
          <button key={f} type="button" aria-pressed={feelings.includes(f)} onClick={() => setFeelings(feelings.includes(f) ? feelings.filter(x => x !== f) : feelings.length < 6 ? [...feelings, f] : feelings)}
            className={"rounded-full border px-2 py-0.5 text-sm " + (feelings.includes(f) ? "border-brand-500 bg-brand-50" : "border-slate-200")}>{f}</button>))}</div>
        {!anon && <textarea className="input" rows={2} maxLength={500} placeholder="Anything you want to tell us? (optional)" value={note} onChange={e => setNote(e.target.value)} />}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={talk} onChange={e => { setTalk(e.target.checked); if (e.target.checked) setAnon(false); }} />I’d like to talk to someone</label>
        {data.anonymous_allowed && !talk && <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={anon} onChange={e => setAnon(e.target.checked)} />Don’t send my name (it just counts towards how the class feels)</label>}
        {err && <p className="text-sm text-rose-700">{err}</p>}
        <button className="btn btn-primary w-full" onClick={async () => {
          const r = await send<{ someone_will_check: boolean }>("/api/student/wellbeing", { mood, feelings, note: anon ? null : note || null, wants_to_talk: talk, anonymous: anon });
          if (!r.ok) return setErr(r.error);
          setDone(r.data.someone_will_check ? "Someone from school will check in with you soon." : "See you tomorrow."); reload();
        }}>Send</button>
      </>}
    </section>
  );
}
