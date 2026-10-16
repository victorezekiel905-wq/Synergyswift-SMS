"use client";
import { useEffect, useState } from "react";
import { useApi, send, Page, PageHeader, Tabs, Alert, Empty, Field, Badge, Modal, Loading, fmtDate } from "@/components/ui";
import RichText from "@/components/content/RichText";
import PeoplePicker, { type Person } from "@/components/comms/PeoplePicker";
import { PLACEHOLDERS } from "@/lib/communication";

type Opt = { id: string; name: string; section_id?: string | null };
type Stats = { total: number; read: number; acknowledged: number; unread: number; read_pct: number; ack_pct: number };
type Row = { id: string; kind: string; title: string; status: string; audience: { scope: string; ids?: string[] }; to_parents: boolean; to_students: boolean; to_staff: boolean;
  requires_ack: boolean; scheduled_for: string | null; sent_at: string | null; created_at: string; stats: Stats };
type Template = { id?: string; name: string; kind: string; title: string | null; body: string };
const KIND: Record<string, string> = { announcement: "Announcement", circular: "Circular", emergency: "Emergency" };
const STAFF_ROLES = ["teacher", "school_admin", "principal", "bursar", "librarian", "hr_manager", "qa_officer", "gate_officer", "transport_officer", "hostel_warden", "nurse", "counsellor", "cashier"];

type Form = { id?: string | null; kind: string; title: string; body: string; scope: string; ids: string[]; people: Person[]; to_parents: boolean; to_students: boolean; to_staff: boolean;
  staff_roles: string[]; requires_ack: boolean; channels: string[]; translate: boolean; schedule: string; expires: string };
const blank = (kind = "announcement"): Form => ({ kind, title: "", body: "", scope: "school", ids: [], people: [], to_parents: true, to_students: false, to_staff: kind === "emergency",
  staff_roles: [], requires_ack: kind !== "announcement", channels: ["push", "email", "whatsapp"], translate: kind !== "emergency", schedule: "", expires: "" });

/** Announcements, circulars and emergency alerts with read receipts. */
export default function NoticesPage() {
  const [tab, setTab] = useState<"sent" | "compose" | "templates">("sent");
  const { data, reload } = useApi<{ items: Row[]; sections: Opt[]; classes: Opt[] }>("/api/notices");
  const [form, setForm] = useState<Form>(blank());
  const [open, setOpen] = useState<string | null>(null);
  const [emergency, setEmergency] = useState(false);
  return (
    <Page wide>
      <PageHeader eyebrow="Communication" title="Announcements & circulars"
        subtitle="Tell the whole school, a section, some classes or chosen families, students or staff, on the app, WhatsApp, SMS and email, in each family's language. See who has read it and remind the rest."
        actions={<button className="btn bg-rose-600 text-white hover:bg-rose-700" onClick={() => setEmergency(true)}>Emergency alert</button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "sent", label: "Sent & scheduled" }, { id: "compose", label: form.id ? "Edit draft" : "New" }, { id: "templates", label: "Templates" }]} />
      {!data ? <Loading /> : <>
        {tab === "sent" && <SentList items={data.items} onOpen={setOpen} onEdit={async id => { const r = await send<any>(`/api/notices?id=${id}`, undefined, "GET"); if (r.ok) { const n = r.data.notice;
          setForm({ ...blank(n.kind), id: n.id, title: n.title, body: n.body, scope: n.audience.scope, ids: n.audience.ids ?? [], to_parents: n.to_parents, to_students: n.to_students, to_staff: n.to_staff,
            staff_roles: n.staff_roles, requires_ack: n.requires_ack, channels: n.channels, translate: n.translate }); setTab("compose"); } }} />}
        {tab === "compose" && <Compose form={form} setForm={setForm} sections={data.sections} classes={data.classes} onDone={() => { setForm(blank()); setTab("sent"); reload(); }} />}
        {tab === "templates" && <Templates onUse={t => { setForm({ ...blank(t.kind === "message" ? "announcement" : t.kind), title: t.title ?? "", body: t.body }); setTab("compose"); }} />}
      </>}
      <Modal open={Boolean(open)} onClose={() => { setOpen(null); reload(); }} title="Who has read it" wide>{open && <Detail id={open} />}</Modal>
      <Modal open={emergency} onClose={() => setEmergency(false)} title="Emergency alert" wide>{emergency && data && <Emergency sections={data.sections} classes={data.classes} onDone={() => { setEmergency(false); reload(); }} />}</Modal>
    </Page>
  );
}

function SentList({ items, onOpen, onEdit }: { items: Row[]; onOpen: (id: string) => void; onEdit: (id: string) => void }) {
  if (!items.length) return <Empty>Nothing sent yet.</Empty>;
  const who = (r: Row) => [r.to_parents && "parents", r.to_students && "students", r.to_staff && "staff"].filter(Boolean).join(", ");
  return (
    <div className="card overflow-x-auto"><table className="w-full text-sm">
      <thead className="bg-slate-50 text-left text-[13px] text-slate-500"><tr><th className="p-2">Title</th><th className="p-2">To</th><th className="p-2">Status</th><th className="p-2">Read</th><th className="p-2">Confirmed</th><th className="p-2" /></tr></thead>
      <tbody>{items.map(r => (
        <tr key={r.id} className="border-t border-slate-100">
          <td className="p-2"><Badge tone={r.kind === "emergency" ? "red" : r.kind === "circular" ? "violet" : "blue"}>{KIND[r.kind]}</Badge> <b>{r.title}</b></td>
          <td className="p-2 text-xs">{who(r)} · {r.audience.scope === "school" ? "whole school" : `${r.audience.ids?.length ?? 0} ${r.audience.scope}`}</td>
          <td className="p-2 text-xs">{r.status === "sent" ? `sent ${fmtDate(r.sent_at, true)}` : r.status === "scheduled" ? `for ${fmtDate(r.scheduled_for, true)}` : r.status}</td>
          <td className="p-2">{r.status === "sent" ? `${r.stats.read_pct}% (${r.stats.read}/${r.stats.total})` : "—"}</td>
          <td className="p-2">{r.requires_ack && r.status === "sent" ? `${r.stats.ack_pct}%` : "—"}</td>
          <td className="p-2 text-right text-xs">{r.status === "sent" ? <button className="text-brand-700" onClick={() => onOpen(r.id)}>Details</button>
            : ["draft", "scheduled"].includes(r.status) ? <button className="text-brand-700" onClick={() => onEdit(r.id)}>Edit</button> : null}</td>
        </tr>))}</tbody></table></div>
  );
}

function Audience({ form, setForm, sections, classes }: { form: Form; setForm: (f: Form) => void; sections: Opt[]; classes: Opt[] }) {
  const toggle = (id: string) => setForm({ ...form, ids: form.ids.includes(id) ? form.ids.filter(x => x !== id) : [...form.ids, id] });
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-3">{[["school", "Whole school"], ...(sections.length ? [["sections", "Sections"]] : []), ["classes", "Classes"], ["people", "Chosen people"]].map(([k, l]) => (
        <label key={k} className="flex items-center gap-1"><input type="radio" checked={form.scope === k} onChange={() => setForm({ ...form, scope: k, ids: [] })} />{l}</label>))}</div>
      {form.scope === "sections" && <div className="flex flex-wrap gap-2">{sections.map(s => <label key={s.id} className="flex items-center gap-1"><input type="checkbox" checked={form.ids.includes(s.id)} onChange={() => toggle(s.id)} />{s.name}</label>)}</div>}
      {form.scope === "classes" && <div className="flex max-h-32 flex-wrap gap-x-3 gap-y-1 overflow-y-auto rounded border border-slate-200 p-2">{classes.map(c => <label key={c.id} className="flex items-center gap-1"><input type="checkbox" checked={form.ids.includes(c.id)} onChange={() => toggle(c.id)} />{c.name}</label>)}</div>}
      {form.scope === "people" && <PeoplePicker value={form.people} onChange={people => setForm({ ...form, people })} placeholder="Add students (their families), families or staff by name" />}
      <div className="flex flex-wrap gap-3">
        <label className="flex items-center gap-1"><input type="checkbox" checked={form.to_parents} onChange={e => setForm({ ...form, to_parents: e.target.checked })} />Parents</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={form.to_students} onChange={e => setForm({ ...form, to_students: e.target.checked })} />Students (in the app)</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={form.to_staff} onChange={e => setForm({ ...form, to_staff: e.target.checked })} />Staff</label>
      </div>
      {form.to_staff && form.scope !== "people" && <details><summary className="cursor-pointer text-xs text-brand-700">Only some staff roles{form.staff_roles.length ? ` (${form.staff_roles.length})` : ""}</summary>
        <div className="mt-1 flex flex-wrap gap-2 text-xs">{STAFF_ROLES.map(r => <label key={r} className="flex items-center gap-1"><input type="checkbox" checked={form.staff_roles.includes(r)} onChange={e => setForm({ ...form, staff_roles: e.target.checked ? [...form.staff_roles, r] : form.staff_roles.filter(x => x !== r) })} />{r.replace(/_/g, " ")}</label>)}</div></details>}
    </div>
  );
}

const payload = (f: Form) => ({ id: f.id ?? null, kind: f.kind, title: f.title, body: f.body,
  audience: { scope: f.scope, ids: f.ids, students: f.people.filter(p => p.type === "Student").map(p => p.id), guardians: f.people.filter(p => p.type === "Family").map(p => p.id), staff: f.people.filter(p => p.type === "Staff").map(p => p.id) },
  to_parents: f.to_parents, to_students: f.to_students, to_staff: f.to_staff, staff_roles: f.staff_roles, requires_ack: f.requires_ack, channels: f.channels, translate: f.translate,
  expires_at: f.expires ? new Date(f.expires).toISOString() : null });

function Compose({ form, setForm, sections, classes, onDone }: { form: Form; setForm: (f: Form) => void; sections: Opt[]; classes: Opt[]; onDone: () => void }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async (action: "save" | "send") => {
    setBusy(true);
    const r = await send<any>("/api/notices", { action, ...payload(form), scheduled_for: action === "send" && form.schedule ? new Date(form.schedule).toISOString() : null });
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.error ?? "failed" });
    if (action === "save") setForm({ ...form, id: r.data.id });
    setMsg({ ok: true, text: action === "save" ? "Draft saved." : r.data.scheduled ? "Scheduled." : `Sent to ${r.data.recipients} people (${r.data.messages} messages).${r.data.translated_into?.length ? ` Translated into ${r.data.translated_into.join(", ")}.` : ""}` });
    if (action === "send") setTimeout(onDone, 1500);
  };
  return (
    <div className="grid gap-4 text-sm lg:grid-cols-2">
      <form className="card space-y-3 p-4" onSubmit={e => { e.preventDefault(); void go("send"); }}>
        {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
        <div className="flex gap-3">{["announcement", "circular"].map(k => <label key={k} className="flex items-center gap-1"><input type="radio" checked={form.kind === k} onChange={() => setForm({ ...form, kind: k, requires_ack: k === "circular" || form.requires_ack })} />{KIND[k]}</label>)}</div>
        <Field label="Title"><input className="input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required minLength={2} maxLength={160} /></Field>
        <Field label="Message" hint={`Placeholders: ${Object.keys(PLACEHOLDERS).map(k => `{${k}}`).join(" ")}`}><textarea className="input min-h-40" value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} required minLength={2} maxLength={20000} /></Field>
        <Field label="Who"><Audience form={form} setForm={setForm} sections={sections} classes={classes} /></Field>
        <div className="flex flex-wrap gap-3">{(["push", "email", "whatsapp", "sms"] as const).map(c => (
          <label key={c} className="flex items-center gap-1"><input type="checkbox" checked={form.channels.includes(c)} onChange={e => setForm({ ...form, channels: e.target.checked ? [...form.channels, c] : form.channels.filter(x => x !== c) })} />{c === "push" ? "App" : c === "sms" ? "SMS" : c === "whatsapp" ? "WhatsApp" : "Email"}</label>))}</div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.requires_ack} onChange={e => setForm({ ...form, requires_ack: e.target.checked })} />Ask people to confirm they have read it</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.translate} onChange={e => setForm({ ...form, translate: e.target.checked })} />Translate into each family&apos;s home language</label>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Send later (optional)"><input className="input" type="datetime-local" value={form.schedule} onChange={e => setForm({ ...form, schedule: e.target.value })} /></Field>
          <Field label="Take down from notice boards (optional)"><input className="input" type="datetime-local" value={form.expires} onChange={e => setForm({ ...form, expires: e.target.value })} /></Field>
        </div>
        <div className="flex gap-2"><button className="btn btn-primary" disabled={busy}>{busy ? "Sending…" : form.schedule ? "Schedule" : "Send now"}</button>
          <button type="button" className="btn btn-outline" disabled={busy} onClick={() => go("save")}>Save draft</button></div>
      </form>
      <section className="card space-y-2 p-4"><h2 className="font-semibold">Preview</h2>
        <p className="text-xs text-slate-500">Placeholders are filled in for each family, for example {"{child_names}"} becomes “Ada and Tunde”.</p>
        <h3 className="text-lg font-semibold">{form.title || "Title"}</h3><RichText text={form.body || "Your message"} /></section>
    </div>
  );
}

function Detail({ id }: { id: string }) {
  const { data, reload } = useApi<{ notice: { title: string; requires_ack: boolean; kind: string }; stats: Stats; recipients: { id: string; kind: string; name: string; phone: string | null; about: string; read_at: string | null; acknowledged_at: string | null; delivered_at: string | null }[] }>(`/api/notices?id=${id}`);
  const [filter, setFilter] = useState<"all" | "unread">("unread");
  const [msg, setMsg] = useState<string | null>(null);
  if (!data) return <Loading />;
  const ack = data.notice.requires_ack || data.notice.kind === "emergency";
  const list = data.recipients.filter(r => filter === "all" || !(ack ? r.acknowledged_at : r.read_at));
  return (
    <div className="space-y-3 text-sm">
      <p><b>{data.notice.title}</b>: read by {data.stats.read} of {data.stats.total} ({data.stats.read_pct}%){ack ? `, confirmed by ${data.stats.acknowledged} (${data.stats.ack_pct}%)` : ""}.</p>
      <div className="flex flex-wrap gap-2">
        <select className="input w-auto" value={filter} onChange={e => setFilter(e.target.value as "all" | "unread")} aria-label="Show"><option value="unread">{ack ? "Not confirmed" : "Not read"}</option><option value="all">Everyone</option></select>
        <button className="btn btn-outline" onClick={async () => { const r = await send<any>("/api/notices", { action: "remind", id }); setMsg(r.ok ? `Reminded ${r.data.reminded}.` : r.error); reload(); }}>Remind everyone who has not {ack ? "confirmed" : "read"} it</button>
      </div>
      {msg && <Alert tone="green">{msg}</Alert>}
      <div className="max-h-[50vh] overflow-y-auto"><table className="w-full text-xs"><thead className="text-left text-slate-500"><tr><th className="p-1">Name</th><th className="p-1">About</th><th className="p-1">Read</th>{ack && <th className="p-1">Confirmed</th>}</tr></thead>
        <tbody className="divide-y divide-slate-100">{list.map(r => <tr key={r.id}><td className="p-1">{r.name} <span className="text-slate-400">{r.kind}</span>{r.phone ? <span className="block text-slate-500">{r.phone}</span> : null}</td><td className="p-1">{r.about}</td>
          <td className="p-1">{r.read_at ? fmtDate(r.read_at, true) : r.delivered_at ? "not yet" : "no contact details"}</td>{ack && <td className="p-1">{r.acknowledged_at ? fmtDate(r.acknowledged_at, true) : "—"}</td>}</tr>)}</tbody></table></div>
    </div>
  );
}

function Templates({ onUse }: { onUse: (t: Template) => void }) {
  const { data, reload } = useApi<{ items: Template[]; emergency: { key: string; name: string; title: string; body: string }[] }>("/api/notices?templates=1");
  const [edit, setEdit] = useState<Template | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!data) return <Loading />;
  return (
    <div className="space-y-3 text-sm">
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <div className="flex"><p className="mr-auto text-slate-600">Wording you use often, with placeholders filled in for each family.</p><button className="btn btn-outline" onClick={() => setEdit({ name: "", kind: "announcement", title: "", body: "" })}>+ New template</button></div>
      {!data.items.length ? <Empty>No templates yet.</Empty> : <ul className="grid gap-2 sm:grid-cols-2">{data.items.map(t => (
        <li key={t.id} className="card p-3"><div className="flex items-center gap-2"><b className="mr-auto">{t.name}</b><Badge tone="slate">{t.kind}</Badge></div>
          <p className="line-clamp-2 text-xs text-slate-600">{t.body}</p>
          <div className="mt-1 flex gap-3 text-xs"><button className="text-brand-700" onClick={() => onUse(t)}>Use</button><button className="text-brand-700" onClick={() => setEdit(t)}>Edit</button>
            <button className="text-rose-600" onClick={async () => { if (!confirm("Delete this template?")) return; const r = await send("/api/notices", { action: "delete_template", id: t.id }); if (r.ok) reload(); }}>Delete</button></div></li>))}</ul>}
      {edit && (
        <form className="card grid gap-2 p-4 sm:grid-cols-3" onSubmit={async e => { e.preventDefault(); const r = await send("/api/notices", { action: "save_template", ...edit, title: edit.title || null });
          setMsg({ ok: r.ok, text: r.ok ? "Template saved." : r.error ?? "failed" }); if (r.ok) { setEdit(null); reload(); } }}>
          <Field label="Name"><input className="input" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} required minLength={2} maxLength={80} /></Field>
          <Field label="For"><select className="input" value={edit.kind} onChange={e => setEdit({ ...edit, kind: e.target.value })}><option value="announcement">Announcements</option><option value="circular">Circulars</option><option value="emergency">Emergencies</option><option value="message">Messages to parents</option></select></Field>
          <Field label="Title"><input className="input" value={edit.title ?? ""} onChange={e => setEdit({ ...edit, title: e.target.value })} maxLength={160} /></Field>
          <div className="sm:col-span-3"><Field label="Wording"><textarea className="input min-h-28" value={edit.body} onChange={e => setEdit({ ...edit, body: e.target.value })} required minLength={2} maxLength={10000} /></Field></div>
          <div className="flex gap-2"><button className="btn btn-primary">Save</button><button type="button" className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button></div>
        </form>
      )}
    </div>
  );
}

function Emergency({ sections, classes, onDone }: { sections: Opt[]; classes: Opt[]; onDone: () => void }) {
  const { data } = useApi<{ emergency: { key: string; name: string; title: string; body: string }[]; items: Template[] }>("/api/notices?templates=1");
  const [form, setForm] = useState<Form>(blank("emergency"));
  const [confirmText, setConfirmText] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data?.emergency[0] && !form.title) setForm(f => ({ ...f, title: data.emergency[0].title, body: data.emergency[0].body })); }, [data, form.title]);
  const options = [...(data?.emergency ?? []), ...(data?.items ?? []).filter(t => t.kind === "emergency").map(t => ({ key: t.id!, name: t.name, title: t.title ?? t.name, body: t.body }))];
  return (
    <form className="space-y-3 text-sm" onSubmit={async e => {
      e.preventDefault();
      setBusy(true);
      const r = await send<any>("/api/notices", { action: "send", ...payload(form), confirm: confirmText });
      setBusy(false);
      setResult({ ok: r.ok, text: r.ok ? `Sent to ${r.data.recipients} people by app, SMS, WhatsApp and email. Track confirmations under Sent.` : r.error ?? "failed" });
      if (r.ok) setTimeout(onDone, 2500);
    }}>
      <Alert tone="red">Goes to everyone you choose straight away, on every channel including SMS, and stays on their screens until they confirm. Use it for closures, lockdowns and safety notices.</Alert>
      <div className="flex flex-wrap gap-2">{options.map(o => <button type="button" key={o.key} className="btn btn-outline px-2 py-1 text-xs" onClick={() => setForm({ ...form, title: o.title, body: o.body })}>{o.name}</button>)}</div>
      <Field label="Title"><input className="input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required minLength={2} maxLength={160} /></Field>
      <Field label="Message" hint="Replace anything in [brackets]."><textarea className="input min-h-28" value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} required minLength={2} /></Field>
      <Field label="Who"><Audience form={form} setForm={setForm} sections={sections} classes={classes} /></Field>
      <Field label="Type SEND to confirm"><input className="input w-40" value={confirmText} onChange={e => setConfirmText(e.target.value)} aria-label="Type SEND to confirm" /></Field>
      {result && <Alert tone={result.ok ? "green" : "red"}>{result.text}</Alert>}
      <button className="btn w-full bg-rose-600 text-white hover:bg-rose-700" disabled={busy || confirmText !== "SEND" || /\[[^\]]+\]/.test(form.body)}>{busy ? "Sending…" : "Send emergency alert now"}</button>
      {/\[[^\]]+\]/.test(form.body) && <p className="text-xs text-rose-700">Fill in the parts in [brackets] first.</p>}
    </form>
  );
}
