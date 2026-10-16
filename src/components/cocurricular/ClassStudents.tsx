"use client";
import { useState } from "react";
import { useApi, Field, Loading } from "@/components/ui";

export type Pick = { id: string; name: string };

/** Choose students class by class. */
export default function ClassStudents({ classes, exclude = [], onPick, label = "Add" }: { classes: { id: string; name: string }[]; exclude?: string[]; onPick: (s: Pick[]) => Promise<void> | void; label?: string }) {
  const [cls, setCls] = useState("");
  const [sel, setSel] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const { data } = useApi<{ id: string; name: string; admission_no: string }[]>(cls ? `/api/cocurricular?view=students&class_id=${cls}` : null, [cls]);
  const list = (data ?? []).filter(s => !exclude.includes(s.id));
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <Field label="Class"><select className="input" value={cls} onChange={e => { setCls(e.target.value); setSel([]); }}>
        <option value="">Choose a class…</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      {cls && !data && <Loading />}
      {cls && data && (!list.length ? <p className="mt-2 text-sm text-slate-500">Everyone in this class is already added.</p> : (
        <>
          <label className="mt-2 flex items-center gap-2 text-xs text-slate-500"><input type="checkbox" checked={sel.length === list.length} onChange={e => setSel(e.target.checked ? list.map(s => s.id) : [])} /> Whole class</label>
          <div className="mt-1 grid max-h-56 gap-1 overflow-y-auto sm:grid-cols-2">{list.map(s => (
            <label key={s.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sel.includes(s.id)} onChange={e => setSel(e.target.checked ? [...sel, s.id] : sel.filter(x => x !== s.id))} />{s.name} <span className="text-xs text-slate-400">{s.admission_no}</span></label>))}</div>
          <button className="btn btn-primary mt-2" disabled={!sel.length || busy} onClick={async () => {
            setBusy(true);
            await onPick(list.filter(s => sel.includes(s.id)).map(s => ({ id: s.id, name: s.name })));
            setBusy(false); setSel([]);
          }}>{label} {sel.length || ""}</button>
        </>
      ))}
    </div>
  );
}

/** ISO time → value for a datetime-local input (in this device's time zone). */
export function toLocalInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
