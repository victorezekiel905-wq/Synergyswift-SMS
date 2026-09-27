"use client";
import { useState } from "react";
import { useApi, send, Alert, Badge, Empty, fmtDate, fmtTime, Loading } from "@/components/ui";
import FamilyTabs, { type Extras } from "./FamilyTabs";
import { NotificationsToggle, LanguagePicker } from "./FamilyConnect";

type Overview = {
  guardian: { id: string; full_name: string; notify_email: boolean; notify_whatsapp: boolean; email: string | null; phone: string | null; language?: string | null };
  school: { school_name: string | null; logo_url: string | null; brand_color: string | null; phone: string | null } | null;
  extras?: Extras;
  children: {
    id: string; name: string; admission_no: string; photo_url: string | null; class_name: string | null; class_group_id?: string | null; can_pickup: boolean; on_site: boolean;
    today: { direction: string; at: string; method: string; late: boolean; note: string | null }[];
    recent_events: { direction: string; at: string; method: string; late: boolean }[];
    results: { id: string; term: string; average: number | null; position: number | null; class_size: number | null; access_token: string; published_at: string }[];
    pickup_codes: { id: string; delegate_name: string | null; expires_at: string }[];
    loans: { title: string; due_at: string }[];
  }[];
};

/**
 * Parent view. `api` is either /api/parent/overview (logged-in parent) or
 * /api/g/<token> (passwordless link); `act` is where actions are POSTed.
 */
export default function GuardianPortal({ api, act, mode, token }: { api: string; act: (body: Record<string, unknown>) => Promise<{ ok: boolean; data: any; error: string | null }>; mode: "token" | "session"; token?: string }) {
  const { data, error, reload } = useApi<Overview>(api);
  const [code, setCode] = useState<{ student: string; code: string; expires: string; collector: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [delegate, setDelegate] = useState<Record<string, { name: string; phone: string }>>({});

  if (error) return <div className="mx-auto max-w-2xl p-6"><Alert>{error}</Alert></div>;
  if (!data) return <Loading />;
  const color = data.school?.brand_color ?? "#1d5ddb";

  async function generate(studentId: string) {
    const d = delegate[studentId] ?? { name: "", phone: "" };
    setMsg(null);
    const r = await act({ action: mode === "token" ? "pickup" : "generate", student_id: studentId, delegate_name: d.name || null, delegate_phone: d.phone || null });
    if (!r.ok) { setMsg({ ok: false, text: r.error ?? "failed" }); return; }
    setCode({ student: r.data.student_name, code: r.data.code, expires: r.data.expires_at, collector: r.data.collector });
    reload();
  }
  async function revoke(id: string) {
    const r = await act({ action: "revoke", pickup_id: id });
    setMsg({ ok: r.ok, text: r.ok ? "Code cancelled." : r.error ?? "failed" });
    reload();
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-5 flex items-center gap-3 rounded-xl p-4 text-white" style={{ background: color }}>
        {data.school?.logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.school.logo_url} alt="" className="h-12 w-12 rounded bg-white object-contain p-1" />
        )}
        <div>
          <p className="text-lg font-bold">{data.school?.school_name ?? "School"}</p>
          <p className="text-sm opacity-90">Welcome, {data.guardian.full_name}</p>
        </div>
      </header>
      {msg && <div className="mb-4"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      {code && (
        <div className="mb-5 rounded-xl border-2 border-emerald-500 bg-emerald-50 p-5 text-center" role="status">
          <p className="text-sm">Pickup code for <b>{code.student}</b></p>
          <p className="my-2 font-mono text-5xl font-black tracking-[0.3em]">{code.code}</p>
          <p className="text-sm">Collector: {code.collector} · valid until {fmtTime(code.expires)}</p>
          <p className="mt-1 text-xs text-slate-600">We also sent it to your WhatsApp and email. Share it only with the person collecting your child.</p>
          <button className="btn btn-ghost mt-2 text-xs" onClick={() => setCode(null)}>Hide</button>
        </div>
      )}
      {!data.children.length && <Empty>No children are linked to you yet. Please contact the school.</Empty>}
      <div className="space-y-5">
        {data.children.map(c => (
          <section key={c.id} className="card overflow-hidden">
            <div className="flex items-center gap-3 border-b border-slate-100 p-4">
              {c.photo_url
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={c.photo_url} alt="" className="h-14 w-14 rounded-full object-cover" />
                : <div className="grid h-14 w-14 place-items-center rounded-full bg-slate-100 text-xl font-bold text-slate-500">{c.name[0]}</div>}
              <div className="flex-1">
                <p className="text-lg font-semibold">{c.name}</p>
                <p className="text-sm text-slate-500">{c.class_name ?? ""} · {c.admission_no}</p>
              </div>
              <Badge tone={c.on_site ? "green" : "slate"}>{c.on_site ? "In school now" : "Not in school"}</Badge>
            </div>
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-semibold">Today</h3>
                {!c.today.length ? <p className="text-sm text-slate-500">No sign-in yet today.</p> : (
                  <ul className="space-y-1 text-sm">
                    {c.today.map((e, i) => <li key={i} className="flex justify-between"><span>Signed <b>{e.direction}</b>{e.late ? " (late)" : ""}{e.note ? ` · ${e.note}` : ""}</span><span className="tabular-nums text-slate-500">{fmtTime(e.at)}</span></li>)}
                  </ul>
                )}
                <h3 className="mb-2 mt-4 text-sm font-semibold">Results</h3>
                {!c.results.length ? <p className="text-sm text-slate-500">No published results yet.</p> : (
                  <ul className="space-y-2 text-sm">
                    {c.results.map(r => (
                      <li key={r.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-2">
                        <span>{r.term}<br /><span className="text-xs text-slate-500">Average {r.average ?? "—"}%{r.position ? ` · position ${r.position}/${r.class_size}` : ""}</span></span>
                        <a className="btn btn-primary px-3 py-1 text-xs" href={`/r/${r.access_token}`} target="_blank" rel="noreferrer">Report card</a>
                      </li>
                    ))}
                  </ul>
                )}
                {c.loans.length > 0 && <>
                  <h3 className="mb-2 mt-4 text-sm font-semibold">Library books</h3>
                  <ul className="text-sm">{c.loans.map((l, i) => <li key={i} className={new Date(l.due_at) < new Date() ? "text-rose-600" : ""}>{l.title}: due {fmtDate(l.due_at)}</li>)}</ul>
                </>}
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold">Pickup code</h3>
                {!c.can_pickup ? <p className="text-sm text-slate-500">The school has not authorised you to collect {c.name.split(" ")[0]}. Contact the school.</p> : (
                  <div className="space-y-2">
                    <input className="input" placeholder="Someone else collecting? Their name" value={delegate[c.id]?.name ?? ""}
                      onChange={e => setDelegate({ ...delegate, [c.id]: { ...(delegate[c.id] ?? { phone: "" }), name: e.target.value } })} aria-label="Collector name" />
                    <input className="input" placeholder="Their WhatsApp number (optional)" value={delegate[c.id]?.phone ?? ""}
                      onChange={e => setDelegate({ ...delegate, [c.id]: { ...(delegate[c.id] ?? { name: "" }), phone: e.target.value } })} aria-label="Collector phone" />
                    <button className="btn btn-primary w-full" onClick={() => generate(c.id)}>Generate pickup code</button>
                    {c.pickup_codes.map(p => (
                      <div key={p.id} className="flex items-center justify-between rounded border border-slate-200 p-2 text-xs">
                        <span>Active code{p.delegate_name ? ` for ${p.delegate_name}` : ""}, until {fmtTime(p.expires_at)}</span>
                        <button className="text-rose-600 hover:underline" onClick={() => revoke(p.id)}>Cancel</button>
                      </div>
                    ))}
                  </div>
                )}
                <h3 className="mb-2 mt-4 text-sm font-semibold">Recent sign-ins</h3>
                <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs text-slate-600">
                  {c.recent_events.map((e, i) => <li key={i}>{fmtDate(e.at)} {fmtTime(e.at)}: {e.direction}{e.late ? " (late)" : ""}</li>)}
                </ul>
              </div>
            </div>
          </section>
        ))}
      </div>
      {data.extras && data.children.length > 0 && <FamilyTabs extras={data.extras} kids={data.children} token={token} onChange={reload} />}
      <section className="card mt-5 space-y-3 p-4 text-sm">
        <h3 className="font-semibold">Notifications and language</h3>
        <NotificationsToggle token={token} />
        <LanguagePicker token={token} value={data.guardian.language ?? null} />
      </section>
      {mode === "token" && (
        <section className="card mt-5 p-4 text-sm">
          <h3 className="mb-2 font-semibold">How we contact you</h3>
          <label className="mr-4 inline-flex items-center gap-2"><input type="checkbox" defaultChecked={data.guardian.notify_whatsapp}
            onChange={async e => { await act({ action: "prefs", notify_whatsapp: e.target.checked, notify_email: data.guardian.notify_email }); reload(); }} /> WhatsApp</label>
          <label className="inline-flex items-center gap-2"><input type="checkbox" defaultChecked={data.guardian.notify_email}
            onChange={async e => { await act({ action: "prefs", notify_email: e.target.checked, notify_whatsapp: data.guardian.notify_whatsapp }); reload(); }} /> Email</label>
          <p className="mt-2 text-xs text-slate-500">This link is private to you. Do not forward it. If it leaks, ask the school for a new one.</p>
        </section>
      )}
    </div>
  );
}

export async function postTo(url: string, body: Record<string, unknown>) {
  return send(url, body);
}
