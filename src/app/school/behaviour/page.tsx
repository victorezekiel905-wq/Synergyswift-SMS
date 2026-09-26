"use client";
import { useEffect, useState } from "react";
import { useApi, send, Page, PageHeader, Tabs, Alert, Empty, Field, Badge, fmtDate, rolesOf, type Me } from "@/components/ui";

type Data = {
  categories: { id: string; name: string; kind: "positive" | "negative"; points: number; notify_parent: boolean }[];
  rules: { id: string; name: string; kind: string; measure: string; threshold: number; window_days: number; action: string; notify_parent: boolean; active: boolean }[];
  houses: { id: string; name: string; color: string; points: number }[];
  actions: { id: string; action: string; created_at: string; students: { first_name: string; last_name: string; class_groups: { name: string } | null } }[];
  records: { id: string; kind: string; points: number; note: string | null; occurred_at: string; behaviour_categories: { name: string } | null; students: { first_name: string; last_name: string; class_groups: { name: string } | null }; recorder: { full_name: string } | null }[];
};

export default function BehaviourPage() {
  const { data: me } = useApi<Me>("/api/me");
  const admin = ["school_admin", "principal", "platform_admin"].some(r => rolesOf(me).has(r));
  const { data, error, reload } = useApi<Data>("/api/behaviour");
  const [tab, setTab] = useState<"record" | "actions" | "houses" | "setup">("record");
  return (
    <Page wide>
      <PageHeader eyebrow="Pastoral" title="Behaviour & houses"
        subtitle="Award points and log concerns in two taps. Rules trigger follow-up actions automatically (for example three concerns in two weeks), and parents hear about the things that matter." />
      {error && <Alert>{error}</Alert>}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "record", label: "Record" }, { id: "actions", label: `Follow-ups${data?.actions.length ? ` (${data.actions.length})` : ""}` }, { id: "houses", label: "Houses" }, ...(admin ? [{ id: "setup" as const, label: "Setup" }] : [])]} />
      {data && tab === "record" && <Record data={data} reload={reload} />}
      {data && tab === "actions" && <Actions data={data} reload={reload} />}
      {data && tab === "houses" && <Houses data={data} admin={admin} reload={reload} />}
      {data && tab === "setup" && <Setup data={data} reload={reload} />}
    </Page>
  );
}

function Record({ data, reload }: { data: Data; reload: () => void }) {
  const { data: structure } = useApi<{ class_groups: { id: string; name: string }[] }>("/api/school/structure");
  const [cg, setCg] = useState("");
  useEffect(() => { if (!cg && structure?.class_groups[0]) setCg(structure.class_groups[0].id); }, [structure, cg]);
  const { data: students } = useApi<{ id: string; first_name: string; last_name: string }[]>(cg ? `/api/sims/students?class_group_id=${cg}` : null, [cg]);
  const [picked, setPicked] = useState<string[]>([]);
  const [cat, setCat] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function save() {
    const r = await send("/api/behaviour", { action: "record", student_ids: picked, category_id: cat, note: note || null });
    setMsg({ ok: r.ok, text: r.ok ? `Recorded for ${r.data.recorded} student(s).${r.data.actions_triggered ? ` ${r.data.actions_triggered} follow-up action(s) created.` : ""}` : r.error ?? "failed" });
    if (r.ok) { setPicked([]); setNote(""); reload(); }
  }
  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <section className="card p-5 xl:col-span-2">
        <div className="mb-3 flex items-center gap-2">
          <select className="input w-auto" value={cg} onChange={e => { setCg(e.target.value); setPicked([]); }} aria-label="Class">{(structure?.class_groups ?? []).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
          <button className="btn btn-ghost text-xs" onClick={() => setPicked(picked.length ? [] : (students ?? []).map(s => s.id))}>{picked.length ? "Clear" : "Select whole class"}</button>
        </div>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
          {(students ?? []).map(s => (
            <button key={s.id} onClick={() => setPicked(p => p.includes(s.id) ? p.filter(x => x !== s.id) : [...p, s.id])} aria-pressed={picked.includes(s.id)}
              className={"rounded-lg border px-2 py-2 text-left text-sm " + (picked.includes(s.id) ? "border-brand-500 bg-brand-50 font-semibold" : "border-slate-200 hover:bg-slate-50")}>{s.first_name} {s.last_name}</button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {data.categories.map(c => (
            <button key={c.id} onClick={() => setCat(c.id)} aria-pressed={cat === c.id}
              className={"rounded-full px-3 py-1.5 text-sm font-medium " + (cat === c.id ? (c.kind === "positive" ? "bg-emerald-600 text-white" : "bg-rose-600 text-white") : (c.kind === "positive" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"))}>
              {c.name} {c.points > 0 ? `+${c.points}` : c.points}
            </button>
          ))}
          {!data.categories.length && <Alert tone="amber">No behaviour categories yet. An admin can add the starter set under Setup.</Alert>}
        </div>
        <input className="input mt-3" placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} aria-label="Note" />
        {msg && <div className="mt-3"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
        <button className="btn btn-primary mt-3" disabled={!picked.length || !cat} onClick={save}>Record for {picked.length} student{picked.length === 1 ? "" : "s"}</button>
      </section>
      <section className="card p-5">
        <h2 className="mb-2 font-semibold">Recent</h2>
        {!data.records.length ? <p className="text-sm text-slate-500">Nothing recorded yet.</p> : (
          <ul className="max-h-[520px] space-y-2 overflow-y-auto text-sm">{data.records.slice(0, 60).map(r => (
            <li key={r.id} className="flex items-start justify-between gap-2 border-b border-slate-100 pb-1">
              <span><b>{r.students.first_name} {r.students.last_name}</b> <span className="text-xs text-slate-400">{r.students.class_groups?.name}</span><br />
                <span className="text-xs">{r.behaviour_categories?.name}{r.note ? ` · ${r.note}` : ""} · {r.recorder?.full_name} · {fmtDate(r.occurred_at, true)}</span></span>
              <Badge tone={r.kind === "positive" ? "green" : "red"}>{r.points > 0 ? `+${r.points}` : r.points}</Badge>
            </li>))}</ul>
        )}
      </section>
    </div>
  );
}

function Actions({ data, reload }: { data: Data; reload: () => void }) {
  if (!data.actions.length) return <Empty>No open follow-ups.</Empty>;
  return (
    <div className="space-y-2">
      {data.actions.map(a => (
        <div key={a.id} className="card flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
          <span><b>{a.students.first_name} {a.students.last_name}</b> ({a.students.class_groups?.name}): {a.action} <span className="text-xs text-slate-400">{fmtDate(a.created_at)}</span></span>
          <span className="flex gap-2">
            <button className="btn btn-primary px-3 py-1 text-xs" onClick={async () => { await send("/api/behaviour", { action: "resolve", id: a.id, status: "done", note: prompt("Note (optional)") }); reload(); }}>Done</button>
            <button className="btn btn-ghost px-3 py-1 text-xs" onClick={async () => { await send("/api/behaviour", { action: "resolve", id: a.id, status: "cancelled" }); reload(); }}>Cancel</button>
          </span>
        </div>
      ))}
    </div>
  );
}

function Houses({ data, admin, reload }: { data: Data; admin: boolean; reload: () => void }) {
  const [h, setH] = useState({ name: "", color: "#1d5ddb" });
  const max = Math.max(1, ...data.houses.map(x => Math.abs(x.points)));
  return (
    <div className="space-y-4">
      {!data.houses.length ? <Empty>No houses set up.</Empty> : (
        <div className="space-y-3">{data.houses.map((x, i) => (
          <div key={x.id} className="card p-4">
            <div className="flex items-center justify-between"><span className="font-semibold">{i + 1}. {x.name}</span><span className="text-xl font-bold tabular-nums">{x.points}</span></div>
            <div className="mt-2 h-3 rounded-full bg-slate-100"><div className="h-3 rounded-full" style={{ width: `${Math.max(2, (Math.abs(x.points) / max) * 100)}%`, background: x.color }} /></div>
          </div>))}</div>
      )}
      {admin && (
        <form className="card flex flex-wrap items-end gap-2 p-4" onSubmit={async e => { e.preventDefault(); await send("/api/behaviour", { action: "save_house", ...h }); setH({ name: "", color: "#1d5ddb" }); reload(); }}>
          <Field label="House name"><input className="input" required value={h.name} onChange={e => setH({ ...h, name: e.target.value })} /></Field>
          <Field label="Colour"><input className="input h-10 w-20" type="color" value={h.color} onChange={e => setH({ ...h, color: e.target.value })} /></Field>
          <button className="btn btn-primary">Add house</button>
          <p className="w-full text-xs text-slate-500">Assign students to houses from their student record, or in bulk from the Students list.</p>
        </form>
      )}
    </div>
  );
}

function Setup({ data, reload }: { data: Data; reload: () => void }) {
  const [c, setC] = useState({ name: "", kind: "positive", points: 1, notify_parent: false });
  const [r, setR] = useState({ name: "", kind: "negative", measure: "count", threshold: 3, window_days: 14, action_text: "", notify_parent: true });
  const [err, setErr] = useState<string | null>(null);
  const act = async (body: Record<string, unknown>) => { const x = await send("/api/behaviour", body); setErr(x.ok ? null : x.error); if (x.ok) reload(); return x.ok; };
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {err && <div className="lg:col-span-2"><Alert>{err}</Alert></div>}
      <section className="card p-5">
        <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Categories</h2>{!data.categories.length && <button className="btn btn-ghost text-xs" onClick={() => act({ action: "seed_defaults" })}>Add starter set</button>}</div>
        <ul className="mb-3 space-y-1 text-sm">{data.categories.map(x => <li key={x.id} className="flex justify-between"><span>{x.name}{x.notify_parent ? " · tells parents" : ""}</span><Badge tone={x.kind === "positive" ? "green" : "red"}>{x.points}</Badge></li>)}</ul>
        <form className="grid grid-cols-2 gap-2" onSubmit={async e => { e.preventDefault(); if (await act({ action: "save_category", ...c, points: Number(c.points) })) setC({ ...c, name: "" }); }}>
          <input className="input col-span-2" placeholder="Name" required value={c.name} onChange={e => setC({ ...c, name: e.target.value })} aria-label="Category name" />
          <select className="input" value={c.kind} onChange={e => setC({ ...c, kind: e.target.value })} aria-label="Kind"><option value="positive">Positive</option><option value="negative">Negative</option></select>
          <input className="input" type="number" min={1} max={100} value={c.points} onChange={e => setC({ ...c, points: Number(e.target.value) })} aria-label="Points" />
          <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={c.notify_parent} onChange={e => setC({ ...c, notify_parent: e.target.checked })} /> Tell parents every time</label>
          <button className="btn btn-primary col-span-2">Add category</button>
        </form>
      </section>
      <section className="card p-5">
        <h2 className="mb-3 font-semibold">Automatic rules</h2>
        <ul className="mb-3 space-y-1 text-sm">{data.rules.map(x => <li key={x.id}>{x.name}: {x.threshold} {x.measure === "count" ? `${x.kind} records` : `${x.kind} points`} in {x.window_days} days → <b>{x.action}</b>{x.notify_parent ? " + parents told" : ""}</li>)}</ul>
        <form className="grid grid-cols-2 gap-2" onSubmit={async e => { e.preventDefault(); if (await act({ action: "save_rule", ...r, threshold: Number(r.threshold), window_days: Number(r.window_days) })) setR({ ...r, name: "", action_text: "" }); }}>
          <input className="input col-span-2" placeholder="Rule name" required value={r.name} onChange={e => setR({ ...r, name: e.target.value })} aria-label="Rule name" />
          <select className="input" value={r.kind} onChange={e => setR({ ...r, kind: e.target.value })} aria-label="Kind"><option value="negative">Negative</option><option value="positive">Positive</option></select>
          <select className="input" value={r.measure} onChange={e => setR({ ...r, measure: e.target.value })} aria-label="Measure"><option value="count">Number of records</option><option value="points">Total points</option></select>
          <input className="input" type="number" min={1} value={r.threshold} onChange={e => setR({ ...r, threshold: Number(e.target.value) })} aria-label="Threshold" />
          <input className="input" type="number" min={1} max={365} value={r.window_days} onChange={e => setR({ ...r, window_days: Number(e.target.value) })} aria-label="Within days" />
          <input className="input col-span-2" placeholder="Action, e.g. Detention and call parents" required value={r.action_text} onChange={e => setR({ ...r, action_text: e.target.value })} aria-label="Action" />
          <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={r.notify_parent} onChange={e => setR({ ...r, notify_parent: e.target.checked })} /> Tell parents when it triggers</label>
          <button className="btn btn-primary col-span-2">Add rule</button>
        </form>
      </section>
    </div>
  );
}
