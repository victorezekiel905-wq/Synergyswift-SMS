"use client";
import { useState } from "react";
import { useApi, send, Page, PageHeader, Alert, Empty, Field, fmtTime } from "@/components/ui";

type Visitor = { id: string; full_name: string; phone: string | null; organisation: string | null; purpose: string; host_name: string | null; badge_no: string | null; signed_in_at: string; signed_out_at: string | null };

export default function VisitorsPage() {
  const [day, setDay] = useState("");
  const { data, error, reload } = useApi<{ on_site: Visitor[]; log: Visitor[] }>(`/api/visitors${day ? `?date=${day}` : ""}`, [day]);
  const blank = { full_name: "", phone: "", organisation: "", purpose: "", host_name: "", badge_no: "", id_type: "", id_number: "", vehicle: "" };
  const [f, setF] = useState(blank);
  const [err, setErr] = useState<string | null>(null);
  const bind = (k: keyof typeof blank) => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value }) });
  return (
    <Page wide>
      <PageHeader eyebrow="Security" title="Visitors" subtitle="Know exactly who is on the school grounds. Sign visitors in with a badge, and out when they leave." />
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-5 xl:grid-cols-3">
        <form className="card h-fit space-y-2 p-5" onSubmit={async e => {
          e.preventDefault();
          const r = await send("/api/visitors", { action: "sign_in", ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v || null])), full_name: f.full_name, purpose: f.purpose });
          if (!r.ok) return setErr(r.error);
          setErr(null); setF(blank); reload();
        }}>
          <h2 className="font-semibold">Sign a visitor in</h2>
          <Field label="Full name"><input className="input" required {...bind("full_name")} /></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="Phone"><input className="input" {...bind("phone")} /></Field><Field label="Organisation"><input className="input" {...bind("organisation")} /></Field></div>
          <Field label="Purpose of visit"><input className="input" required {...bind("purpose")} /></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="Visiting"><input className="input" {...bind("host_name")} /></Field><Field label="Badge no."><input className="input" {...bind("badge_no")} /></Field></div>
          <div className="grid grid-cols-3 gap-2"><Field label="ID type"><input className="input" {...bind("id_type")} /></Field><Field label="ID number"><input className="input" {...bind("id_number")} /></Field><Field label="Vehicle"><input className="input" {...bind("vehicle")} /></Field></div>
          {err && <Alert>{err}</Alert>}
          <button className="btn btn-primary w-full">Sign in</button>
        </form>
        <div className="space-y-5 xl:col-span-2">
          <section className="card p-5">
            <h2 className="mb-2 font-semibold">On site now ({data?.on_site.length ?? 0})</h2>
            {!data?.on_site.length ? <p className="text-sm text-slate-500">No visitors on site.</p> : (
              <ul className="divide-y divide-slate-100 text-sm">{data.on_site.map(v => (
                <li key={v.id} className="flex items-center justify-between py-2"><span><b>{v.full_name}</b> {v.badge_no ? `(badge ${v.badge_no})` : ""}<span className="block text-xs text-slate-500">{v.purpose}{v.host_name ? ` · visiting ${v.host_name}` : ""} · since {fmtTime(v.signed_in_at)}</span></span>
                  <button className="btn btn-primary px-3 py-1 text-xs" onClick={async () => { await send("/api/visitors", { action: "sign_out", id: v.id }); reload(); }}>Sign out</button></li>))}</ul>
            )}
          </section>
          <section className="card p-5">
            <div className="mb-2 flex items-center gap-2"><h2 className="mr-auto font-semibold">Log</h2><input className="input w-auto" type="date" value={day} onChange={e => setDay(e.target.value)} aria-label="Date" /><a className="btn btn-ghost text-xs" href={`/api/visitors?format=csv${day ? `&date=${day}` : ""}`}>CSV</a></div>
            {!data?.log.length ? <Empty>No visitors.</Empty> : (
              <div className="overflow-x-auto print:overflow-visible"><table className="w-full text-sm"><tbody>{data.log.map(v => <tr key={v.id} className="border-t border-slate-100"><td className="py-1.5">{v.full_name}<div className="text-xs text-slate-400">{v.organisation}</div></td><td>{v.purpose}</td>
                <td className="text-xs tabular-nums">{fmtTime(v.signed_in_at)}–{v.signed_out_at ? fmtTime(v.signed_out_at) : "on site"}</td></tr>)}</tbody></table></div>
            )}
          </section>
        </div>
      </div>
    </Page>
  );
}
