"use client";
import { useEffect, useState } from "react";
import { useApi, send } from "@/components/ui";

type Data = {
  groups: { id: string; label: string; hint: string; canMute: boolean }[];
  prefs: { muted: string[]; quiet_from: string | null; quiet_to: string | null };
};

/** Which messages to get, and quiet hours when app, WhatsApp and SMS messages wait until morning. */
export default function NotificationChoices({ token }: { token?: string }) {
  const { data } = useApi<Data>(`/api/notify-prefs${token ? `?token=${encodeURIComponent(token)}` : ""}`);
  const [muted, setMuted] = useState<string[]>([]);
  const [quiet, setQuiet] = useState(false);
  const [from, setFrom] = useState("21:00");
  const [to, setTo] = useState("06:30");
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!data) return;
    setMuted(data.prefs.muted);
    setQuiet(Boolean(data.prefs.quiet_from));
    if (data.prefs.quiet_from) setFrom(data.prefs.quiet_from);
    if (data.prefs.quiet_to) setTo(data.prefs.quiet_to);
  }, [data]);
  if (!data) return null;

  async function save() {
    const r = await send("/api/notify-prefs", { token, muted, quiet_from: quiet ? from : null, quiet_to: quiet ? to : null }, "PUT");
    setMsg(r.ok ? "Saved." : r.error);
  }
  return (
    <div className="space-y-3 text-sm">
      <fieldset>
        <legend className="mb-1 font-medium">Send me</legend>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {data.groups.map(g => (
            <label key={g.id} className={`flex items-start gap-2 rounded-lg border border-slate-200 p-2 ${g.canMute ? "" : "bg-slate-50"}`}>
              <input type="checkbox" className="mt-0.5" disabled={!g.canMute} checked={!muted.includes(g.id)}
                onChange={e => setMuted(e.target.checked ? muted.filter(m => m !== g.id) : [...muted, g.id])} />
              <span><b>{g.label}</b>{!g.canMute && <span className="text-xs text-slate-500"> (always on)</span>}<br /><span className="text-xs text-slate-500">{g.hint}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2"><input type="checkbox" checked={quiet} onChange={e => setQuiet(e.target.checked)} /> Quiet hours from</label>
        <input type="time" className="input w-28" value={from} disabled={!quiet} onChange={e => setFrom(e.target.value)} aria-label="Quiet hours start" />
        <span>to</span>
        <input type="time" className="input w-28" value={to} disabled={!quiet} onChange={e => setTo(e.target.value)} aria-label="Quiet hours end" />
      </div>
      <p className="text-xs text-slate-500">During quiet hours, app, WhatsApp and SMS messages wait until the end of the quiet period. Email still arrives, and safety alerts always come at once.</p>
      <div className="flex items-center gap-3"><button className="btn btn-primary px-3 py-1.5 text-xs" onClick={save}>Save choices</button>{msg && <span className="text-xs">{msg}</span>}</div>
    </div>
  );
}
