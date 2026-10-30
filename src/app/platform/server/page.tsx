"use client";
import { useState } from "react";
import { useApi, Page, PageHeader, Alert, Loading } from "@/components/ui";
import PlatformNav from "@/components/platform/PlatformNav";

type Key = { ok: boolean; kind: string; problem: string | null; detail: string | null };
type Office = { installed: boolean; bin?: string; version?: string | null; advice?: string;
  server: { cpus: number; memory_mb: number; free_mb: number };
  conversion?: { ok: boolean; seconds: number; reason: string; output?: string } };

/** Is the server set up right: the Supabase service key, and PowerPoint imports keeping their design. */
export default function ServerCheck() {
  const { data, error } = useApi<{ key: Key; office: null }>("/api/platform/server-check");
  const [office, setOffice] = useState<Office | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run() {
    setRunning(true); setErr(null);
    const r = await fetch("/api/platform/server-check?run=1", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    setRunning(false);
    if (!r.ok) return setErr(j.error ?? "The check didn't finish. Try again.");
    setOffice(j.office);
  }
  const slow = office?.conversion?.ok && office.conversion.seconds > 20;
  return (
    <Page wide>
      <PlatformNav />
      <PageHeader eyebrow="Synergy Swift platform" title="Server check" subtitle="Whether the server's Supabase key works, and whether PowerPoint slide imports keep their design."
        actions={<button className="btn btn-primary" disabled={running} onClick={run}>{running ? "Checking (up to a minute)…" : office ? "Check PowerPoint import again" : "Check PowerPoint import"}</button>} />
      {error && <Alert>{error}</Alert>}
      {!data && !error && <Loading />}
      {data && (
        <section className="card mb-4 p-5 text-sm">
          <h2 className="mb-1 font-semibold">Supabase service key</h2>
          <p>{data.key.ok ? "Works. Sign-ups, onboarding codes, emails, reminders and payments can use it." : "Not working."}</p>
          <p className="mt-1 text-xs text-slate-500">Type: {data.key.kind}. The key itself is never shown.</p>
          {data.key.problem && <div className="mt-3"><Alert>{data.key.problem}</Alert></div>}
          {data.key.detail && <p className="mt-2 text-xs text-amber-800">{data.key.detail}</p>}
        </section>
      )}
      {err && <Alert>{err}</Alert>}
      {office && (
        <section className="card space-y-3 p-5 text-sm">
          <h2 className="font-semibold">PowerPoint import</h2>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[12rem_1fr]">
            <dt className="text-slate-500">LibreOffice</dt><dd>{office.installed ? (office.version || office.bin) : "Not installed"}</dd>
            <dt className="text-slate-500">Server</dt><dd>{office.server.cpus} CPU · {office.server.memory_mb} MB memory ({office.server.free_mb} MB free)</dd>
            {office.conversion && <><dt className="text-slate-500">Test conversion</dt>
              <dd>{office.conversion.ok ? `Worked in ${office.conversion.seconds} s` : `Failed after ${office.conversion.seconds} s: ${office.conversion.reason}`}</dd></>}
          </dl>
          {office.conversion?.output && <pre className="max-h-60 overflow-auto rounded bg-slate-50 p-3 text-xs">{office.conversion.output}</pre>}
          {!office.installed && <Alert>{office.advice ?? "LibreOffice is not installed on the server, so PowerPoint imports keep only their text."}</Alert>}
          {office.conversion?.ok && !slow && <Alert tone="green">PowerPoint imports will keep their design: each slide is imported as a picture of the slide exactly as designed.</Alert>}
          {slow && <Alert tone="amber">It works, but slowly. A real deck takes several times longer than this test and may time out. Move the Render service to a bigger instance.</Alert>}
        </section>
      )}
    </Page>
  );
}
