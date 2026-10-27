"use client";
import { useState } from "react";
import {
  ELEMENTS, CATEGORY_LABELS, IONS, REACTIVITY_SERIES, ELECTRODE_POTENTIALS, SOLUBILITY_RULES, CHEM_CONSTANTS,
  PHYSICS_CONSTANTS, SI_PREFIXES, PHYSICS_FORMULAE, MATH_FORMULAE, UNIT_CATEGORIES, convertUnit, MATH_SYMBOLS, LANGUAGE_CHARACTERS,
  type Element, type ElementCategory, type FormulaGroup
} from "@/lib/exams/reference-data";
import { formatResult } from "@/lib/exams/calc";

const CAT_STYLE: Record<ElementCategory, string> = {
  alkali: "bg-rose-100 border-rose-300", alkaline: "bg-orange-100 border-orange-300", transition: "bg-amber-50 border-amber-300",
  post_transition: "bg-teal-50 border-teal-300", metalloid: "bg-lime-100 border-lime-300", nonmetal: "bg-sky-100 border-sky-300",
  halogen: "bg-cyan-100 border-cyan-400", noble: "bg-indigo-50 border-indigo-300", lanthanide: "bg-pink-50 border-pink-300", actinide: "bg-fuchsia-50 border-fuchsia-300"
};

export function PeriodicTable() {
  const [sel, setSel] = useState<Element | null>(ELEMENTS[0]);
  const cell = (e: Element) => (
    <button key={e.z} type="button" onClick={() => setSel(e)} title={e.name} aria-label={`${e.name}, ${e.z}`}
      className={"flex h-10 w-full min-w-0 flex-col items-center justify-center rounded border text-center leading-none " + CAT_STYLE[e.category] + (sel?.z === e.z ? " ring-2 ring-brand-600" : "")}>
      <span className="text-[8px] text-slate-500">{e.z}</span><span className="text-xs font-bold">{e.symbol}</span>
    </button>
  );
  const main = ELEMENTS.filter(e => e.group !== null);
  const fRow = (period: number) => ELEMENTS.filter(e => e.group === null && e.period === period);
  return (
    <div className="w-[min(94vw,820px)]">
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: "repeat(18, minmax(0, 1fr))" }}>
        {Array.from({ length: 7 }, (_, p) => Array.from({ length: 18 }, (_, g) => {
          const e = main.find(x => x.period === p + 1 && x.group === g + 1);
          if (e) return cell(e);
          if (g === 2 && p >= 5) return <div key={`f${p}`} className="flex h-10 items-center justify-center rounded border border-dashed border-slate-300 text-[9px] text-slate-500">{p === 5 ? "57–71" : "89–103"}</div>;
          return <div key={`${p}-${g}`} />;
        }))}
      </div>
      <div className="mt-2 grid gap-[3px]" style={{ gridTemplateColumns: "repeat(18, minmax(0, 1fr))" }}>
        <div className="col-span-3" />{fRow(6).map(cell)}
        <div className="col-span-3" />{fRow(7).map(cell)}
      </div>
      {sel && (
        <div className="mt-3 grid gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm sm:grid-cols-4">
          <div className="text-3xl font-bold">{sel.symbol}<span className="ml-2 align-middle text-base font-normal">{sel.name}</span></div>
          <div><span className="text-xs text-slate-500">Atomic number</span><br />{sel.z}</div>
          <div><span className="text-xs text-slate-500">Relative atomic mass</span><br />{sel.mass}</div>
          <div><span className="text-xs text-slate-500">{sel.group ? `Group ${sel.group}, period ${sel.period}` : `Period ${sel.period}`}</span><br />{CATEGORY_LABELS[sel.category]}{sel.shells ? ` · ${sel.shells}` : ""}</div>
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-2 text-[10px]">{(Object.keys(CATEGORY_LABELS) as ElementCategory[]).map(c => <span key={c} className={"rounded border px-1.5 py-0.5 " + CAT_STYLE[c]}>{CATEGORY_LABELS[c]}</span>)}</div>
    </div>
  );
}

function Tabs({ tabs, children }: { tabs: string[]; children: (t: string) => React.ReactNode }) {
  const [t, setT] = useState(tabs[0]);
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1">{tabs.map(x => <button key={x} type="button" onClick={() => setT(x)} className={"rounded-full px-3 py-1 text-xs " + (t === x ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200")}>{x}</button>)}</div>
      <div className="max-h-[56vh] overflow-auto">{children(t)}</div>
    </div>
  );
}

const Pairs = ({ rows }: { rows: [string, string][] }) => (
  <table className="w-full text-sm"><tbody>{rows.map(([a, b]) => <tr key={a} className="border-b border-slate-100"><td className="py-1 pr-3">{a}</td><td className="py-1 font-medium">{b}</td></tr>)}</tbody></table>
);

function Formulae({ groups }: { groups: FormulaGroup[] }) {
  return (
    <Tabs tabs={groups.map(g => g.title)}>
      {t => <ul className="space-y-1.5 text-sm">{groups.find(g => g.title === t)!.items.map(([f, n]) => <li key={f} className="rounded bg-slate-50 px-2 py-1.5"><span className="font-medium">{f}</span>{n && <span className="ml-2 text-xs text-slate-500">{n}</span>}</li>)}</ul>}
    </Tabs>
  );
}

export function ChemistryData() {
  return (
    <div className="w-[min(92vw,560px)]">
      <Tabs tabs={["Ions", "Reactivity", "Electrode potentials", "Solubility", "Constants"]}>
        {t => t === "Ions" ? (
          <div className="grid gap-3 sm:grid-cols-2">{IONS.map(g => <div key={g.group}><p className="mb-1 text-xs font-semibold text-slate-500">{g.group}</p><Pairs rows={g.items} /></div>)}</div>
        ) : t === "Reactivity" ? (
          <ol className="space-y-1 text-sm">{REACTIVITY_SERIES.map((m, i) => <li key={m} className="flex gap-2"><span className="w-5 text-right text-slate-400">{i + 1}</span>{m}</li>)}<li className="pt-1 text-xs text-slate-500">Most reactive at the top. A metal displaces any metal below it from its salt solution.</li></ol>
        ) : t === "Electrode potentials" ? (
          <><Pairs rows={ELECTRODE_POTENTIALS.map(([a, b]) => [a, `${b} V`])} /><p className="mt-1 text-xs text-slate-500">Standard electrode potentials at 25 °C.</p></>
        ) : t === "Solubility" ? (
          <ul className="list-disc space-y-1 pl-5 text-sm">{SOLUBILITY_RULES.map(r => <li key={r}>{r}</li>)}</ul>
        ) : <Pairs rows={CHEM_CONSTANTS} />}
      </Tabs>
    </div>
  );
}

export function PhysicsData() {
  return (
    <div className="w-[min(92vw,580px)]">
      <Tabs tabs={["Constants", "SI prefixes", "Formulae"]}>
        {t => t === "Constants" ? <Pairs rows={PHYSICS_CONSTANTS} />
          : t === "SI prefixes" ? <Pairs rows={SI_PREFIXES.map(([n, s, v]) => [`${n} (${s})`, v])} />
          : <Formulae groups={PHYSICS_FORMULAE} />}
      </Tabs>
    </div>
  );
}

export function MathFormulae() {
  return <div className="w-[min(92vw,560px)]"><Formulae groups={MATH_FORMULAE} /></div>;
}

export function UnitConverter() {
  const [cat, setCat] = useState(UNIT_CATEGORIES[0].id);
  const units = UNIT_CATEGORIES.find(c => c.id === cat)!.units;
  const [from, setFrom] = useState(units[0].id);
  const [to, setTo] = useState(units[1].id);
  const [v, setV] = useState("1");
  let out = "";
  try { const n = Number(v); if (v.trim() && Number.isFinite(n)) out = formatResult(convertUnit(cat, n, from, to)); } catch { out = ""; }
  return (
    <div className="w-72 space-y-2 text-sm">
      <select className="input py-1" value={cat} aria-label="Quantity" onChange={e => { const u = UNIT_CATEGORIES.find(c => c.id === e.target.value)!.units; setCat(e.target.value); setFrom(u[0].id); setTo(u[1].id); }}>
        {UNIT_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
      <div className="flex gap-2"><input className="input py-1" value={v} onChange={e => setV(e.target.value)} aria-label="Value" data-exam-tool="1" /><select className="input py-1" value={from} onChange={e => setFrom(e.target.value)} aria-label="From">{units.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}</select></div>
      <div className="flex items-center gap-2"><span className="input bg-slate-50 py-1 font-mono">{out || "—"}</span><select className="input py-1" value={to} onChange={e => setTo(e.target.value)} aria-label="To">{units.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}</select></div>
    </div>
  );
}

/** Buttons that type into whichever answer box the student last used. */
export function CharacterPad({ groups, insert }: { groups: { group: string; chars: string[] }[]; insert: (s: string) => void }) {
  return (
    <div className="w-[min(92vw,420px)] space-y-2">
      {groups.map(g => (
        <div key={g.group}>
          <p className="mb-1 text-[11px] font-semibold text-slate-500">{g.group}</p>
          <div className="flex flex-wrap gap-1">{g.chars.map(ch => <button key={ch} type="button" onMouseDown={e => e.preventDefault()} onClick={() => insert(ch)} className="min-w-[34px] rounded border border-slate-200 bg-white px-2 py-1 text-base hover:bg-slate-50">{ch}</button>)}</div>
        </div>
      ))}
      <p className="text-[11px] text-slate-500">Click in an answer box first; characters go where the cursor is.</p>
    </div>
  );
}

export function MathSymbolsPad({ insert }: { insert: (s: string) => void }) {
  return <CharacterPad groups={MATH_SYMBOLS} insert={insert} />;
}
export function LanguagePad({ insert }: { insert: (s: string) => void }) {
  return <CharacterPad groups={LANGUAGE_CHARACTERS.map(l => ({ group: l.language, chars: l.chars }))} insert={insert} />;
}
