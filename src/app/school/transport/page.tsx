"use client";
import { useEffect, useRef, useState } from "react";
import { useApi, send, Page, PageHeader, Tabs, Alert, Empty, Modal, Field, Badge, Icon, fmtTime, rolesOf, type Me } from "@/components/ui";

type Route = { id: string; name: string; vehicle: string | null; driver_name: string | null; driver_phone: string | null; attendant_id: string | null; capacity: number | null;
  stops: { name: string; am?: string | null; pm?: string | null; lat?: number | null; lng?: number | null }[]; users: { full_name: string } | null; transport_assignments: { count: number }[] };

export default function TransportPage() {
  const { data: me } = useApi<Me>("/api/me");
  const manager = ["transport_officer", "school_admin", "principal", "platform_admin"].some(r => rolesOf(me).has(r));
  const { data, reload } = useApi<{ routes: Route[] }>("/api/transport");
  const [tab, setTab] = useState<"bus" | "routes">("bus");
  const [routeId, setRouteId] = useState("");
  useEffect(() => { if (!routeId && data?.routes[0]) setRouteId(data.routes[0].id); }, [data, routeId]);
  return (
    <Page wide>
      <PageHeader eyebrow="Transport" title="School buses" subtitle="Routes, stops and riders. The bus attendant scans each child on and off, and parents get a WhatsApp message every time." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "bus", label: "On the bus" }, ...(manager ? [{ id: "routes" as const, label: "Routes & riders" }] : [])]} />
      {!data?.routes.length ? <Empty>No routes yet.{manager ? " Add one under Routes & riders." : ""}</Empty> : tab === "bus" ? (
        <>
          <select className="input mb-3 w-auto" value={routeId} onChange={e => setRouteId(e.target.value)} aria-label="Route">{data.routes.map(r => <option key={r.id} value={r.id}>{r.name}{r.vehicle ? ` (${r.vehicle})` : ""}</option>)}</select>
          {routeId && <LiveTrip key={routeId} routeId={routeId} />}
          {routeId && <Bus routeId={routeId} route={data.routes.find(r => r.id === routeId)!} />}
        </>
      ) : <Routes routes={data.routes} reload={reload} />}
    </Page>
  );
}

/**
 * Shares this phone's location while a trip runs, so parents see the bus
 * and get an alert as it nears their stop. Nothing is shared outside a trip.
 */
function LiveTrip({ routeId }: { routeId: string }) {
  const [trip, setTrip] = useState<"morning" | "afternoon" | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const watch = useRef<number | null>(null);
  const lastSent = useRef(0);
  const wake = useRef<{ release: () => Promise<void> } | null>(null);

  function stopWatching() {
    if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
    watch.current = null;
    wake.current?.release().catch(() => undefined);
    wake.current = null;
  }
  useEffect(() => stopWatching, []);

  async function start(t: "morning" | "afternoon") {
    setErr(null);
    if (!("geolocation" in navigator)) { setErr("This device cannot share its location."); return; }
    const r = await send("/api/transport/live", { action: "start", route_id: routeId, trip: t });
    if (!r.ok) { setErr(r.error); return; }
    setTrip(t); setStatus("Waiting for GPS…");
    try { wake.current = await (navigator as unknown as { wakeLock: { request: (k: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock.request("screen"); } catch { /* keep going without */ }
    watch.current = navigator.geolocation.watchPosition(async pos => {
      if (Date.now() - lastSent.current < 15_000) return;
      lastSent.current = Date.now();
      const p = await send<{ alerted_stops?: string[] }>("/api/transport/live", { action: "ping", route_id: routeId, lat: pos.coords.latitude, lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy, speed: pos.coords.speed ?? null });
      setStatus(p.ok ? `Location shared at ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}${p.data.alerted_stops?.length ? ` · parents alerted at ${p.data.alerted_stops.join(", ")}` : ""}` : p.error);
    }, e => setErr(e.code === e.PERMISSION_DENIED ? "Location permission was refused. Allow it in the browser settings." : e.message), { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 });
  }
  async function end() {
    stopWatching();
    await send("/api/transport/live", { action: "end", route_id: routeId });
    setTrip(null); setStatus("Trip ended. Location is no longer shared.");
  }
  return (
    <section className="card mb-4 flex flex-wrap items-center gap-2 p-4">
      <span className="mr-auto text-sm"><b>Live location</b>{trip ? <Badge tone="green">{trip} trip running</Badge> : null}
        <span className="block text-xs text-slate-500">{status ?? "Start a trip on the attendant's phone so parents can see the bus."}</span></span>
      {!trip ? (<>
        <button className="btn btn-primary" onClick={() => start("morning")}>Start morning trip</button>
        <button className="btn btn-outline" onClick={() => start("afternoon")}>Start afternoon trip</button>
      </>) : <button className="btn btn-danger" onClick={end}>End trip</button>}
      {err && <div className="w-full"><Alert>{err}</Alert></div>}
    </section>
  );
}

function Bus({ routeId, route }: { routeId: string; route: Route }) {
  const { data, reload } = useApi<{ riders: { student_id: string; name: string; stop_name: string | null; on_bus: boolean; students: { admission_no: string; class_groups: { name: string } | null } }[] }>(`/api/transport?route_id=${routeId}`, [routeId]);
  const [kind, setKind] = useState<"boarded" | "alighted">("boarded");
  const [stop, setStop] = useState("");
  const [code, setCode] = useState("");
  const [last, setLast] = useState<{ ok: boolean; text: string } | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  async function scan(value: string) {
    if (!value.trim()) return;
    const r = await send("/api/transport", { action: "scan", route_id: routeId, code: value, kind, stop_name: stop || null });
    setCode("");
    if (!r.ok) setLast({ ok: false, text: r.error ?? "failed" });
    else setLast({ ok: !r.data.wrong_route, text: `${r.data.person.name} ${kind === "boarded" ? "got on" : "got off"}${r.data.duplicate ? " (already recorded)" : ""}${r.data.wrong_route ? " · NOT on this route!" : ""}${r.data.not_assigned ? " · not assigned to a bus" : ""}` });
    reload(); ref.current?.focus();
  }
  const onBus = (data?.riders ?? []).filter(r => r.on_bus).length;
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <section className="card space-y-3 p-5">
        <div className="flex gap-2">{(["boarded", "alighted"] as const).map(k => <button key={k} className={"btn flex-1 " + (kind === k ? "btn-primary" : "btn-ghost border border-slate-200")} onClick={() => setKind(k)}>{k === "boarded" ? "Getting ON" : "Getting OFF"}</button>)}</div>
        <select className="input" value={stop} onChange={e => setStop(e.target.value)} aria-label="Stop"><option value="">Stop: rider&apos;s usual stop</option>{route.stops.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}<option value="School">School</option></select>
        <form onSubmit={e => { e.preventDefault(); scan(code); }}><input ref={ref} autoFocus className="input py-3 text-lg" placeholder="Scan ID card or type admission no" value={code} onChange={e => setCode(e.target.value)} aria-label="Card code" /></form>
        {last && <div role="status" className={"rounded-lg p-3 font-semibold text-white " + (last.ok ? "bg-emerald-600" : "bg-rose-600")}>{last.text}</div>}
        <p className="text-sm">On the bus now: <b>{onBus}</b> of {data?.riders.length ?? 0}</p>
        <p className="text-xs text-slate-500">Driver: {route.driver_name ?? "—"} {route.driver_phone ?? ""}</p>
      </section>
      <section className="card p-5 lg:col-span-2">
        <h2 className="mb-2 font-semibold">Riders</h2>
        {!data?.riders.length ? <Empty>No students assigned to this bus.</Empty> : (
          <div className="grid gap-1.5 sm:grid-cols-2">{data.riders.map(r => (
            <button key={r.student_id} className={"flex items-center justify-between rounded border px-3 py-2 text-left text-sm " + (r.on_bus ? "border-emerald-300 bg-emerald-50" : "border-slate-200")}
              onClick={() => scan(r.students.admission_no)} title="Tap to record without the card">
              <span>{r.name}<span className="block text-xs text-slate-400">{r.students.class_groups?.name} · {r.stop_name ?? "—"}</span></span>
              <Badge tone={r.on_bus ? "green" : "slate"}>{r.on_bus ? "on bus" : "off"}</Badge>
            </button>))}</div>
        )}
      </section>
    </div>
  );
}

function Routes({ routes, reload }: { routes: Route[]; reload: () => void }) {
  const [edit, setEdit] = useState<Partial<Route> | null>(null);
  const [assign, setAssign] = useState<Route | null>(null);
  const { data: staff } = useApi<{ id: string; full_name: string; role: string }[] & any>("/api/school/structure");
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <button className="btn btn-primary" onClick={() => setEdit({ stops: [] })}>+ New route</button>
      <div className="grid gap-3 md:grid-cols-2">{routes.map(r => (
        <div key={r.id} className="card p-4 text-sm">
          <div className="flex items-start justify-between"><div><p className="font-semibold">{r.name}</p><p className="text-slate-500">{r.vehicle ?? "—"} · {r.driver_name ?? "no driver"} {r.driver_phone ?? ""}</p><p className="text-xs text-slate-500">Attendant: {r.users?.full_name ?? "—"}</p></div>
            <Badge>{r.transport_assignments?.[0]?.count ?? 0}{r.capacity ? `/${r.capacity}` : ""} riders</Badge></div>
          <p className="mt-2 text-xs">{r.stops.map(s => `${s.name}${s.am ? ` ${s.am}` : ""}`).join(" → ") || "No stops"}</p>
          <div className="mt-2 flex gap-2"><button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setEdit(r)}>Edit</button><button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setAssign(r)}>Assign riders</button></div>
        </div>))}</div>
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.id ? "Edit route" : "New route"} wide>
        {edit && <form className="grid gap-3 sm:grid-cols-2" onSubmit={async e => {
          e.preventDefault();
          const r = await send("/api/transport", { action: "save_route", id: edit.id, name: edit.name, vehicle: edit.vehicle || null, driver_name: edit.driver_name || null, driver_phone: edit.driver_phone || null,
            attendant_id: edit.attendant_id || null, capacity: edit.capacity ? Number(edit.capacity) : null, stops: (edit.stops ?? []).filter(s => s.name) });
          if (!r.ok) return setErr(r.error);
          setErr(null); setEdit(null); reload();
        }}>
          <Field label="Route name"><input className="input" required value={edit.name ?? ""} onChange={e => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="Vehicle / plate"><input className="input" value={edit.vehicle ?? ""} onChange={e => setEdit({ ...edit, vehicle: e.target.value })} /></Field>
          <Field label="Driver"><input className="input" value={edit.driver_name ?? ""} onChange={e => setEdit({ ...edit, driver_name: e.target.value })} /></Field>
          <Field label="Driver phone"><input className="input" value={edit.driver_phone ?? ""} onChange={e => setEdit({ ...edit, driver_phone: e.target.value })} /></Field>
          <Field label="Bus attendant (scans children)"><select className="input" value={edit.attendant_id ?? ""} onChange={e => setEdit({ ...edit, attendant_id: e.target.value })}><option value="">—</option>{(staff?.staff ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></Field>
          <Field label="Seats"><input className="input" type="number" min={1} value={edit.capacity ?? ""} onChange={e => setEdit({ ...edit, capacity: e.target.value as unknown as number })} /></Field>
          <div className="sm:col-span-2">
            <p className="label">Stops in order (morning pickup time)</p>
            {(edit.stops ?? []).map((s, i) => <div key={i} className="mb-1 flex gap-2"><input className="input" value={s.name} onChange={e => setEdit({ ...edit, stops: edit.stops!.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })} aria-label="Stop name" />
              <input className="input w-28" type="time" value={s.am ?? ""} onChange={e => setEdit({ ...edit, stops: edit.stops!.map((x, j) => j === i ? { ...x, am: e.target.value } : x) })} aria-label="Pickup time" />
              <button type="button" className={"inline-flex items-center gap-1 whitespace-nowrap text-xs " + (s.lat != null ? "text-emerald-700" : "text-slate-500")} title="Stand at the stop and tap to save its location for approach alerts"
                onClick={() => navigator.geolocation?.getCurrentPosition(p => setEdit({ ...edit, stops: edit.stops!.map((x, j) => j === i ? { ...x, lat: p.coords.latitude, lng: p.coords.longitude } : x) }), () => setErr("Could not read this device's location."))}>
                <Icon name="pin" className="h-3.5 w-3.5" />{s.lat != null ? "Location set" : "Set to here"}</button>
              <button type="button" className="text-rose-600" onClick={() => setEdit({ ...edit, stops: edit.stops!.filter((_, j) => j !== i) })} aria-label="Remove stop"><Icon name="x" className="h-4 w-4" /></button></div>)}
            <button type="button" className="btn btn-ghost text-xs" onClick={() => setEdit({ ...edit, stops: [...(edit.stops ?? []), { name: "", am: "" }] })}>+ Stop</button>
          </div>
          {err && <div className="sm:col-span-2"><Alert>{err}</Alert></div>}
          <div className="flex justify-between sm:col-span-2">{edit.id ? <button type="button" className="btn btn-ghost text-rose-600" onClick={async () => { if (confirm("Delete this route?")) { await send("/api/transport", { action: "delete_route", id: edit.id }); setEdit(null); reload(); } }}>Delete</button> : <span />}<button className="btn btn-primary">Save route</button></div>
        </form>}
      </Modal>
      <Modal open={Boolean(assign)} onClose={() => setAssign(null)} title={`Riders: ${assign?.name ?? ""}`} wide>{assign && <AssignRiders route={assign} onDone={() => { setAssign(null); reload(); }} />}</Modal>
    </div>
  );
}

function AssignRiders({ route, onDone }: { route: Route; onDone: () => void }) {
  const { data: structure } = useApi<{ class_groups: { id: string; name: string }[] }>("/api/school/structure");
  const [cg, setCg] = useState("");
  const { data: students } = useApi<{ id: string; first_name: string; last_name: string }[]>(cg ? `/api/sims/students?class_group_id=${cg}` : null, [cg]);
  const [picked, setPicked] = useState<string[]>([]);
  const [stop, setStop] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <select className="input" value={cg} onChange={e => { setCg(e.target.value); setPicked([]); }} aria-label="Class"><option value="">Choose class…</option>{(structure?.class_groups ?? []).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
        <select className="input" value={stop} onChange={e => setStop(e.target.value)} aria-label="Stop"><option value="">Stop…</option>{route.stops.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}</select>
      </div>
      <div className="grid max-h-72 grid-cols-2 gap-1 overflow-y-auto sm:grid-cols-3">{(students ?? []).map(s => (
        <label key={s.id} className="flex items-center gap-2 rounded border border-slate-200 px-2 py-1 text-sm"><input type="checkbox" checked={picked.includes(s.id)} onChange={e => setPicked(e.target.checked ? [...picked, s.id] : picked.filter(x => x !== s.id))} />{s.first_name} {s.last_name}</label>))}</div>
      {err && <Alert>{err}</Alert>}
      <button className="btn btn-primary" disabled={!picked.length} onClick={async () => { const r = await send("/api/transport", { action: "assign", route_id: route.id, student_ids: picked, stop_name: stop || null }); if (!r.ok) return setErr(r.error); onDone(); }}>Assign {picked.length} to {route.name}</button>
      <p className="text-xs text-slate-500">Assigning a student already on another bus moves them to this one.</p>
    </div>
  );
}
