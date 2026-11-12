"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useApi, send, Page, PageHeader, Alert, Badge, Empty, Loading, fmtDate } from "@/components/ui";
import type { TranscriptRow } from "@/lib/onboarding-codes-server";

/**
 * School office → Transcripts (admins): a parent opens a child's transcript only with the code made
 * here for that child, and only if they are linked to the child. Codes by student, class or the whole
 * school; send them to the parents; see who opened each transcript and take access back.
 */
export default function TranscriptsPage() {
  const { data, error, reload } = useApi<{ rows: TranscriptRow[] }>("/api/school/transcript-codes");
  const [cls, setCls] = useState("");
  const [q, setQ] = useState("");
  const [days, setDays] = useState<string>("30");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const classes = useMemo(() => [...new Map((data?.rows ?? []).filter(r => r.class_id).map(r => [r.class_id!, r.class_name ?? "Class"])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [data]);
  const rows = useMemo(() => (data?.rows ?? []).filter(r => (!cls || r.class_id === cls) && (!q.trim() || `${r.name} ${r.admission_no ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()))), [data, cls, q]);

  async function act(body: Record<string, unknown>, ok: (d: any) => string) {
    setBusy(true);
    const r = await send("/api/school/transcript-codes", body, "POST", { quiet: true });
    setBusy(false);
    setMsg({ ok: r.ok, text: r.ok ? ok(r.data) : r.error ?? "failed" });
    if (r.ok) reload();
  }
  const ids = rows.map(r => r.id);
  const period = days === "" ? null : Number(days);
  const scope = cls ? `everyone in ${classes.find(c => c[0] === cls)?.[1] ?? "this class"}` : q.trim() ? `the ${rows.length} students shown` : "every student";

  return (
    <Page wide>
      <PageHeader eyebrow="School office" title="Transcripts"
        subtitle="Parents open a child's transcript only with the code you make here for that child. Codes work only for a parent already linked to the child, for up to 4 parents, and for as long as you choose." />
      {msg && <div className="mb-4"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      {error && <Alert>{error}</Alert>}
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <select className="input w-auto" value={cls} onChange={e => setCls(e.target.value)} aria-label="Class">
          <option value="">All classes</option>{classes.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <input className="input w-56" placeholder="Find a student" value={q} onChange={e => setQ(e.target.value)} aria-label="Find a student" />
        <label className="flex items-center gap-2 text-sm">Codes work for
          <select className="input w-auto py-1" value={days} onChange={e => setDays(e.target.value)} aria-label="How long codes work">
            <option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="365">a year</option><option value="">until replaced</option>
          </select></label>
        <span className="ml-auto" />
        <button className="btn btn-primary" disabled={busy || !ids.length} onClick={() => confirm(`Make transcript codes for ${scope} (${ids.length})? Any older codes for them stop working.`)
          && act({ action: "generate", student_ids: ids, days: period }, d => `${d.made} code${d.made === 1 ? "" : "s"} made.`)}>Make codes for {cls ? "this class" : q.trim() ? "those shown" : "everyone"}</button>
        <button className="btn btn-outline" disabled={busy || !rows.some(r => r.code)} onClick={() => confirm(`Send the codes for ${scope} to their parents?`)
          && act({ action: "send", student_ids: rows.filter(r => r.code).map(r => r.id) }, d => `${d.messages} message${d.messages === 1 ? "" : "s"} sent.${d.skipped ? ` ${d.skipped} had no code or no parent contact.` : ""}`)}>Send to parents</button>
        <button className="btn btn-ghost" disabled={!rows.length} onClick={() => window.print()}>Print slips</button>
      </div>

      {!data ? <Loading /> : !rows.length ? <Empty>No students.</Empty> : (
        <div className="card overflow-x-auto print:border-0 print:shadow-none">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 print:hidden">
              <tr><th className="p-3">Student</th><th className="p-3">Transcript code</th><th className="p-3">Opened by</th><th className="p-3">Download &amp; print</th><th className="p-3 text-right">Actions</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(r => (
                <tr key={r.id} className="break-inside-avoid align-top">
                  <td className="p-3"><b>{r.name}</b><span className="block text-xs text-slate-500">{[r.admission_no, r.class_name].filter(Boolean).join(" · ")}</span></td>
                  <td className="p-3">
                    {r.code ? <><span className="font-mono text-base tracking-widest">{r.code}</span>
                      <span className="block text-xs text-slate-500">{r.uses} of {r.max_uses} parents{r.expires_at ? ` · until ${fmtDate(r.expires_at)}` : ""}</span></>
                      : <Badge tone="slate">No code</Badge>}
                    <span className="hidden text-xs text-slate-600 print:block">Parent of {r.name}: sign in → Portfolio &amp; transcript → choose {r.name} → type this code.</span>
                  </td>
                  <td className="p-3 text-xs">
                    {!r.unlocked_by.length ? <span className="text-slate-500">{r.parents ? "Nobody yet" : "No parent linked"}</span> : r.unlocked_by.map(u => (
                      <span key={u.user_id} className="flex items-center gap-2">{u.name} <span className="text-slate-400">{fmtDate(u.at)}</span>
                        <button className="text-rose-700 hover:underline print:hidden" onClick={() => confirm(`Take ${u.name}'s access to this transcript back?`) && act({ action: "revoke_access", student_id: r.id, user_id: u.user_id }, () => "Access taken back.")}>Take back</button></span>))}
                  </td>
                  <td className="p-3"><Badge tone={r.released ? "green" : "amber"}>{r.released ? "Allowed" : "Read only"}</Badge></td>
                  <td className="p-3 text-right print:hidden">
                    <div className="flex flex-wrap justify-end gap-1">
                      <button className="btn btn-ghost px-2 py-1 text-xs" disabled={busy} onClick={() => act({ action: "generate", student_ids: [r.id], days: period }, () => `New code made for ${r.name}.`)}>{r.code ? "New code" : "Make code"}</button>
                      {r.code && <button className="btn btn-ghost px-2 py-1 text-xs" disabled={busy} onClick={() => act({ action: "send", student_ids: [r.id] }, d => d.messages ? "Sent to the parents." : "No parent contact on record: print the slip.")}>Send</button>}
                      {r.code && <button className="btn btn-ghost px-2 py-1 text-xs text-rose-700" disabled={busy} onClick={() => confirm("Withdraw this code? Parents who already opened the transcript keep access until you take it back.") && act({ action: "revoke_code", student_id: r.id }, () => "Code withdrawn.")}>Withdraw</button>}
                      <button className="btn btn-ghost px-2 py-1 text-xs" disabled={busy} onClick={() => act({ action: "release", student_ids: [r.id], allowed: !r.released }, () => r.released ? "Download and print held back." : "Download and print allowed.")}>{r.released ? "Hold printing" : "Allow printing"}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-4 text-xs text-slate-500">Staff open any transcript from the student&apos;s record; students see their own. Transcripts use published report cards only. <Link className="text-brand-700 hover:underline" href="/school/results/report-cards">Report cards &amp; publishing</Link></p>
    </Page>
  );
}
