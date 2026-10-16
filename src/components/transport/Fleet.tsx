"use client";
import { useState } from "react";
import { useApi, send, Alert, Empty, Modal, Field, Badge, fmtDate } from "@/components/ui";

type Vehicle = { id: string; reg_no: string; make_model: string | null; seats: number | null; insurance_expires: string | null; roadworthy_expires: string | null; licence_expires: string | null;
  last_service_on: string | null; next_service_on: string | null; odometer_km: number | null; status: string; notes: string | null };
type Driver = { id: string; full_name: string; phone: string | null; staff_id: string | null; licence_no: string | null; licence_class: string | null; licence_expires: string | null; medical_expires: string | null; background_check_on: string | null; active: boolean };
type Data = { vehicles: Vehicle[]; drivers: Driver[]; routes: { id: string; name: string; vehicle_id: string | null; driver_id: string | null }[]; staff: { id: string; full_name: string }[]; can_edit: boolean;
  expiring: { kind: string; id: string; name: string; what: string; date: string; expired: boolean }[] };

/** Buses and drivers with their documents, and which bus and driver run each route. */
export function Fleet() {
  const { data, error, reload } = useApi<Data>("/api/transport/fleet");
  const [v, setV] = useState<Partial<Vehicle> | null>(null);
  const [d, setD] = useState<Partial<Driver> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;
  const save = async (body: object, close: () => void) => { const r = await send("/api/transport/fleet", body); if (!r.ok) return setErr(r.error); setErr(null); close(); reload(); };
  const date = (x: Partial<Vehicle | Driver>, k: string, label: string, set: (o: any) => void) => <Field label={label}><input className="input" type="date" value={(x as any)[k] ?? ""} onChange={e => set({ ...x, [k]: e.target.value })} /></Field>;
  return (
    <div className="space-y-4">
      {data.expiring.length > 0 && <Alert tone={data.expiring.some(e => e.expired) ? "red" : "amber"}>
        {data.expiring.map((e, i) => <span key={i} className="mr-3 inline-block">{e.name}: {e.what} {e.expired ? "expired" : "expires"} {fmtDate(e.date)}.</span>)}
        {data.expiring.some(e => e.expired && e.kind === "vehicle" && ["insurance", "roadworthiness"].includes(e.what)) && <span className="block font-semibold">A bus with expired insurance or roadworthiness cannot start a trip.</span>}
      </Alert>}
      <section className="card p-4">
        <div className="mb-2 flex items-center"><h2 className="mr-auto font-semibold">Buses</h2>{data.can_edit && <button className="btn btn-outline" onClick={() => setV({ status: "active" })}>+ Bus</button>}</div>
        {!data.vehicles.length ? <Empty>No buses recorded.</Empty> : <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="text-left text-[13px] text-slate-500"><tr><th className="py-1">Bus</th><th className="py-1">Seats</th><th className="py-1">Insurance</th><th className="py-1">Roadworthy</th><th className="py-1">Next service</th><th className="py-1">Status</th><th /></tr></thead>
          <tbody>{data.vehicles.map(x => <tr key={x.id} className="border-t border-slate-100"><td className="py-1.5 font-medium">{x.reg_no}<div className="text-xs text-slate-500">{x.make_model}</div></td><td>{x.seats}</td>
            <td>{fmtDate(x.insurance_expires)}</td><td>{fmtDate(x.roadworthy_expires)}</td><td>{fmtDate(x.next_service_on)}</td><td><Badge tone={x.status === "active" ? "green" : x.status === "repair" ? "amber" : "slate"}>{x.status}</Badge></td>
            <td className="text-right">{data.can_edit && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setV(x)}>Edit</button>}</td></tr>)}</tbody></table></div>}
      </section>
      <section className="card p-4">
        <div className="mb-2 flex items-center"><h2 className="mr-auto font-semibold">Drivers</h2>{data.can_edit && <button className="btn btn-outline" onClick={() => setD({ active: true })}>+ Driver</button>}</div>
        {!data.drivers.length ? <Empty>No drivers recorded.</Empty> : <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="text-left text-[13px] text-slate-500"><tr><th className="py-1">Driver</th><th className="py-1">Licence</th><th className="py-1">Expires</th><th className="py-1">Medical</th><th className="py-1">Background check</th><th /></tr></thead>
          <tbody>{data.drivers.map(x => <tr key={x.id} className={"border-t border-slate-100 " + (x.active ? "" : "text-slate-400")}><td className="py-1.5 font-medium">{x.full_name}<div className="text-xs text-slate-500">{x.phone}</div></td>
            <td>{x.licence_no}{x.licence_class ? ` (${x.licence_class})` : ""}</td><td>{fmtDate(x.licence_expires)}</td><td>{fmtDate(x.medical_expires)}</td><td>{fmtDate(x.background_check_on)}</td>
            <td className="text-right">{data.can_edit && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setD(x)}>Edit</button>}</td></tr>)}</tbody></table></div>}
      </section>
      {data.can_edit && data.routes.length > 0 && <section className="card p-4">
        <h2 className="mb-2 font-semibold">Who runs each route</h2>
        <ul className="space-y-1 text-sm">{data.routes.map(r => <li key={r.id} className="flex flex-wrap items-center gap-2"><span className="w-40 font-medium">{r.name}</span>
          <select className="input w-auto" value={r.vehicle_id ?? ""} onChange={e => save({ action: "link", route_id: r.id, vehicle_id: e.target.value || null, driver_id: r.driver_id }, () => undefined)}><option value="">No bus</option>{data.vehicles.filter(x => x.status !== "retired").map(x => <option key={x.id} value={x.id}>{x.reg_no}</option>)}</select>
          <select className="input w-auto" value={r.driver_id ?? ""} onChange={e => save({ action: "link", route_id: r.id, vehicle_id: r.vehicle_id, driver_id: e.target.value || null }, () => undefined)}><option value="">No driver</option>{data.drivers.filter(x => x.active).map(x => <option key={x.id} value={x.id}>{x.full_name}</option>)}</select></li>)}</ul>
      </section>}
      {err && <Alert>{err}</Alert>}
      <Modal open={Boolean(v)} onClose={() => setV(null)} title={v?.id ? "Edit bus" : "New bus"} wide>
        {v && <form className="grid gap-3 sm:grid-cols-3" onSubmit={e => { e.preventDefault(); save({ action: "save_vehicle", ...v, seats: v.seats ? Number(v.seats) : null, odometer_km: v.odometer_km ? Number(v.odometer_km) : null }, () => setV(null)); }}>
          <Field label="Registration"><input className="input" required value={v.reg_no ?? ""} onChange={e => setV({ ...v, reg_no: e.target.value })} /></Field>
          <Field label="Make and model"><input className="input" value={v.make_model ?? ""} onChange={e => setV({ ...v, make_model: e.target.value })} /></Field>
          <Field label="Seats"><input className="input" type="number" min={1} value={v.seats ?? ""} onChange={e => setV({ ...v, seats: Number(e.target.value) })} /></Field>
          {date(v, "insurance_expires", "Insurance expires", setV)}{date(v, "roadworthy_expires", "Roadworthiness expires", setV)}{date(v, "licence_expires", "Vehicle licence expires", setV)}
          {date(v, "last_service_on", "Last service", setV)}{date(v, "next_service_on", "Next service", setV)}
          <Field label="Odometer (km)"><input className="input" type="number" min={0} value={v.odometer_km ?? ""} onChange={e => setV({ ...v, odometer_km: Number(e.target.value) })} /></Field>
          <Field label="Status"><select className="input" value={v.status} onChange={e => setV({ ...v, status: e.target.value })}><option value="active">In service</option><option value="repair">In for repair</option><option value="retired">Retired</option></select></Field>
          <div className="sm:col-span-2"><Field label="Notes"><input className="input" value={v.notes ?? ""} onChange={e => setV({ ...v, notes: e.target.value })} /></Field></div>
          <button className="btn btn-primary sm:col-span-3">Save</button>
        </form>}
      </Modal>
      <Modal open={Boolean(d)} onClose={() => setD(null)} title={d?.id ? "Edit driver" : "New driver"} wide>
        {d && <form className="grid gap-3 sm:grid-cols-3" onSubmit={e => { e.preventDefault(); save({ action: "save_driver", ...d, staff_id: d.staff_id || null }, () => setD(null)); }}>
          <Field label="Name"><input className="input" required value={d.full_name ?? ""} onChange={e => setD({ ...d, full_name: e.target.value })} /></Field>
          <Field label="Phone"><input className="input" value={d.phone ?? ""} onChange={e => setD({ ...d, phone: e.target.value })} /></Field>
          <Field label="Staff record"><select className="input" value={d.staff_id ?? ""} onChange={e => setD({ ...d, staff_id: e.target.value })}><option value="">— (contractor)</option>{data.staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></Field>
          <Field label="Licence number"><input className="input" value={d.licence_no ?? ""} onChange={e => setD({ ...d, licence_no: e.target.value })} /></Field>
          <Field label="Class"><input className="input" value={d.licence_class ?? ""} onChange={e => setD({ ...d, licence_class: e.target.value })} /></Field>
          {date(d, "licence_expires", "Licence expires", setD)}{date(d, "medical_expires", "Medical expires", setD)}{date(d, "background_check_on", "Background check done", setD)}
          <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={d.active !== false} onChange={e => setD({ ...d, active: e.target.checked })} />Driving for the school</label>
          <button className="btn btn-primary sm:col-span-3">Save</button>
        </form>}
      </Modal>
    </div>
  );
}
