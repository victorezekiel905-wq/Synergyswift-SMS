"use client";
import { useState } from "react";
import { useApi, send, Page, PageHeader, Tabs, Alert, Empty, Modal, Field, Badge, statusTone, fmtDate, fmtTime } from "@/components/ui";

type Hostel = { id: string; name: string; gender: string | null; users: { full_name: string } | null;
  hostel_rooms: { id: string; name: string; capacity: number; occupants: { id: string; student_id: string; name: string; bed_label: string | null; students: { admission_no: string; class_groups: { name: string } | null } }[] }[] };
type Exeat = { id: string; name: string; reason: string; leave_at: string; return_by: string; status: string; collector_name: string | null; requested_by: string; students: { class_groups: { name: string } | null }; guardians: { full_name: string; phone: string | null } | null };

export default function HostelPage() {
  const { data, error, reload } = useApi<{ hostels: Hostel[]; exeats: Exeat[]; can_manage: boolean }>("/api/hostel");
  const [tab, setTab] = useState<"exeat" | "rooms">("exeat");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const act = async (body: Record<string, unknown>, ok: string) => { const r = await send("/api/hostel", body); setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" }); if (r.ok) reload(); };
  const boarders = (data?.hostels ?? []).reduce((a, h) => a + h.hostel_rooms.reduce((b, r) => b + r.occupants.length, 0), 0);
  const beds = (data?.hostels ?? []).reduce((a, h) => a + h.hostel_rooms.reduce((b, r) => b + r.capacity, 0), 0);
  const out = (data?.exeats ?? []).filter(e => e.status === "out");
  return (
    <Page wide>
      <PageHeader eyebrow="Boarding" title="Hostels & exeat" subtitle={`${boarders} boarders in ${beds} beds. Parents request exeat from their portal; you approve, check out and check in, and they are told at each step.`} />
      {error && <Alert>{error}</Alert>}
      {msg && <div className="mb-3"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      {out.some(e => new Date(e.return_by) < new Date()) && <div className="mb-3"><Alert>Overdue: {out.filter(e => new Date(e.return_by) < new Date()).map(e => e.name).join(", ")} should be back already.</Alert></div>}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "exeat", label: `Exeat${data?.exeats.filter(e => e.status === "pending").length ? ` (${data.exeats.filter(e => e.status === "pending").length} to decide)` : ""}` }, { id: "rooms", label: "Rooms" }]} />
      {tab === "exeat" && (!data?.exeats.length ? <Empty>No open exeat requests.</Empty> : (
        <div className="space-y-2">{data.exeats.map(e => (
          <div key={e.id} className="card flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
            <div><p className="font-semibold">{e.name} <span className="font-normal text-slate-500">({e.students.class_groups?.name})</span> <Badge tone={statusTone(e.status === "out" ? "pending" : e.status)}>{e.status}</Badge></p>
              <p>{e.reason}</p><p className="text-xs text-slate-500">{fmtDate(e.leave_at)} {fmtTime(e.leave_at)} → {fmtDate(e.return_by)} {fmtTime(e.return_by)} · collector {e.collector_name ?? e.guardians?.full_name ?? "—"} {e.guardians?.phone ?? ""}</p></div>
            {data.can_manage && <div className="flex gap-2">
              {e.status === "pending" && <><button className="btn btn-primary px-3 py-1 text-xs" onClick={() => act({ action: "exeat_decide", id: e.id, decision: "approved" }, "Approved; parents told.")}>Approve</button>
                <button className="btn btn-ghost px-3 py-1 text-xs text-rose-600" onClick={() => { const n = prompt("Reason for declining?"); if (n !== null) act({ action: "exeat_decide", id: e.id, decision: "rejected", note: n }, "Declined; parents told."); }}>Decline</button></>}
              {e.status === "approved" && <button className="btn btn-primary px-3 py-1 text-xs" onClick={() => act({ action: "exeat_out", id: e.id }, "Checked out; parents told.")}>Check out</button>}
              {e.status === "out" && <button className="btn btn-primary px-3 py-1 text-xs" onClick={() => act({ action: "exeat_return", id: e.id }, "Welcome back; parents told.")}>Check in</button>}
            </div>}
          </div>))}</div>
      ))}
      {tab === "rooms" && data && <Rooms data={data} reload={reload} />}
    </Page>
  );
}

function Rooms({ data, reload }: { data: { hostels: Hostel[]; can_manage: boolean }; reload: () => void }) {
  const [h, setH] = useState({ name: "", gender: "mixed" });
  const [room, setRoom] = useState<{ hostel_id: string; name: string; capacity: number } | null>(null);
  const [alloc, setAlloc] = useState<{ room_id: string; room: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const act = async (body: Record<string, unknown>) => { const r = await send("/api/hostel", body); setErr(r.ok ? null : r.error); if (r.ok) reload(); return r.ok; };
  return (
    <div className="space-y-4">
      {err && <Alert>{err}</Alert>}
      {data.hostels.map(hs => (
        <section key={hs.id} className="card p-4">
          <div className="mb-2 flex items-center justify-between"><h2 className="font-semibold">{hs.name} <span className="text-sm font-normal text-slate-500">{hs.gender ?? ""} · warden {hs.users?.full_name ?? "—"}</span></h2>
            {data.can_manage && <button className="btn btn-ghost text-xs" onClick={() => setRoom({ hostel_id: hs.id, name: "", capacity: 4 })}>+ Room</button>}</div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{hs.hostel_rooms.map(r => (
            <div key={r.id} className="rounded-lg border border-slate-200 p-3 text-sm">
              <div className="flex justify-between"><b>{r.name}</b><Badge tone={r.occupants.length >= r.capacity ? "red" : "green"}>{r.occupants.length}/{r.capacity}</Badge></div>
              <ul className="mt-1 space-y-0.5 text-xs">{r.occupants.map(o => <li key={o.id} className="flex justify-between">{o.name}{o.bed_label ? ` (${o.bed_label})` : ""}
                {data.can_manage && <button className="text-rose-600" onClick={() => confirm(`Move ${o.name} out?`) && act({ action: "vacate", allocation_id: o.id })}>✕</button>}</li>)}</ul>
              {data.can_manage && r.occupants.length < r.capacity && <button className="mt-1 text-xs text-brand-700" onClick={() => setAlloc({ room_id: r.id, room: r.name })}>+ Add boarder</button>}
            </div>))}</div>
        </section>))}
      {data.can_manage && (
        <form className="card flex flex-wrap items-end gap-2 p-4" onSubmit={async e => { e.preventDefault(); if (await act({ action: "save_hostel", name: h.name, gender: h.gender })) setH({ ...h, name: "" }); }}>
          <Field label="New hostel"><input className="input" required value={h.name} onChange={e => setH({ ...h, name: e.target.value })} /></Field>
          <Field label="For"><select className="input" value={h.gender} onChange={e => setH({ ...h, gender: e.target.value })}><option value="mixed">Mixed</option><option value="female">Girls</option><option value="male">Boys</option></select></Field>
          <button className="btn btn-primary">Add hostel</button>
        </form>
      )}
      <Modal open={Boolean(room)} onClose={() => setRoom(null)} title="New room">
        {room && <form className="space-y-3" onSubmit={async e => { e.preventDefault(); if (await act({ action: "save_room", hostel_id: room.hostel_id, name: room.name, capacity: Number(room.capacity) })) setRoom(null); }}>
          <Field label="Room name"><input className="input" required value={room.name} onChange={e => setRoom({ ...room, name: e.target.value })} /></Field>
          <Field label="Beds"><input className="input" type="number" min={1} max={100} value={room.capacity} onChange={e => setRoom({ ...room, capacity: Number(e.target.value) })} /></Field>
          <button className="btn btn-primary w-full">Add room</button></form>}
      </Modal>
      <Modal open={Boolean(alloc)} onClose={() => setAlloc(null)} title={`Add boarder to ${alloc?.room ?? ""}`}>
        {alloc && <AddBoarder onPick={async (sid, bed) => { if (await act({ action: "allocate", room_id: alloc.room_id, student_id: sid, bed_label: bed || null })) setAlloc(null); }} />}
      </Modal>
    </div>
  );
}

function AddBoarder({ onPick }: { onPick: (studentId: string, bed: string) => void }) {
  const [q, setQ] = useState("");
  const [bed, setBed] = useState("");
  const { data } = useApi<{ id: string; first_name: string; last_name: string; admission_no: string; class_groups: { name: string } | null }[]>(q.length >= 2 ? `/api/sims/students?q=${encodeURIComponent(q)}&limit=10` : null, [q]);
  return (
    <div className="space-y-2">
      <input className="input" placeholder="Search student" value={q} onChange={e => setQ(e.target.value)} aria-label="Find student" />
      <input className="input" placeholder="Bed label (optional)" value={bed} onChange={e => setBed(e.target.value)} aria-label="Bed" />
      <ul className="divide-y divide-slate-100">{(data ?? []).map(s => <li key={s.id}><button className="w-full px-2 py-2 text-left text-sm hover:bg-slate-50" onClick={() => onPick(s.id, bed)}>{s.first_name} {s.last_name} <span className="text-xs text-slate-400">{s.admission_no} · {s.class_groups?.name}</span></button></li>)}</ul>
    </div>
  );
}
