"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useApi, send, Page, PageHeader, Alert, Badge, Field, Loading, Empty, fmtDate } from "@/components/ui";
import PlatformNav from "@/components/platform/PlatformNav";

type Code = { id: string; hint: string; label: string; lead: string | null; school: string | null; plan_code: string | null; created_at: string; expires_at: string;
  used_at: string | null; revoked_at: string | null; status: "open" | "used" | "expired" | "revoked" };
const TONE = { open: "blue", used: "green", expired: "slate", revoked: "red" } as const;
const LABEL = { open: "Waiting to be used", used: "Used", expired: "Expired", revoked: "Cancelled" } as const;

export default function CodesPage() {
  return <Suspense fallback={<Page wide><PlatformNav /><Loading /></Page>}><Codes /></Suspense>;
}

/** One-time school codes: the only way a school can set itself up. Each works once, then it is used up. */
function Codes() {
  const q = useSearchParams();
  const { data, error, reload } = useApi<{ owner: boolean; codes: Code[] }>("/api/platform/school-codes");
  const [f, setF] = useState({ label: q.get("school") ?? "", lead_id: q.get("lead") ?? "", valid_days: "7" });
  const [made, setMade] = useState<{ code: string; expires_at: string; label: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (error) return <Page wide><PlatformNav /><Alert>{error}</Alert></Page>;
  if (!data) return <Page wide><PlatformNav /><Loading /></Page>;
  async function create(e: React.FormEvent) {
    e.preventDefault();
    const r = await send<{ code: string; expires_at: string }>("/api/platform/school-codes", { action: "create", label: f.label, lead_id: f.lead_id || null, valid_days: Number(f.valid_days) });
    if (!r.ok) return setMsg({ ok: false, text: r.error ?? "failed" });
    setMade({ code: r.data.code, expires_at: r.data.expires_at, label: f.label }); setMsg(null);
    setF({ label: "", lead_id: "", valid_days: "7" }); reload();
  }
  const shareText = made ? `Your Synergy Swift school code: ${made.code}\nSet up your school at ${typeof window !== "undefined" ? window.location.origin : ""}/signup before ${fmtDate(made.expires_at)}. It works once.` : "";
  return (
    <Page wide>
      <PlatformNav />
      <PageHeader eyebrow="Synergy Swift platform" title="School codes" subtitle="A school can only be set up by you here, or by a prospect using a one-time code you make. Each code works once and is used up the moment the school is created. Unused codes expire on their date." />
      {msg && <div className="mb-4"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      {made && (
        <section className="card mb-5 border-brand-300 p-5">
          <p className="text-sm text-slate-600">Code for <b>{made.label}</b>, valid until {fmtDate(made.expires_at)}. Copy it now: it is not shown again.</p>
          <p className="mt-3 font-mono text-2xl font-semibold tracking-wider">{made.code}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={() => navigator.clipboard?.writeText(made.code)}>Copy code</button>
            <button className="btn btn-outline" onClick={() => navigator.clipboard?.writeText(shareText)}>Copy message for the school</button>
            <a className="btn btn-outline no-underline" href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer">Send on WhatsApp</a>
          </div>
        </section>
      )}
      {data.owner ? (
        <form className="card mb-6 grid gap-3 p-5 sm:grid-cols-[2fr_1fr_auto] sm:items-end" onSubmit={create}>
          <Field label="Which school is it for?"><input className="input" required minLength={2} maxLength={200} placeholder="e.g. Greenfield College, Ibadan" value={f.label} onChange={e => setF({ ...f, label: e.target.value })} /></Field>
          <Field label="Valid for"><select className="input" value={f.valid_days} onChange={e => setF({ ...f, valid_days: e.target.value })}>{[1, 3, 7, 14, 30].map(d => <option key={d} value={d}>{d} day{d === 1 ? "" : "s"}</option>)}</select></Field>
          <button className="btn btn-primary">Make a code</button>
          {f.lead_id && <p className="text-xs text-slate-500 sm:col-span-3">Linked to the prospect in Sales: when the school is set up, the lead is marked won.</p>}
        </form>
      ) : <div className="mb-6"><Alert tone="amber">Only the platform owner makes or cancels school codes.</Alert></div>}
      {!data.codes.length ? <Empty>No codes yet.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="p-2">For</th><th className="p-2">Code</th><th className="p-2">Status</th><th className="p-2">Made</th><th className="p-2">Expires</th><th className="p-2" /></tr></thead>
            <tbody className="divide-y divide-slate-100">{data.codes.map(c => (
              <tr key={c.id}>
                <td className="p-2"><span className="font-medium">{c.label}</span>{c.school && <span className="block text-xs text-slate-500">School: {c.school}</span>}{c.lead && !c.school && <span className="block text-xs text-slate-500">Prospect: {c.lead}</span>}</td>
                <td className="p-2 font-mono text-xs text-slate-600">…{c.hint}</td>
                <td className="p-2"><Badge tone={TONE[c.status]}>{LABEL[c.status]}</Badge>{c.used_at && <span className="block text-xs text-slate-500">{fmtDate(c.used_at, true)}</span>}</td>
                <td className="p-2 text-xs">{fmtDate(c.created_at)}</td>
                <td className="p-2 text-xs">{fmtDate(c.expires_at)}</td>
                <td className="p-2 text-right">{data.owner && c.status === "open" && <button className="text-xs text-rose-700 underline" onClick={async () => {
                  if (!confirm(`Cancel the code for ${c.label}? It will stop working at once.`)) return;
                  const r = await send("/api/platform/school-codes", { action: "revoke", id: c.id });
                  setMsg({ ok: r.ok, text: r.ok ? "Code cancelled." : r.error ?? "failed" }); reload();
                }}>Cancel</button>}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </Page>
  );
}
