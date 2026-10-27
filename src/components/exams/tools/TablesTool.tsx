"use client";
import { useMemo, useState } from "react";
import { TABLES, buildTable, normalTable, type TableId } from "@/lib/exams/tables";

/** Four-figure tables laid out like the printed booklet, with a row highlighter. */
export function FourFigureTables() {
  const [id, setId] = useState<TableId>("log");
  const [hl, setHl] = useState<string | null>(null);
  const [jump, setJump] = useState("");
  const t = useMemo(() => buildTable(id), [id]);
  const target = t.rows.find(r => r.label.replace("°", "") === jump.trim());
  return (
    <div className="w-[min(92vw,760px)]">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <select className="input w-auto py-1 text-sm" value={id} onChange={e => { setId(e.target.value as TableId); setHl(null); }} aria-label="Table">
          {TABLES.map(x => <option key={x.id} value={x.id}>{x.title}</option>)}
        </select>
        <input className="input w-28 py-1 text-sm" placeholder="Go to row" value={jump} onChange={e => setJump(e.target.value)} aria-label="Go to row"
          onKeyDown={e => { if (e.key === "Enter" && target) { setHl(target.label); document.getElementById(`tbl-${target.label}`)?.scrollIntoView({ block: "center" }); } }} data-exam-tool="1" />
      </div>
      <p className="mb-2 text-xs text-slate-600">{t.note}</p>
      <div className="max-h-[52vh] overflow-auto rounded border border-slate-200">
        <table className="w-full border-collapse font-mono text-[11px] tabular-nums">
          <thead className="sticky top-0 bg-slate-100">
            <tr>
              <th className="border-b border-slate-300 px-1.5 py-1 text-left">{t.rowHead}</th>
              {t.columns.map(c => <th key={c} className="border-b border-slate-300 px-1.5 py-1">{c}</th>)}
              <th className="border-b border-l-2 border-slate-300 px-1 py-1 text-slate-500" colSpan={9}>Mean differences {t.rows[0]?.subtract ? "(subtract)" : "(add)"}</th>
            </tr>
            <tr className="text-slate-500">
              <th /><th colSpan={10} />
              {Array.from({ length: 9 }, (_, k) => <th key={k} className={"px-1 font-normal " + (k === 0 ? "border-l-2 border-slate-300" : "")}>{id === "sin" || id === "cos" || id === "tan" ? (k < 5 ? `${k + 1}′` : "") : k + 1}</th>)}
            </tr>
          </thead>
          <tbody>
            {t.rows.map(r => (
              <tr key={r.label} id={`tbl-${r.label}`} onClick={() => setHl(hl === r.label ? null : r.label)}
                className={"cursor-pointer " + (hl === r.label ? "bg-amber-100" : "odd:bg-white even:bg-slate-50 hover:bg-sky-50")}>
                <td className="px-1.5 py-0.5 font-semibold">{r.label}</td>
                {r.values.map((v, i) => <td key={i} className="px-1.5 py-0.5 text-center">{v}</td>)}
                {r.diffs.map((v, i) => <td key={i} className={"px-1 py-0.5 text-center text-slate-500 " + (i === 0 ? "border-l-2 border-slate-300" : "")}>{v ?? ""}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">Click a row to highlight it while you read across.</p>
    </div>
  );
}

export function NormalTable() {
  const t = useMemo(() => normalTable(), []);
  const [hl, setHl] = useState<string | null>(null);
  return (
    <div className="w-[min(92vw,560px)]">
      <p className="mb-2 text-xs text-slate-600">Φ(z) = P(Z ≤ z) for the standard normal distribution. Row = z to one decimal place, column = second decimal place. For negative z use Φ(−z) = 1 − Φ(z).</p>
      <div className="max-h-[52vh] overflow-auto rounded border border-slate-200">
        <table className="w-full border-collapse font-mono text-[11px] tabular-nums">
          <thead className="sticky top-0 bg-slate-100"><tr><th className="px-1.5 py-1 text-left">z</th>{t.columns.map(c => <th key={c} className="px-1.5 py-1">{c}</th>)}</tr></thead>
          <tbody>
            {t.rows.map(r => (
              <tr key={r.label} onClick={() => setHl(hl === r.label ? null : r.label)} className={"cursor-pointer " + (hl === r.label ? "bg-amber-100" : "odd:bg-white even:bg-slate-50 hover:bg-sky-50")}>
                <td className="px-1.5 py-0.5 font-semibold">{r.label}</td>{r.values.map((v, i) => <td key={i} className="px-1.5 py-0.5 text-center">{v}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
