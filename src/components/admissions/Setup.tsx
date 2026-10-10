"use client";
import { useState } from "react";
import { useApi, send, Alert, Field, Loading, money, fmtDate } from "@/components/ui";
import { SOURCES, SOURCE_LABEL } from "@/lib/crm";

type Tpl = { kind: "offer" | "waitlist" | "regret"; subject: string; body: string; updated_at: string | null };
type Data = {
  templates: Record<Tpl["kind"], Tpl>; capacity: { level: string; intake: string; seats: number }[]; levels: string[];
  costs: { id: string; month: string; source: string; campaign: string | null; amount: number; note: string | null }[];
  settings: { acceptance_fee: number; offer_valid_days: number; admissions_whatsapp: string; currency: string };
  links: { enquiry: string; apply: string; visit: string; embed: string; whatsapp: string | null; campaign_example: string } | null;
  webhook: { url: string | null } | null; is_admin: boolean;
};

/** Capture links and embed code, lead webhook, letters, seats per level, marketing spend. */
export default function Setup() {
  const { data, error, reload } = useApi<Data>("/api/crm/setup");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const act = async (body: Record<string, unknown>, ok: string) => { const r = await send("/api/crm/setup", body); setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" }); if (r.ok) reload(); return r.ok; };
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const copy = (t: string) => { navigator.clipboard?.writeText(t); setMsg({ ok: true, text: "Copied." }); };
  return (
    <div className="space-y-5 text-sm">
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <section className="card space-y-2 p-4">
        <h3 className="font-semibold">Capture enquiries</h3>
        {!data.links ? <p className="text-slate-600">Set your school&apos;s web address first (Applications → Application form settings).</p> : (<>
          {[["Enquiry form (website, social media bio, flyers)", data.links.enquiry], ["Book a tour or open day", data.links.visit], ["Online application", data.links.apply],
            ["Facebook / Instagram ad link (change the campaign name)", data.links.campaign_example], ...(data.links.whatsapp ? [["WhatsApp click-to-chat", data.links.whatsapp]] : [])].map(([label, url]) => (
            <div key={label} className="flex flex-wrap items-center gap-2"><span className="w-80 text-slate-600">{label}</span><code className="flex-1 truncate rounded bg-slate-50 px-2 py-1 text-xs">{url}</code><button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => copy(url)}>Copy</button></div>
          ))}
          <div><p className="text-slate-600">Embed the enquiry form on your website:</p><div className="flex gap-2"><code className="flex-1 truncate rounded bg-slate-50 px-2 py-1 text-xs">{data.links.embed}</code><button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => copy(data.links!.embed)}>Copy</button></div></div>
          <p className="text-xs text-slate-500">Parents get their own referral link (…?ref=CODE) in the parent portal; referred families are tagged and credited to them. Links with utm_source / utm_campaign are tracked as their channel and campaign.</p>
        </>)}
        {data.webhook && (
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="font-medium">Lead webhook (Facebook / Instagram lead ads via Zapier or Make, website builders, chat widgets)</p>
            {data.webhook.url ? <div className="mt-1 flex gap-2"><code className="flex-1 truncate text-xs">{data.webhook.url}</code><button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => copy(data.webhook!.url!)}>Copy</button>
              <button className="btn btn-ghost px-2 py-1 text-xs text-rose-600" onClick={() => act({ action: "webhook_key", enabled: false }, "Webhook turned off.")}>Turn off</button></div>
              : <button className="btn btn-outline mt-1 text-xs" onClick={() => act({ action: "webhook_key", enabled: true }, "Webhook created.")}>Create webhook address</button>}
            <p className="mt-1 text-xs text-slate-500">POST JSON with name, phone and/or email, and optionally child_name, class, source (facebook, instagram…), utm_campaign. Meta lead-ad field_data is understood. Anyone with the address can add leads, so keep it private; turning it off and on makes a new one.</p>
          </div>
        )}
      </section>

      {data.is_admin && <OfferSettings s={data.settings} onSave={b => act({ action: "settings", ...b }, "Saved.")} />}

      <section className="card space-y-3 p-4">
        <h3 className="font-semibold">Letters</h3>
        <p className="text-xs text-slate-500">Fields: {"{parent} {child} {level} {school} {application_no} {principal} {fee} {fee_line} {expires}"}. The offer letter is shown online for the family to sign.</p>
        {(["offer", "waitlist", "regret"] as const).map(k => <TemplateForm key={k} tpl={data.templates[k]} onSave={b => act({ action: "template", kind: k, ...b }, "Letter saved.")} />)}
      </section>

      <section className="card space-y-2 p-4">
        <h3 className="font-semibold">Places per class level</h3>
        <p className="text-xs text-slate-500">When a level is full, offers warn you and families go on the waiting list.</p>
        <ul className="space-y-1">{data.capacity.map(c => <li key={c.level + c.intake} className="flex items-center gap-2"><span className="w-32">{c.level}</span><span>{c.seats} places</span>
          <button className="text-xs text-rose-600 hover:underline" onClick={() => act({ action: "capacity_delete", level: c.level, intake: c.intake }, "Removed.")}>remove</button></li>)}</ul>
        <CapacityForm levels={data.levels} onSave={b => act({ action: "capacity", ...b }, "Saved.")} />
      </section>

      <section className="card space-y-2 p-4">
        <h3 className="font-semibold">Marketing spend</h3>
        <CostForm onSave={b => act({ action: "cost", ...b }, "Added.")} />
        <ul className="divide-y divide-slate-100">{data.costs.map(c => <li key={c.id} className="flex flex-wrap gap-2 py-1"><span className="w-24">{fmtDate(c.month).replace(/^\d+ /, "")}</span><span className="w-28">{SOURCE_LABEL[c.source as keyof typeof SOURCE_LABEL] ?? c.source}</span>
          <span className="flex-1 text-slate-500">{c.campaign ?? ""}{c.note ? ` · ${c.note}` : ""}</span><span className="tabular-nums">{money(c.amount, data.settings.currency)}</span>
          <button className="text-xs text-rose-600 hover:underline" onClick={() => act({ action: "cost_delete", id: c.id }, "Removed.")}>remove</button></li>)}</ul>
      </section>
    </div>
  );
}

function OfferSettings({ s, onSave }: { s: Data["settings"]; onSave: (b: Record<string, unknown>) => void }) {
  const [f, setF] = useState({ acceptance_fee: String(s.acceptance_fee), offer_valid_days: String(s.offer_valid_days), admissions_whatsapp: s.admissions_whatsapp });
  return (
    <form className="card grid gap-3 p-4 sm:grid-cols-4" onSubmit={e => { e.preventDefault(); onSave({ acceptance_fee: Number(f.acceptance_fee || 0), offer_valid_days: Number(f.offer_valid_days || 14), admissions_whatsapp: f.admissions_whatsapp || null }); }}>
      <h3 className="font-semibold sm:col-span-4">Offers and WhatsApp</h3>
      <Field label={`Default acceptance fee (${s.currency})`}><input className="input" type="number" min={0} value={f.acceptance_fee} onChange={e => setF({ ...f, acceptance_fee: e.target.value })} /></Field>
      <Field label="Offer valid for (days)"><input className="input" type="number" min={1} max={180} value={f.offer_valid_days} onChange={e => setF({ ...f, offer_valid_days: e.target.value })} /></Field>
      <Field label="Admissions WhatsApp number" hint="For the click-to-chat link, e.g. +2348031234567"><input className="input" value={f.admissions_whatsapp} onChange={e => setF({ ...f, admissions_whatsapp: e.target.value })} /></Field>
      <div className="flex items-end"><button className="btn btn-primary">Save</button></div>
    </form>
  );
}

function TemplateForm({ tpl, onSave }: { tpl: Tpl; onSave: (b: { subject: string; body: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ subject: tpl.subject, body: tpl.body });
  const label = { offer: "Offer letter", waitlist: "Waiting-list letter", regret: "Regret letter" }[tpl.kind];
  if (!open) return <button className="btn btn-ghost justify-start" onClick={() => setOpen(true)}>{label}{tpl.updated_at ? "" : " (default wording)"} ›</button>;
  return (
    <form className="space-y-2 rounded-lg border border-slate-200 p-3" onSubmit={e => { e.preventDefault(); onSave(f); setOpen(false); }}>
      <p className="font-medium">{label}</p>
      <Field label="Subject"><input className="input" value={f.subject} onChange={e => setF({ ...f, subject: e.target.value })} /></Field>
      <Field label="Letter"><textarea className="input h-56 font-serif" value={f.body} onChange={e => setF({ ...f, body: e.target.value })} /></Field>
      <div className="flex justify-end gap-2"><button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary">Save</button></div>
    </form>
  );
}

function CapacityForm({ levels, onSave }: { levels: string[]; onSave: (b: Record<string, unknown>) => void }) {
  const [f, setF] = useState({ level: levels[0] ?? "", seats: "" });
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); onSave({ level: f.level, seats: Number(f.seats) }); setF({ ...f, seats: "" }); }}>
      <Field label="Level">{levels.length ? <select className="input" value={f.level} onChange={e => setF({ ...f, level: e.target.value })}>{levels.map(l => <option key={l}>{l}</option>)}</select> : <input className="input" required value={f.level} onChange={e => setF({ ...f, level: e.target.value })} />}</Field>
      <Field label="Places"><input className="input w-24" type="number" min={0} required value={f.seats} onChange={e => setF({ ...f, seats: e.target.value })} /></Field>
      <button className="btn btn-outline">Save</button>
    </form>
  );
}

function CostForm({ onSave }: { onSave: (b: Record<string, unknown>) => void }) {
  const [f, setF] = useState({ month: new Date().toISOString().slice(0, 7), source: "facebook", campaign: "", amount: "", note: "" });
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); onSave({ month: f.month, source: f.source, campaign: f.campaign || null, amount: Number(f.amount), note: f.note || null }); setF({ ...f, amount: "", note: "" }); }}>
      <Field label="Month"><input className="input" type="month" required value={f.month} onChange={e => setF({ ...f, month: e.target.value })} /></Field>
      <Field label="Channel"><select className="input" value={f.source} onChange={e => setF({ ...f, source: e.target.value })}>{SOURCES.map(s => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}</select></Field>
      <Field label="Campaign (optional)"><input className="input" value={f.campaign} onChange={e => setF({ ...f, campaign: e.target.value })} placeholder="september-intake" /></Field>
      <Field label="Amount"><input className="input w-32" type="number" min={0} required value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} /></Field>
      <Field label="Note"><input className="input" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field>
      <button className="btn btn-outline">Add</button>
    </form>
  );
}
