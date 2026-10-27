"use client";
import Link from "next/link";
import { useApi, Page, PageHeader, Empty, Loading, Alert, Badge, fmtDate } from "@/components/ui";

type Mine = { id: string; title: string; kind: string; description: string | null; opens_at: string | null; closes_at: string | null; phase: string; voted: boolean; results: boolean };

/** Elections you can vote in, and results once they are out (students, parents and staff). */
export default function VoteList() {
  const { data, error } = useApi<{ elections: Mine[] }>("/api/vote");
  return (
    <Page>
      <PageHeader eyebrow="School" title="Vote" subtitle="Elections you can vote in. Your vote is secret: the school can see that you voted, never who you chose." />
      {error ? <Alert>{error}</Alert> : !data ? <Loading /> : !data.elections.length ? <Empty>There is nothing to vote on right now.</Empty> : (
        <ul className="grid gap-3 sm:grid-cols-2">{data.elections.map(e => (
          <li key={e.id} className="card flex flex-col p-4">
            <p className="font-semibold">{e.title}</p>
            {e.description && <p className="mt-1 line-clamp-2 text-sm text-slate-600">{e.description}</p>}
            <p className="mt-2 text-xs text-slate-500">
              {e.phase === "voting" ? (e.closes_at ? `Voting closes ${fmtDate(e.closes_at, true)}` : "Voting is open")
                : e.phase === "scheduled" ? `Voting opens ${fmtDate(e.opens_at, true)}` : e.phase === "published" ? "Results are out" : "Voting has closed"}
            </p>
            <div className="mt-3 flex items-center gap-2">
              {e.voted && <Badge tone="green">You voted</Badge>}
              <Link href={`/vote/${e.id}`} className="btn btn-primary ml-auto no-underline">
                {e.phase === "voting" && !e.voted ? "Vote now" : e.results ? "See results" : "Open"}</Link>
            </div>
          </li>))}</ul>
      )}
    </Page>
  );
}
