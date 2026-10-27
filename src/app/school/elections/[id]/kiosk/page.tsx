"use client";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useApi, send, Alert, Loading } from "@/components/ui";
import Ballot, { type Candidate, type Choices, type Post } from "@/components/elections/Ballot";

type Data = { election: { id: string; title: string; status: string }; classes: { id: string; name: string }[];
  students?: { id: string; name: string; admission_no: string; voted: boolean }[]; posts?: Post[]; candidates?: Candidate[] };

/**
 * The teacher's voting tablet (phase 14f): pick the student whose turn it is, hand them the
 * tablet, they vote and hand it back. The teacher sees who has voted, never how.
 */
export default function Kiosk(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);
  const [cls, setCls] = useState("");
  useEffect(() => { setCls(new URLSearchParams(window.location.search).get("class") ?? ""); }, []);
  const { data, error, reload } = useApi<Data>(`/api/elections/kiosk?election=${id}${cls ? `&class=${cls}` : ""}`, [id, cls]);
  const [voter, setVoter] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [thanks, setThanks] = useState<{ name: string; receipt: string } | null>(null);

  async function cast(choices: Choices) {
    if (!voter) return;
    setBusy(true); setErr(null);
    const r = await send<{ receipt: string }>("/api/elections/kiosk", { election_id: id, student_id: voter.id, choices });
    setBusy(false);
    if (!r.ok) { setErr(r.error ?? "The vote could not be cast."); return; }
    setThanks({ name: voter.name, receipt: r.data.receipt });
    setVoter(null);
    reload();
  }

  if (error) return <main className="mx-auto max-w-2xl p-6"><Alert>{error}</Alert><Link href="/school/elections" className="mt-3 inline-block text-sm underline">Back to elections</Link></main>;
  if (!data) return <main className="p-10"><Loading /></main>;

  if (thanks) {
    return (
      <main className="grid min-h-screen place-items-center bg-emerald-50 p-6 text-center">
        <div className="max-w-md">
          <p className="text-4xl font-serif font-semibold">Thank you, {thanks.name.split(" ")[0]}!</p>
          <p className="mt-3 text-lg">Your vote is in, and it is secret.</p>
          <p className="mt-4 text-sm text-slate-700">Receipt (to check later that it was counted): <b className="font-mono tracking-wider">{thanks.receipt.replace(/(.{4})(?=.)/g, "$1-")}</b></p>
          <p className="mt-6 text-lg font-semibold">Please hand the tablet back to your teacher.</p>
          <button className="btn btn-primary mt-6 px-8 py-4 text-lg" onClick={() => setThanks(null)}>Teacher: next student</button>
        </div>
      </main>
    );
  }

  if (voter && data.posts && data.candidates) {
    return (
      <main className="min-h-screen bg-slate-100 p-4 sm:p-8">
        <div className="mx-auto max-w-4xl">
          <p className="text-sm font-semibold text-slate-500">{data.election.title}</p>
          <h1 className="mb-1 text-3xl font-serif font-semibold">Hello {voter.name.split(" ")[0]}. It&apos;s your turn to vote.</h1>
          <p className="mb-5 text-slate-600">Tap your choices, check them, then cast your vote. Nobody can see who you choose.</p>
          {err && <div className="mb-4"><Alert>{err}</Alert></div>}
          <Ballot big posts={data.posts} candidates={data.candidates} onCast={cast} busy={busy} />
          <button className="mt-6 text-sm text-slate-500 underline" onClick={() => { setVoter(null); setErr(null); }}>Not {voter.name.split(" ")[0]}? Go back</button>
        </div>
      </main>
    );
  }

  const left = (data.students ?? []).filter(s => !s.voted).length;
  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-8">
      <Link href="/school/elections" className="text-sm text-slate-600">← Elections</Link>
      <h1 className="mt-1 text-[26px] font-serif font-semibold">Voting tablet: {data.election.title}</h1>
      {data.election.status !== "open" && <div className="mt-3"><Alert tone="amber">Voting is not open for this election.</Alert></div>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select className="input w-auto" value={cls} onChange={ev => { setCls(ev.target.value); window.history.replaceState(null, "", `?class=${ev.target.value}`); }} aria-label="Class">
          <option value="">Choose your class…</option>{data.classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        {data.students && <span className="text-sm text-slate-600">{left} still to vote of {data.students.length}</span>}
      </div>
      {!data.classes.length && <p className="mt-4 text-sm text-slate-600">You don&apos;t teach any class in this election.</p>}
      {data.students && (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{data.students.map(s => (
          <li key={s.id}>
            <button disabled={s.voted || data.election.status !== "open"} onClick={() => { setVoter(s); setErr(null); }}
              className={"flex w-full items-center justify-between rounded-xl border p-4 text-left text-lg " + (s.voted ? "border-slate-200 bg-slate-50 text-slate-400" : "border-slate-300 bg-white hover:border-brand-600")}>
              <span>{s.name}<span className="block text-xs text-slate-500">{s.admission_no}</span></span>
              {s.voted ? <span className="text-sm font-semibold text-emerald-700">Voted</span> : <span className="text-sm font-semibold text-brand-700">Vote</span>}
            </button>
          </li>))}</ul>
      )}
      <p className="mt-6 text-xs text-slate-500">You can see who has voted, never how. Each student can vote once, here or online.</p>
    </main>
  );
}
