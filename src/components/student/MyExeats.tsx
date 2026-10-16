"use client";
import { useState } from "react";
import { useApi, send, Badge, fmtDate } from "@/components/ui";

const STATUS: Record<string, string> = { awaiting_parent: "waiting for your parent", pending: "with the house", approved: "agreed", rejected: "not agreed", out: "signed out", returned: "back", cancelled: "cancelled" };

/** Boarders ask for an exeat; their parents agree first, then the boarding house. */
export default function MyExeats() {
  const { data, reload } = useApi<{ boarder: boolean; exeats: { id: string; kind: string; reason: string; leave_at: string; return_by: string; status: string; decision_note: string | null }[] }>("/api/student/exeat");
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ kind: "weekend", reason: "", leave: "", ret: "", collector_name: "" });
  const [msg, setMsg] = useState<string | null>(null);
  if (!data?.boarder) return null;
  return (
    <section className="card mb-6 space-y-2 p-4 text-sm">
      <div className="flex items-center"><h2 className="mr-auto font-semibold">Exeats</h2><button className="btn btn-outline px-2 py-1 text-xs" onClick={() => setOpen(!open)}>{open ? "Close" : "Ask for an exeat"}</button></div>
      {msg && <p className="text-emerald-700">{msg}</p>}
      {open && <form className="grid gap-2 sm:grid-cols-2" onSubmit={async e => {
        e.preventDefault();
        const r = await send("/api/student/exeat", { kind: f.kind, reason: f.reason, leave_at: new Date(f.leave).toISOString(), return_by: new Date(f.ret).toISOString(), collector_name: f.collector_name || null });
        setMsg(r.ok ? "Sent. Your parent will be asked to agree, then the boarding house." : r.error);
        if (r.ok) { setOpen(false); reload(); }
      }}>
        <select className="input" value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })} aria-label="Kind"><option value="weekend">Weekend</option><option value="day">Day out</option><option value="medical">Medical appointment</option><option value="family">Family event</option><option value="other">Other</option></select>
        <input className="input" required minLength={3} placeholder="Why" value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} aria-label="Reason" />
        <label className="block"><span className="label">Leaving</span><input className="input" type="datetime-local" required value={f.leave} onChange={e => setF({ ...f, leave: e.target.value })} /></label>
        <label className="block"><span className="label">Back by</span><input className="input" type="datetime-local" required value={f.ret} onChange={e => setF({ ...f, ret: e.target.value })} /></label>
        <input className="input sm:col-span-2" placeholder="Who is collecting you" value={f.collector_name} onChange={e => setF({ ...f, collector_name: e.target.value })} aria-label="Collector" />
        <button className="btn btn-primary sm:col-span-2">Send</button>
      </form>}
      {data.exeats.length > 0 && <ul className="space-y-1">{data.exeats.map(e => <li key={e.id}>{fmtDate(e.leave_at, true)} → {fmtDate(e.return_by, true)} · {e.reason} <Badge tone={["approved", "returned"].includes(e.status) ? "green" : e.status === "rejected" ? "red" : "amber"}>{STATUS[e.status] ?? e.status}</Badge>{e.decision_note ? ` ${e.decision_note}` : ""}</li>)}</ul>}
    </section>
  );
}
