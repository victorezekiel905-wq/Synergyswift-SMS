"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useApi, send, Page, PageHeader, Alert, Loading, Empty, Badge } from "@/components/ui";
import { PortfolioView, Targets, ShareLinks, type Achievement, type Work, type Cert, type TargetRow, type Share } from "@/components/portfolio/Portfolio";

type Data = { children: { id: string; name: string }[]; child: { id: string; name: string; transcript_allowed: boolean } | null;
  achievements: Achievement[]; work: Work[]; certificates: Cert[]; targets: TargetRow[]; shares: Share[] };

export default function ParentPortfolioPage() {
  return <Suspense fallback={<Loading />}><ParentPortfolio /></Suspense>;
}

/** A parent's view of each child's portfolio, targets, transcript and share links (phase 14o). */
function ParentPortfolio() {
  const params = useSearchParams();
  const router = useRouter();
  const student = params.get("student");
  const [made, setMade] = useState<string | null>(null);
  const { data, error, reload } = useApi<Data>(`/api/parent/portfolio${student ? `?student=${student}` : ""}`, [student]);
  if (error) return <Page><Alert>{error}</Alert></Page>;
  if (!data) return <Page><Loading /></Page>;
  const c = data.child;
  return (
    <Page wide>
      <PageHeader eyebrow="My children" title="Portfolio & transcript" subtitle="Achievements (with photos), work the teachers approved, certificates, targets and the academic transcript." />
      {data.children.length > 1 && <div className="mb-4 flex flex-wrap gap-2">{data.children.map(k => (
        <button key={k.id} onClick={() => router.replace(`/parent/portfolio?student=${k.id}`)}
          className={"rounded-full border px-3 py-1.5 text-sm " + (k.id === c?.id ? "border-brand-700 bg-brand-700 text-white" : "border-slate-300 bg-white")}>{k.name}</button>))}</div>}
      {!c ? <Empty>No children are linked to your account.</Empty> : (<div className="space-y-6">
        <section className="card flex flex-wrap items-center gap-3 p-4">
          <div className="mr-auto"><h2 className="font-semibold">Transcript</h2>
            <p className="text-sm text-slate-600">{c.transcript_allowed ? "Released: you can download or print it." : "You can read it; downloading opens when the school releases it (contact the school office)."}</p></div>
          <Badge tone={c.transcript_allowed ? "green" : "amber"}>{c.transcript_allowed ? "released" : "view only"}</Badge>
          <Link className="btn btn-outline" href={`/parent/transcript?student=${c.id}`}>Open transcript</Link>
        </section>
        {made && <Alert tone="green">Link made: <span className="break-all font-mono text-xs">{made}</span></Alert>}
        <PortfolioView achievements={data.achievements} work={data.work} certificates={data.certificates}
          onShare={async id => { const r = await send<{ url: string }>("/api/parent/portfolio", { student_id: c.id, action: "share", achievement_id: id, days: 90 }); if (r.ok) { reload(); setMade(r.data.url); } }} />
        <Targets targets={data.targets} onAdd={async d => { const r = await send("/api/parent/portfolio", { student_id: c.id, action: "target", description: d }); if (r.ok) reload(); return r.ok; }} />
        <ShareLinks shares={data.shares} api="/api/parent/portfolio" extra={{ student_id: c.id }} onChange={reload} />
      </div>)}
    </Page>
  );
}
