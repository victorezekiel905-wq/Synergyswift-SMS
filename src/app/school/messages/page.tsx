"use client";
import { useState } from "react";
import { useApi, send, Page, PageHeader, Alert, Empty, Field, Badge, statusTone, fmtDate } from "@/components/ui";

type Msg = { id: string; channel: string; to_address: string; to_name: string | null; kind: string; subject: string | null; status: string; attempts: number; last_error: string | null; created_at: string; sent_at: string | null; template_name: string | null };

export default function MessagesPage() {
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const { data, error, reload } = useApi<{ items: Msg[]; providers: { email: boolean; whatsapp: boolean; sms?: boolean; push?: boolean; ai?: boolean } }>(`/api/messages?${new URLSearchParams({ ...(status ? { status } : {}), ...(kind ? { kind } : {}) })}`, [status, kind]);
  const { data: structure } = useApi<{ class_groups: { id: string; name: string }[] }>("/api/school/structure");
  const [b, setB] = useState({ title: "", body: "", class_group_ids: [] as string[], email: true, whatsapp: true, sms: false, push: true, translate: true });
  const [ask, setAsk] = useState("");
  const [drafting, setDrafting] = useState(false);
  async function draft() {
    if (ask.trim().length < 5) return;
    setDrafting(true);
    const r = await send<{ title: string; body: string }>("/api/messages", { action: "draft", instruction: ask.trim() });
    setDrafting(false);
    if (!r.ok) { setMsg({ ok: false, text: r.error ?? "failed" }); return; }
    setB(x => ({ ...x, title: r.data.title, body: r.data.body }));
    setMsg({ ok: true, text: "Draft ready. Check every detail before sending." });
  }
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function broadcast(e: React.FormEvent) {
    e.preventDefault();
    if (!confirm(`Send "${b.title}" to parents of ${b.class_group_ids.length ? `${b.class_group_ids.length} classes` : "the whole school"}?`)) return;
    setBusy(true);
    const r = await send("/api/messages", { action: "broadcast", title: b.title, body: b.body, class_group_ids: b.class_group_ids,
      channels: [...(b.email ? ["email"] : []), ...(b.whatsapp ? ["whatsapp"] : []), ...(b.sms ? ["sms"] : []), ...(b.push ? ["push"] : [])], translate: b.translate });
    setBusy(false);
    setMsg({ ok: r.ok, text: r.ok ? `Queued ${r.data.messages_queued} messages to ${r.data.guardians} guardians${r.data.translated_into?.length ? ` (translated into ${r.data.translated_into.length} languages)` : ""}. Sent now: ${r.data.delivery?.sent ?? 0}.` : r.error ?? "failed" });
    if (r.ok) { setB({ ...b, title: "", body: "" }); reload(); }
  }
  async function retry(ids: string[]) {
    const r = await send("/api/messages", { action: "retry", ids });
    setMsg({ ok: r.ok, text: r.ok ? `Retried. Sent: ${r.data.delivery?.sent ?? 0}.` : r.error ?? "failed" });
    reload();
  }
  const failed = (data?.items ?? []).filter(m => m.status === "failed" || m.status === "skipped");

  return (
    <Page wide>
      <PageHeader eyebrow="Communication" title="Messages to parents" subtitle="Broadcast by WhatsApp and email, and see the delivery status of every result, sign-in alert and pickup code." />
      {data && (!data.providers.email || !data.providers.whatsapp) && (
        <div className="mb-4"><Alert tone="amber">
          {!data.providers.whatsapp && "WhatsApp is not configured on the server. "}{!data.providers.email && "Email is not configured on the server. "}
          Messages for unconfigured channels are recorded as “skipped” and can be retried once your provider sets it up.
        </Alert></div>
      )}
      {msg && <div className="mb-4"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      <div className="grid gap-5 xl:grid-cols-3">
        <form onSubmit={broadcast} className="card h-fit space-y-3 p-5">
          <h2 className="font-semibold">Broadcast</h2>
          {data?.providers.ai && (
            <div className="rounded-lg bg-violet-50 p-3">
              <Field label="Draft with AI" hint="Say what parents need to know. Nothing is invented; missing details are left as [placeholders].">
                <textarea className="input h-16" maxLength={1500} value={ask} onChange={e => setAsk(e.target.value)} placeholder="e.g. Sports day is Friday 10 Oct from 9am, children wear house colours, parents welcome" />
              </Field>
              <button type="button" className="btn btn-ghost mt-1 border border-violet-200 text-xs" disabled={drafting || ask.trim().length < 5} onClick={draft}>{drafting ? "Drafting…" : "Draft"}</button>
            </div>
          )}
          <Field label="Title"><input className="input" required maxLength={120} value={b.title} onChange={e => setB({ ...b, title: e.target.value })} /></Field>
          <Field label="Message"><textarea className="input h-32" required maxLength={3000} value={b.body} onChange={e => setB({ ...b, body: e.target.value })} /></Field>
          <fieldset>
            <legend className="label">Classes (none selected = whole school)</legend>
            <div className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto text-sm">
              {(structure?.class_groups ?? []).map(g => (
                <label key={g.id} className="flex items-center gap-2"><input type="checkbox" checked={b.class_group_ids.includes(g.id)}
                  onChange={e => setB({ ...b, class_group_ids: e.target.checked ? [...b.class_group_ids, g.id] : b.class_group_ids.filter(x => x !== g.id) })} />{g.name}</label>
              ))}
            </div>
          </fieldset>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={b.whatsapp} onChange={e => setB({ ...b, whatsapp: e.target.checked })} /> WhatsApp</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={b.email} onChange={e => setB({ ...b, email: e.target.checked })} /> Email</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={b.sms} onChange={e => setB({ ...b, sms: e.target.checked })} /> SMS</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={b.push} onChange={e => setB({ ...b, push: e.target.checked })} /> App</label>
          </div>
          {data?.providers.ai && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={b.translate} onChange={e => setB({ ...b, translate: e.target.checked })} /> Translate for parents who chose another language</label>}
          <button className="btn btn-primary w-full" disabled={busy || (!b.email && !b.whatsapp && !b.sms && !b.push)}>{busy ? "Sending…" : "Send"}</button>
        </form>
        <section className="xl:col-span-2">
          <div className="mb-3 flex flex-wrap gap-2">
            <select className="input w-auto" value={status} onChange={e => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option>{["queued", "sending", "sent", "failed", "skipped"].map(s => <option key={s}>{s}</option>)}</select>
            <select className="input w-auto" value={kind} onChange={e => setKind(e.target.value)} aria-label="Kind"><option value="">All kinds</option>{["result", "gate_in", "gate_out", "pickup_code", "pickup_done", "broadcast", "message", "portal_link", "library_overdue", "invite", "fee_receipt", "fee_reminder", "absence", "bus", "bus_near", "wallet_topup", "wallet_low", "cover"].map(s => <option key={s}>{s}</option>)}</select>
            <button className="btn btn-ghost" onClick={reload}>Refresh</button>
            {failed.length > 0 && <button className="btn btn-ghost ml-auto border border-slate-200" onClick={() => retry(failed.map(m => m.id))}>Retry {failed.length} failed / skipped</button>}
          </div>
          {error && <Alert>{error}</Alert>}
          {!data?.items.length ? <Empty>No messages yet.</Empty> : (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">When</th><th className="p-2">To</th><th className="p-2">Kind</th><th className="p-2">Channel</th><th className="p-2">Status</th></tr></thead>
                <tbody>
                  {data.items.map(m => (
                    <tr key={m.id} className="border-t border-slate-100 align-top">
                      <td className="p-2 text-xs text-slate-500">{fmtDate(m.created_at, true)}</td>
                      <td className="p-2">{m.to_name}<div className="text-xs text-slate-500">{m.to_address}</div></td>
                      <td className="p-2 text-xs">{m.kind}<div className="text-slate-500">{m.subject}</div></td>
                      <td className="p-2 text-xs">{m.channel}{m.template_name ? ` · ${m.template_name}` : ""}</td>
                      <td className="p-2"><Badge tone={statusTone(m.status)}>{m.status}</Badge>{m.last_error && <div className="mt-1 max-w-xs break-words text-[11px] text-rose-600">{m.last_error}</div>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </Page>
  );
}
