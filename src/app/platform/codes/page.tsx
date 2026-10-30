"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useApi, send, Page, PageHeader, Alert, Badge, Field, Loading, Empty, fmtDate } from "@/components/ui";
import PlatformNav from "@/components/platform/PlatformNav";
import { MadeCode, type MadeCodeData } from "@/components/platform/SchoolCode";

type Code = { id: string; hint: string; label: string; lead: string | null; school: string | null; for_school: string | null; plan_code: string | null; created_at: string; expires_at: string;
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
  const [f, setF] = useState({ label: q.get("school") ?? "", lead_id: q.get("lead") ?? "" });
  const [made, setMade] = useState<MadeCodeData | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (error) return <Page wide><PlatformNav /><Alert>{error}</Alert></Page>;
  if (!data) return <Page wide><PlatformNav /><Loading /></Page>;
  async function create(e: React.FormEvent) {
    e.preventDefault();
    const r = await send<{ code: string; expires_at: string }>("/api/platform/school-codes", { action: "create", label: f.label, lead_id: f.lead_id || null });
    if (!r.ok) return setMsg({ ok: false, text: r.error ?? "failed" });
    setMade({ code: r.data.code, expires_at: r.data.expires_at, label: f.label }); setMsg(null);
    setF({ label: "", lead_id: "" }); reload();
  }
  return (
    <Page wide>
      <PlatformNav />
      <PageHeader eyebrow="Synergy Swift platform" title="Onboarding codes" subtitle="A code here sets up a brand-new school. For a school you have already created, open it from Schools and use Make an onboarding code: whoever signs up with that code becomes its administrator. Each code works once and lasts 20 minutes." />
      {msg && <div className="mb-4"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      {made && <div className="mb-5"><MadeCode made={made} /></div>}
      {data.owner ? (
        <form className="card mb-6 grid gap-3 p-5 sm:grid-cols-[1fr_auto] sm:items-end" onSubmit={create}>
          <Field label="Which school is it for?"><input className="input" required minLength={2} maxLength={200} placeholder="e.g. Greenfield College, Ibadan" value={f.label} onChange={e => setF({ ...f, label: e.target.value })} /></Field>
          <button className="btn btn-primary">Make a code</button>
          <p className="text-xs text-slate-500 sm:col-span-2">The code works once and lasts 20 minutes.</p>
          {f.lead_id && <p className="text-xs text-slate-500 sm:col-span-2">Linked to the prospect in Sales: when the school is set up, the lead is marked won.</p>}
        </form>
      ) : <div className="mb-6"><Alert tone="amber">Only the platform owner makes or cancels school codes.</Alert></div>}
      {!data.codes.length ? <Empty>No codes yet.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="p-2">For</th><th className="p-2">Code</th><th className="p-2">Status</th><th className="p-2">Made</th><th className="p-2">Expires</th><th className="p-2" /></tr></thead>
            <tbody className="divide-y divide-slate-100">{data.codes.map(c => (
              <tr key={c.id}>
                <td className="p-2"><span className="font-medium">{c.label}</span>{c.for_school && <span className="block text-xs text-slate-500">Admin account for this school</span>}{c.school && !c.for_school && <span className="block text-xs text-slate-500">School: {c.school}</span>}{c.lead && !c.school && <span className="block text-xs text-slate-500">Prospect: {c.lead}</span>}</td>
                <td className="p-2 font-mono text-xs text-slate-600">…{c.hint}</td>
                <td className="p-2"><Badge tone={TONE[c.status]}>{LABEL[c.status]}</Badge>{c.used_at && <span className="block text-xs text-slate-500">{fmtDate(c.used_at, true)}</span>}</td>
                <td className="p-2 text-xs">{fmtDate(c.created_at)}</td>
                <td className="p-2 text-xs">{fmtDate(c.expires_at, true)}</td>
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
