"use client";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui";

export type Person = { type: "Student" | "Family" | "Staff"; id: string; title: string; detail?: string | null };

/** Search students, families and staff by name and collect a list. */
export default function PeoplePicker({ value, onChange, types = ["Student", "Family", "Staff"], placeholder = "Search by name" }:
  { value: Person[]; onChange: (p: Person[]) => void; types?: Person["type"][]; placeholder?: string }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Person[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`).then(x => x.json()).catch(() => ({ results: [] }));
      setHits((r.results ?? []).filter((h: Person) => types.includes(h.type)));
    }, 250);
    return () => clearTimeout(t);
  }, [q, types]);
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">{value.map(p => (
        <span key={p.type + p.id} className="flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs">{p.title} <Badge tone="slate">{p.type}</Badge>
          <button type="button" aria-label={`Remove ${p.title}`} onClick={() => onChange(value.filter(x => !(x.id === p.id && x.type === p.type)))}>×</button></span>))}</div>
      <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} aria-label="Search people" />
      {hits.length > 0 && <ul className="max-h-40 overflow-y-auto rounded border border-slate-200 text-sm">{hits.map(h => (
        <li key={h.type + h.id}><button type="button" className="w-full px-2 py-1 text-left hover:bg-slate-50" onClick={() => { if (!value.some(v => v.id === h.id && v.type === h.type)) onChange([...value, h]); setQ(""); setHits([]); }}>
          {h.title} <span className="text-xs text-slate-500">{h.type}{h.detail ? ` · ${h.detail}` : ""}</span></button></li>))}</ul>}
    </div>
  );
}
