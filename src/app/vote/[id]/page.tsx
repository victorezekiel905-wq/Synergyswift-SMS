"use client";
import Link from "next/link";
import { use, useState } from "react";
import { useApi, send, Page, PageHeader, Loading, Alert, fmtDate } from "@/components/ui";
import Ballot, { ElectionResults, type Candidate, type Choices, type Post, type Results } from "@/components/elections/Ballot";

type Data = { election: { id: string; title: string; description: string | null; phase: string; voted: boolean; opens_at: string | null; closes_at: string | null; results: boolean };
  posts: Post[]; candidates: Candidate[]; results: Results | null };

/** One election: the ballot while voting is open, your receipt after voting, the results once published. */
export default function VotePage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);
  const { data, error, reload } = useApi<Data>(`/api/vote?id=${id}`, [id]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [check, setCheck] = useState("");
  const [checked, setChecked] = useState<string | null>(null);
  if (error) return <Page><Alert>{error}</Alert></Page>;
  if (!data) return <Page><Loading /></Page>;
  const e = data.election;

  async function cast(choices: Choices) {
    setBusy(true); setErr(null);
    const r = await send<{ receipt: string }>("/api/vote", { action: "cast", election_id: id, choices });
    setBusy(false);
    if (!r.ok) return setErr(r.error ?? "Your vote could not be cast. Please try again.");
    setReceipt(r.data.receipt);
    reload();
  }
  const shown = (s: string) => s.replace(/(.{4})(?=.)/g, "$1-");

  return (
    <Page>
      <Link href="/vote" className="text-sm text-slate-600">← All elections</Link>
      <PageHeader eyebrow="Vote" title={e.title}
        subtitle={e.phase === "voting" ? (e.closes_at ? `Voting closes ${fmtDate(e.closes_at, true)}.` : "Voting is open.") : e.phase === "scheduled" ? `Voting opens ${fmtDate(e.opens_at, true)}.` : e.phase === "published" ? "The results are out." : "Voting has closed."} />
      {e.description && <p className="mb-4 max-w-2xl whitespace-pre-wrap text-sm text-slate-700">{e.description}</p>}
      {err && <div className="mb-4"><Alert>{err}</Alert></div>}

      {receipt && (
        <section className="card mb-4 border-2 border-emerald-300 p-5" role="status">
          <h2 className="text-lg font-semibold">Your vote is in. Thank you.</h2>
          <p className="mt-1 text-sm text-slate-700">Your receipt: <b className="font-mono text-base tracking-wider">{shown(receipt)}</b>. Keep it if you want to check later that your ballot was counted. It does not show who you chose.</p>
        </section>
      )}

      {e.phase === "voting" && !e.voted && !receipt && <Ballot posts={data.posts} candidates={data.candidates} onCast={cast} busy={busy} />}
      {e.voted && !receipt && e.phase !== "published" && <Alert tone="green">You have voted. {e.phase === "voting" ? "The results come out after voting closes." : "The results will be published soon."}</Alert>}

      {data.results && <div className="mt-2"><h2 className="mb-3 text-lg font-semibold">Results</h2><ElectionResults r={data.results} /></div>}

      {(e.voted || receipt) && (
        <section className="card mt-5 max-w-lg p-4">
          <h2 className="font-semibold">Check your ballot was counted</h2>
          <form className="mt-2 flex gap-2" onSubmit={async ev => {
            ev.preventDefault();
            const r = await send<{ counted: boolean }>("/api/vote", { action: "check", election_id: id, receipt: check.replace(/-/g, "") });
            setChecked(r.ok ? (r.data.counted ? "Yes: that ballot is in the count." : "No ballot has that receipt. Check the code.") : r.error ?? "failed");
          }}>
            <input className="input font-mono uppercase" value={check} onChange={ev => setCheck(ev.target.value)} placeholder="XXXX-XXXX-XXXX" aria-label="Receipt code" />
            <button className="btn btn-ghost border border-slate-300">Check</button>
          </form>
          {checked && <p className="mt-2 text-sm" role="status">{checked}</p>}
        </section>
      )}
    </Page>
  );
}
