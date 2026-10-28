"use client";
import { useState } from "react";
import { useApi, send, Alert } from "@/components/ui";

type Data = { on: boolean; ready: boolean; runs: { week_key: string; finished_at: string | null; families: number; messages: number }[] };

/** Admins: the Friday report to parents (14q). Shows nothing to other staff. */
export default function WeeklyReportCard() {
  const { data, reload } = useApi<Data>("/api/school/weekly-report");
  const [preview, setPreview] = useState<{ subject: string; text: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!data) return null;
  return (
    <section className="card mb-5 p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="font-semibold">Weekly report to parents</h2>
          <p className="text-slate-600">Every Friday afternoon each family gets one short message: points earned and for what, attendance, homework handed in, and new class story posts, with something to praise at home. Sent on the channels each parent chose; parents can mute it.</p>
        </div>
        <label className="flex items-center gap-2 font-medium">
          <input type="checkbox" checked={data.on} disabled={!data.ready} onChange={async e => {
            const on = e.target.checked;
            const r = await send("/api/school/weekly-report", { action: "set", on });
            setMsg({ ok: r.ok, text: r.ok ? (on ? "The weekly report is on." : "The weekly report is off.") : r.error ?? "failed" }); reload();
          }} />Send it
        </label>
      </div>
      {!data.ready && <div className="mt-3"><Alert tone="amber">The weekly report needs the database update (migration 20260101008100).</Alert></div>}
      {msg && <div className="mt-3"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button className="btn btn-outline" onClick={async () => {
          const r = await send<{ subject: string; text: string }>("/api/school/weekly-report", { action: "preview" });
          if (!r.ok) { setPreview(null); return setMsg({ ok: false, text: r.error ?? "failed" }); }
          setMsg(null); setPreview(r.data);
        }}>Preview this week</button>
        {data.runs.length > 0 && <span className="text-xs text-slate-500">Last sent: {data.runs.slice(0, 3).map(r => `${r.week_key} (${r.families} families)`).join(" · ")}</span>}
      </div>
      {preview && <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 font-sans text-[13px] text-slate-700"><b>{preview.subject}</b>{"\n\n"}{preview.text}</pre>}
    </section>
  );
}
