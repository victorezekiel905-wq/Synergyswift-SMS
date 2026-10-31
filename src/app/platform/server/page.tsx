"use client";
import { useState } from "react";
import { useApi, send, Page, PageHeader, Alert, Loading } from "@/components/ui";
import PlatformNav from "@/components/platform/PlatformNav";

type Key = { ok: boolean; kind: string; problem: string | null; detail: string | null };
type Office = { installed: boolean; bin?: string; version?: string | null; advice?: string;
  server: { cpus: number; memory_mb: number; free_mb: number };
  conversion?: { ok: boolean; seconds: number; reason: string; output?: string } };

/** Is the server set up right: the Supabase service key, and PowerPoint imports keeping their design. */
export default function ServerCheck() {
  const { data, error } = useApi<{ key: Key; office: null; ai: { providers: string[]; test: null } }>("/api/platform/server-check");
  const [office, setOffice] = useState<Office | null>(null);
  const [ai, setAi] = useState<{ ok: boolean; seconds: number; error: string | null } | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run() {
    setRunning(true); setErr(null);
    const r = await fetch("/api/platform/server-check?run=1", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    setRunning(false);
    if (!r.ok) return setErr(j.error ?? "The check didn't finish. Try again.");
    setOffice(j.office);
    setAi(j.ai?.test ?? null);
  }
  const slow = office?.conversion?.ok && office.conversion.seconds > 20;
  return (
    <Page wide>
      <PlatformNav />
      <PageHeader eyebrow="Synergy Swift platform" title="Server check" subtitle="Whether the server's Supabase key works, and whether PowerPoint slide imports keep their design."
        actions={<button className="btn btn-primary" disabled={running} onClick={run}>{running ? "Checking (up to a minute)…" : office ? "Run the checks again" : "Check AI and PowerPoint import"}</button>} />
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
      {data && (
        <section className="card mb-4 p-5 text-sm">
          <h2 className="mb-1 font-semibold">AI (slides, drafts, the assistant)</h2>
          <p>{data.ai.providers.length
            ? <>Set up: <b>{data.ai.providers.join(", ")}</b>, tried in that order until one answers.</>
            : "No AI service is set up. Add a Gemini, Groq or OpenRouter key on Render (Environment)."}</p>
          {ai && (ai.ok
            ? <div className="mt-3"><Alert tone="green">AI answered in {ai.seconds} s. Slides, drafts and the assistant can work.</Alert></div>
            : <div className="mt-3"><Alert>AI didn&apos;t answer ({ai.seconds} s): {ai.error ?? "no reply"}. Check the keys on Render, or the service&apos;s own dashboard for usage limits.</Alert></div>)}
          {!ai && data.ai.providers.length > 0 && <p className="mt-1 text-xs text-slate-500">Press the button above to send a tiny test question.</p>}
        </section>
      )}
      <FreeLibraryCard />
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

/** The free library every school sees: how many books are loaded, and loading or refreshing it. */
function FreeLibraryCard() {
  const { data, reload } = useApi<{ loaded: number | null; missing_table: boolean; shipped: { total: number; bySource: Record<string, number>; built: string } | null }>("/api/platform/open-books");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!data) return null;
  async function load() {
    setBusy(true); setMsg(null);
    const r = await send<{ loaded: number }>("/api/platform/open-books", {});
    setBusy(false);
    setMsg({ ok: r.ok, text: r.ok ? `${r.data.loaded.toLocaleString("en-NG")} books loaded. Every school sees them now.` : r.error ?? "Loading stopped." });
    reload();
  }
  return (
    <section className="card mb-4 space-y-2 p-5 text-sm">
      <h2 className="font-semibold">Free library</h2>
      <p>{data.missing_table ? "Needs the database update (migration 20260101009100) first." : `${(data.loaded ?? 0).toLocaleString("en-NG")} books loaded. Every school sees them in Library → Free library.`}</p>
      {data.shipped && <p className="text-xs text-slate-500">This version ships {data.shipped.total.toLocaleString("en-NG")} books ({Object.entries(data.shipped.bySource).map(([s, n]) => `${s.replace(/_/g, " ")} ${n.toLocaleString("en-NG")}`).join(", ")}), chosen for schools.</p>}
      <button className="btn btn-primary" disabled={busy || data.missing_table} onClick={load}>{busy ? "Loading (a minute or two)…" : data.loaded ? "Refresh the free library" : "Load the free library"}</button>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
    </section>
  );
}
