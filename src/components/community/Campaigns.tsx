"use client";
import { useEffect, useState } from "react";
import { useApi, send, Alert, Badge, Empty, Field, Loading, Modal, fmtDate, statusTone } from "@/components/ui";
import type { Block, SegmentRules } from "@/lib/community";
import { RulesEditor } from "./Families";

type Audience = { type: "parents"; class_group_ids?: string[]; segment_id?: string | null } | { type: "alumni"; years?: number[]; mentors_only?: boolean } | { type: "partners"; kinds?: string[] };
type Campaign = {
  id: string; name: string; kind: "campaign" | "newsletter"; subject: string; body: string; blocks: Block[]; channels: string[]; audience: Audience;
  status: string; scheduled_at: string | null; sent_at: string | null; recipients: number; created_at: string; stats: Record<string, number> | null;
};
type ListData = { items: Campaign[]; segments: { id: string; name: string }[]; classes: { id: string; name: string }[]; alumni_years: number[]; providers: { email: boolean; whatsapp: boolean; sms: boolean } };
const PARTNER_KINDS = ["vendor", "supplier", "partner", "sponsor", "ngo", "government", "media", "other"];

const audienceLabel = (a: Audience, l: ListData) => a.type === "alumni" ? `Alumni${a.years?.length ? ` (${a.years.join(", ")})` : ""}${a.mentors_only ? ", mentors" : ""}`
  : a.type === "partners" ? `Partners${a.kinds?.length ? ` (${a.kinds.join(", ")})` : ""}`
  : a.segment_id ? `Segment: ${l.segments.find(s => s.id === a.segment_id)?.name ?? "—"}` : a.class_group_ids?.length ? `${a.class_group_ids.length} class${a.class_group_ids.length === 1 ? "" : "es"}` : "All families";

/** Email, SMS and WhatsApp campaigns and newsletters to families, alumni or partners. */
export default function Campaigns() {
  const { data, error, reload } = useApi<ListData>("/api/community/campaigns");
  const [edit, setEdit] = useState<Partial<Campaign> | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [segOpen, setSegOpen] = useState(false);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const act = async (body: Record<string, unknown>, ok: (d: any) => string, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    setMsg(null);
    const r = await send("/api/community/campaigns", body);
    setMsg({ ok: r.ok, text: r.ok ? ok(r.data) : r.error ?? "failed" });
    reload();
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-sm text-slate-600">Families who unsubscribe still get essential messages (results, attendance, fees, safety). {!data.providers.email && <b className="text-amber-700">Email is not set up yet.</b>}</p>
        <button className="btn btn-outline" onClick={() => setSegOpen(true)}>Segments</button>
        <button className="btn btn-outline" onClick={() => setEdit({ kind: "newsletter", name: "", subject: "", body: "", blocks: [{ heading: "", text: "" }], channels: ["email"], audience: { type: "parents" } })}>New newsletter</button>
        <button className="btn btn-primary" onClick={() => setEdit({ kind: "campaign", name: "", subject: "", body: "Dear {first_name},\n\n", blocks: [], channels: ["email"], audience: { type: "parents" } })}>New campaign</button>
      </div>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      {!data.items.length ? <Empty>No campaigns yet. Try a newsletter, a fee-deadline reminder for families who owe, or an open-day invitation to alumni.</Empty> : (
        <ul className="card divide-y divide-slate-100 text-sm">{data.items.map(c => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-56 flex-1">
              <p className="font-medium">{c.name} <Badge tone={statusTone(c.status)}>{c.status}</Badge> <Badge tone="violet">{c.kind}</Badge></p>
              <p className="text-xs text-slate-500">{c.subject} · {audienceLabel(c.audience, data)} · {c.channels.join(", ")}</p>
              <p className="text-xs text-slate-500">{c.status === "scheduled" && c.scheduled_at ? `Goes out ${fmtDate(c.scheduled_at, true)}` : c.sent_at ? `Sent ${fmtDate(c.sent_at, true)} to ${c.recipients}` : `Created ${fmtDate(c.created_at)}`}</p>
            </div>
            {c.stats && <p className="text-xs tabular-nums text-slate-600">{c.stats.sent ?? 0} delivered{c.stats.failed ? ` · ${c.stats.failed} failed` : ""}{c.stats.queued ? ` · ${c.stats.queued} queued` : ""}{c.stats.skipped ? ` · ${c.stats.skipped} skipped` : ""}</p>}
            <span className="flex flex-wrap gap-1">
              {["draft", "scheduled"].includes(c.status) && <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => setEdit(c)}>Edit</button>}
              {["draft", "scheduled"].includes(c.status) && <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => act({ action: "test", id: c.id }, d => `Test sent to ${d.to}.`)}>Send me a test</button>}
              {["draft", "scheduled"].includes(c.status) && <button className="btn btn-primary px-2 py-1 text-xs" onClick={() => act({ action: "send", id: c.id }, d => `Sent to ${d.recipients} (${d.messages} messages).`, `Send "${c.name}" now?`)}>Send now</button>}
              {c.status === "scheduled" && <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => act({ action: "cancel", id: c.id }, () => "Schedule cancelled; it is a draft again.")}>Unschedule</button>}
              <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => act({ action: "duplicate", id: c.id }, () => "Copied as a new draft.")}>Duplicate</button>
              {c.status === "draft" && <button className="btn btn-outline px-2 py-1 text-xs text-rose-700" onClick={() => act({ action: "delete", id: c.id }, () => "Deleted.", "Delete this draft?")}>Delete</button>}
            </span>
          </li>
        ))}</ul>
      )}
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.id ? "Edit" : edit?.kind === "newsletter" ? "New newsletter" : "New campaign"} wide>
        {edit && <Editor c={edit} list={data} onDone={(t) => { setEdit(null); setMsg({ ok: true, text: t }); reload(); }} />}
      </Modal>
      <Modal open={segOpen} onClose={() => { setSegOpen(false); reload(); }} title="Family segments" wide>
        {segOpen && <Segments classes={data.classes} />}
      </Modal>
    </div>
  );
}

function Editor({ c, list, onDone }: { c: Partial<Campaign>; list: ListData; onDone: (msg: string) => void }) {
  const [d, setD] = useState<Partial<Campaign>>(c);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ recipients: number; with_email: number; with_phone: number; sms_parts: number; html: string; whatsapp: string; names: string[] } | null>(null);
  const [when, setWhen] = useState("");
  const a = d.audience ?? { type: "parents" };
  // Refresh the recipient count and preview a moment after edits stop.
  useEffect(() => {
    const t = setTimeout(async () => {
      const r = await send<any>("/api/community/campaigns", { action: "preview", audience: a, channels: d.channels, kind: d.kind, subject: d.subject ?? "", body: d.body ?? "", blocks: (d.blocks ?? []).map(cleanBlock) });
      if (r.ok) setPreview(r.data);
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify([a, d.channels, d.kind, d.subject, d.body, d.blocks])]);
  const save = async () => {
    setErr(null);
    const r = await send<{ id: string }>("/api/community/campaigns", { action: "save", id: d.id ?? null, name: d.name, kind: d.kind, subject: d.subject, body: d.body ?? "", blocks: (d.blocks ?? []).map(cleanBlock), channels: d.channels, audience: a });
    if (!r.ok) { setErr(r.error); return null; }
    return r.data.id;
  };
  const toggleChannel = (ch: string) => setD({ ...d, channels: d.channels?.includes(ch) ? d.channels.filter(x => x !== ch) : [...(d.channels ?? []), ch] });
  const setBlock = (i: number, b: Partial<Block>) => setD({ ...d, blocks: (d.blocks ?? []).map((x, j) => (j === i ? { ...x, ...b } : x)) });
  return (
    <div className="grid gap-4 text-sm lg:grid-cols-2">
      <form className="space-y-3" onSubmit={async e => { e.preventDefault(); if (await save()) onDone("Saved as a draft."); }}>
        {err && <Alert>{err}</Alert>}
        <Field label="Name (for you)"><input className="input" value={d.name ?? ""} onChange={e => setD({ ...d, name: e.target.value })} required minLength={2} maxLength={120} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Send to">
            <select className="input" value={a.type} onChange={e => setD({ ...d, audience: { type: e.target.value as Audience["type"] } as Audience })}>
              <option value="parents">Families</option><option value="alumni">Alumni</option><option value="partners">Partners and vendors</option>
            </select>
          </Field>
          {a.type === "parents" && (
            <Field label="Which families">
              <select className="input" value={a.segment_id ?? ""} onChange={e => setD({ ...d, audience: { ...a, segment_id: e.target.value || null } })}>
                <option value="">All families</option>{list.segments.map(s => <option key={s.id} value={s.id}>Segment: {s.name}</option>)}
              </select>
            </Field>
          )}
          {a.type === "alumni" && (
            <Field label="Graduation years" hint="None selected = all years.">
              <select className="input" multiple size={3} value={(a.years ?? []).map(String)} onChange={e => setD({ ...d, audience: { ...a, years: [...e.target.selectedOptions].map(o => Number(o.value)) } })}>
                {list.alumni_years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </Field>
          )}
          {a.type === "partners" && (
            <Field label="Kinds" hint="None selected = all.">
              <select className="input" multiple size={3} value={a.kinds ?? []} onChange={e => setD({ ...d, audience: { ...a, kinds: [...e.target.selectedOptions].map(o => o.value) } })}>
                {PARTNER_KINDS.map(k => <option key={k}>{k}</option>)}
              </select>
            </Field>
          )}
        </div>
        {a.type === "parents" && (
          <Field label="Only these classes (optional)" hint="Hold Ctrl or ⌘ to pick several.">
            <select className="input" multiple size={3} value={a.class_group_ids ?? []} onChange={e => setD({ ...d, audience: { ...a, class_group_ids: [...e.target.selectedOptions].map(o => o.value) } })}>
              {list.classes.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
        )}
        {a.type === "alumni" && <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(a.mentors_only)} onChange={e => setD({ ...d, audience: { ...a, mentors_only: e.target.checked } })} /> Only alumni willing to mentor</label>}
        <div><span className="label">Channels</span><div className="flex gap-3">{(["email", "sms", "whatsapp"] as const).map(ch => (
          <label key={ch} className="flex items-center gap-1"><input type="checkbox" checked={Boolean(d.channels?.includes(ch))} onChange={() => toggleChannel(ch)} /> {ch === "sms" ? "SMS" : ch === "whatsapp" ? "WhatsApp" : "Email"}{!list.providers[ch] && <span className="text-xs text-amber-700"> (not set up)</span>}</label>
        ))}</div>
          {d.channels?.includes("whatsapp") && <p className="mt-1 text-xs text-amber-700">WhatsApp campaigns are free-form messages and only reach people who messaged the school in the last 24 hours.</p>}</div>
        <Field label="Subject" hint="Use {first_name}, {name} or {school} to personalise."><input className="input" value={d.subject ?? ""} onChange={e => setD({ ...d, subject: e.target.value })} required minLength={2} maxLength={160} /></Field>
        <Field label={d.kind === "newsletter" ? "Opening note" : "Message"}><textarea className="input min-h-32" value={d.body ?? ""} onChange={e => setD({ ...d, body: e.target.value })} maxLength={10000} /></Field>
        {d.kind === "newsletter" && (
          <div className="space-y-2">
            <span className="label">Sections</span>
            {(d.blocks ?? []).map((b, i) => (
              <div key={i} className="space-y-1 rounded-lg border border-slate-200 p-2">
                <div className="flex gap-2"><input className="input" value={b.heading ?? ""} onChange={e => setBlock(i, { heading: e.target.value })} placeholder="Heading" maxLength={160} aria-label={`Section ${i + 1} heading`} />
                  <button type="button" className="text-xs text-rose-600" onClick={() => setD({ ...d, blocks: (d.blocks ?? []).filter((_, j) => j !== i) })} aria-label="Remove section">✕</button></div>
                <textarea className="input min-h-20" value={b.text ?? ""} onChange={e => setBlock(i, { text: e.target.value })} placeholder="Story" maxLength={4000} aria-label="Section text" />
                <input className="input" value={b.image_url ?? ""} onChange={e => setBlock(i, { image_url: e.target.value })} placeholder="Image link (https://…)" aria-label="Image link" />
                <div className="flex gap-2"><input className="input" value={b.link_url ?? ""} onChange={e => setBlock(i, { link_url: e.target.value })} placeholder="Read-more link (https://…)" aria-label="Link" />
                  <input className="input w-36" value={b.link_label ?? ""} onChange={e => setBlock(i, { link_label: e.target.value })} placeholder="Link text" maxLength={60} aria-label="Link text" /></div>
              </div>
            ))}
            {(d.blocks ?? []).length < 20 && <button type="button" className="btn btn-outline px-2 py-1 text-xs" onClick={() => setD({ ...d, blocks: [...(d.blocks ?? []), { heading: "", text: "" }] })}>+ Section</button>}
          </div>
        )}
        <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
          <button className="btn btn-outline">Save draft</button>
          <label className="text-xs">Schedule for<input className="input" type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} /></label>
          <button type="button" className="btn btn-outline" disabled={!when} onClick={async () => {
            const id = await save(); if (!id) return;
            const r = await send("/api/community/campaigns", { action: "schedule", id, at: new Date(when).toISOString() });
            if (r.ok) onDone(`Scheduled for ${new Date(when).toLocaleString()}.`); else setErr(r.error);
          }}>Schedule</button>
          <button type="button" className="btn btn-primary" onClick={async () => {
            if (!confirm(`Send to ${preview?.recipients ?? "the chosen"} recipients now?`)) return;
            const id = await save(); if (!id) return;
            const r = await send<{ recipients: number; messages: number }>("/api/community/campaigns", { action: "send", id });
            if (r.ok) onDone(`Sent to ${r.data.recipients} (${r.data.messages} messages).`); else setErr(r.error);
          }}>Send now</button>
        </div>
      </form>
      <aside className="space-y-2">
        {preview ? <>
          <p><b>{preview.recipients}</b> recipient{preview.recipients === 1 ? "" : "s"} · {preview.with_email} with email · {preview.with_phone} with a phone{d.channels?.includes("sms") ? ` · SMS: ${preview.sms_parts} part${preview.sms_parts === 1 ? "" : "s"} each` : ""}</p>
          {preview.names.length > 0 && <p className="text-xs text-slate-500">Including {preview.names.join(", ")}{preview.recipients > preview.names.length ? "…" : ""}</p>}
          <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="h-[28rem] w-full rounded-lg border border-slate-200 bg-white" />
          {(d.channels?.includes("whatsapp") || d.channels?.includes("sms")) && <pre className="whitespace-pre-wrap rounded-lg bg-emerald-50 p-2 text-xs">{preview.whatsapp}</pre>}
        </> : <Loading label="Preparing preview…" />}
      </aside>
    </div>
  );
}

const cleanBlock = (b: Block) => ({ heading: b.heading || null, text: b.text || null, image_url: b.image_url || "", link_url: b.link_url || "", link_label: b.link_label || null });

function Segments({ classes }: { classes: { id: string; name: string }[] }) {
  const { data, reload } = useApi<{ items: { id: string; name: string; rules: SegmentRules; description: string; count: number }[] }>("/api/community/segments");
  const [edit, setEdit] = useState<{ id?: string; name: string; rules: SegmentRules } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!data) return <Loading />;
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">Segments are saved filters. They update by themselves: a family joins or leaves as their fees, answers and children&apos;s classes change.</p>
      {err && <Alert>{err}</Alert>}
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">{data.items.map(s => (
        <li key={s.id} className="flex flex-wrap items-center gap-2 p-2">
          <span className="flex-1"><b>{s.name}</b> <span className="text-xs text-slate-500">{s.description}</span></span>
          <Badge>{s.count} families</Badge>
          <button className="text-xs text-brand-700" onClick={() => setEdit({ id: s.id, name: s.name, rules: s.rules })}>Edit</button>
          <button className="text-xs text-rose-700" onClick={async () => { if (!confirm(`Delete "${s.name}"?`)) return; await send("/api/community/segments", { action: "delete", id: s.id }); reload(); }}>Delete</button>
        </li>
      ))}{!data.items.length && <li className="p-3 text-slate-500">No segments yet.</li>}</ul>
      {edit ? (
        <form className="space-y-3 rounded-lg border border-slate-200 p-3" onSubmit={async e => {
          e.preventDefault();
          const r = await send("/api/community/segments", { action: "save", id: edit.id ?? null, name: edit.name, rules: edit.rules });
          if (r.ok) { setEdit(null); setErr(null); reload(); } else setErr(r.error);
        }}>
          <Field label="Name"><input className="input" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} required minLength={2} maxLength={80} /></Field>
          <RulesEditor rules={edit.rules} onChange={rules => setEdit({ ...edit, rules })} classes={classes} />
          <div className="flex gap-2"><button className="btn btn-primary">Save segment</button><button type="button" className="btn btn-outline" onClick={() => setEdit(null)}>Cancel</button></div>
        </form>
      ) : <button className="btn btn-outline" onClick={() => setEdit({ name: "", rules: {} })}>New segment</button>}
    </div>
  );
}
