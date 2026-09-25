"use client";
import { useState } from "react";
import Link from "next/link";
import { useApi, send, Page, PageHeader, Alert, Badge, Stat, Empty, rolesOf, type Me, fmtTime } from "@/components/ui";
import GateScanner from "@/components/gate/GateScanner";

type Log = {
  events: { id: string; person_type: string; name: string; ref: string | null; class_name: string | null; direction: string; method: string; late: boolean; at: string; note: string | null }[];
  summary: { students_on_site: number; staff_on_site: number; students_late: number; staff_late: number };
};
type Self = { staff: { id: string; full_name: string } | null; events: { direction: string; at: string; late: boolean }[]; geofence: unknown };

export default function GatePage() {
  const { data: me } = useApi<Me>("/api/me");
  const roles = rolesOf(me);
  const canKiosk = ["gate_officer", "school_admin", "principal", "platform_admin"].some(r => roles.has(r));
  const canLog = canKiosk || ["hr_manager", "teacher", "qa_officer"].some(r => roles.has(r));
  const [day, setDay] = useState("");
  const [type, setType] = useState("");
  const log = useApi<Log>(canLog ? `/api/gate/events?${new URLSearchParams({ ...(day ? { date: day } : {}), ...(type ? { type } : {}) })}` : null, [day, type, canLog]);

  return (
    <Page wide>
      <PageHeader eyebrow="Attendance" title="Sign in / sign out"
        subtitle="Scan ID cards at the gate. Parents get a WhatsApp and email the moment their child signs in or out."
        actions={canKiosk ? <Link className="btn btn-ghost border border-slate-200" href="/school/gate/kiosk">Open full-screen kiosk</Link> : undefined} />
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          {canKiosk && <section className="card p-5"><h2 className="mb-3 font-semibold">Gate kiosk</h2><GateScanner onRecorded={log.reload} /></section>}
          {canLog && (
            <section className="card p-5">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h2 className="mr-auto font-semibold">Log</h2>
                <input type="date" className="input w-auto" value={day} onChange={e => setDay(e.target.value)} aria-label="Date" />
                <select className="input w-auto" value={type} onChange={e => setType(e.target.value)} aria-label="Who">
                  <option value="">Everyone</option><option value="student">Students</option><option value="staff">Staff</option>
                </select>
                <a className="btn btn-ghost" href={`/api/gate/events?format=csv${day ? `&date=${day}` : ""}`}>CSV</a>
              </div>
              {log.error && <Alert>{log.error}</Alert>}
              {log.data && (
                <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Stat label="Students on site" value={log.data.summary.students_on_site} tone="good" />
                  <Stat label="Staff on site" value={log.data.summary.staff_on_site} />
                  <Stat label="Students late" value={log.data.summary.students_late} tone={log.data.summary.students_late ? "warn" : undefined} />
                  <Stat label="Staff late" value={log.data.summary.staff_late} tone={log.data.summary.staff_late ? "warn" : undefined} />
                </div>
              )}
              {!log.data?.events.length ? <Empty>No sign-ins recorded.</Empty> : (
                <div className="max-h-[480px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-white text-left text-xs uppercase text-slate-500"><tr><th className="py-2">Time</th><th>Name</th><th>Class / no.</th><th>Direction</th><th>How</th></tr></thead>
                    <tbody>
                      {log.data.events.map(e => (
                        <tr key={e.id} className="border-t border-slate-100">
                          <td className="py-1.5 tabular-nums">{fmtTime(e.at)}</td>
                          <td>{e.name} <span className="text-xs text-slate-400">{e.person_type}</span></td>
                          <td className="text-xs text-slate-500">{e.class_name ?? e.ref}</td>
                          <td><Badge tone={e.direction === "in" ? "green" : "slate"}>{e.direction}</Badge> {e.late && <Badge tone="amber">late</Badge>}</td>
                          <td className="text-xs text-slate-500">{e.method}{e.note ? ` · ${e.note}` : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </div>
        <SelfSignIn />
      </div>
    </Page>
  );
}

function SelfSignIn() {
  const { data, reload } = useApi<Self>("/api/gate/self");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!data) return <section className="card p-5 text-sm text-slate-500">Loading…</section>;
  if (!data.staff) return <section className="card p-5 text-sm text-slate-500">Your account is not linked to a staff record, so self sign-in is off. Ask HR to link it.</section>;
  const lastDir = data.events[data.events.length - 1]?.direction;
  async function go(direction: "in" | "out") {
    setBusy(true); setMsg(null);
    const post = async (lat?: number, lng?: number) => {
      const r = await send("/api/gate/self", { direction, lat: lat ?? null, lng: lng ?? null });
      setBusy(false);
      setMsg({ ok: r.ok, text: r.ok ? (r.data.duplicate ? "Already recorded." : `Signed ${direction}${r.data.late ? " (late)" : ""}.`) : r.error ?? "failed" });
      if (r.ok) reload();
    };
    if (navigator.geolocation) navigator.geolocation.getCurrentPosition(p => post(p.coords.latitude, p.coords.longitude), () => post(), { enableHighAccuracy: true, timeout: 10000 });
    else post();
  }
  return (
    <section className="card h-fit p-5">
      <h2 className="mb-1 font-semibold">My sign-in today</h2>
      <p className="mb-4 text-sm text-slate-500">{data.staff.full_name}</p>
      <div className="flex gap-2">
        <button className="btn btn-primary flex-1 py-3" disabled={busy || lastDir === "in"} onClick={() => go("in")}>Sign in</button>
        <button className="btn btn-ghost flex-1 border border-slate-200 py-3" disabled={busy || lastDir !== "in"} onClick={() => go("out")}>Sign out</button>
      </div>
      {msg && <div className="mt-3"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      <ul className="mt-4 space-y-1 text-sm">
        {data.events.map((e, i) => <li key={i} className="flex justify-between"><Badge tone={e.direction === "in" ? "green" : "slate"}>{e.direction}</Badge><span className="tabular-nums">{fmtTime(e.at)}{e.late ? " · late" : ""}</span></li>)}
      </ul>
      {Boolean(data.geofence) && <p className="mt-3 text-xs text-slate-500">Your location is checked against the school grounds when you sign in.</p>}
    </section>
  );
}
