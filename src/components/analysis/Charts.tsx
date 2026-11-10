"use client";
import Link from "next/link";

/** Shared pieces for every analysis page (admin, staff, parent, student), in the school's colours. */

export type Count = { key: string; count: number };
export type Note = { tone: "bad" | "warn" | "good"; text: string; href?: string | null };

export const num = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString());
export const per = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n}%`);
export const MONTH = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString(undefined, { month: "short", timeZone: "UTC" });

export function tone(v: number | null | undefined, good: number, bad: number): "good" | "warn" | "bad" | undefined {
  if (v === null || v === undefined) return undefined;
  return v >= good ? "good" : v < bad ? "bad" : "warn";
}

export function Card({ title, href, children, id }: { title: string; href?: string; children: React.ReactNode; id?: string }) {
  return (
    <section className="card p-5" id={id}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        {href && <Link href={href} className="text-xs font-medium text-brand-700 hover:underline">Open →</Link>}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export function Figure({ label, value, href, hint }: { label: string; value: React.ReactNode; href?: string; hint?: string }) {
  const body = <><p className="text-xs text-slate-500">{label}</p><p className="mt-0.5 font-semibold tabular-nums text-slate-900">{value}</p>{hint && <p className="text-[11px] text-slate-500">{hint}</p>}</>;
  return href ? <Link href={href} className="rounded-md bg-brand-50/60 p-2 hover:bg-brand-50">{body}</Link> : <div className="rounded-md bg-brand-50/60 p-2">{body}</div>;
}

export function Figures({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">{children}</div>;
}

/** Horizontal bars, longest first, in the school's colour. `suffix` for percentages. */
export function Bars({ title, rows, suffix = "", max }: { title: string; rows: Count[]; suffix?: string; max?: number }) {
  if (!rows.length) return null;
  const top = max ?? Math.max(...rows.map(r => r.count), 1);
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-slate-500">{title}</p>
      <ul className="space-y-1">
        {rows.map(r => (
          <li key={r.key} className="grid grid-cols-[minmax(0,9rem)_1fr_3.5rem] items-center gap-2 text-xs">
            <span className="truncate text-slate-700" title={r.key}>{r.key}</span>
            <span className="h-2.5 rounded-full bg-slate-100"><span className="block h-full rounded-full bg-brand-600" style={{ width: `${Math.min(100, (r.count / top) * 100)}%` }} /></span>
            <span className="text-right tabular-nums text-slate-600">{r.count.toLocaleString()}{suffix}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Vertical columns over time, in the school's colour. */
export function Columns({ rows, max, title, empty }: { rows: { label: string; value: number; text: string }[]; max?: number; title?: string; empty?: string }) {
  if (!rows.length) return empty ? <p className="text-sm text-slate-500">{empty}</p> : null;
  const top = max ?? Math.max(...rows.map(r => r.value), 1);
  // A few columns: each is labelled with its value and name, and kept to a sensible width.
  const few = rows.length <= 8;
  return (
    <div>
      {title && <p className="mb-1.5 text-xs font-medium text-slate-500">{title}</p>}
      <div className={"flex h-32 items-end " + (few ? "gap-3" : "gap-1")} role="img" aria-label={title ?? "Chart"}>
        {rows.map((r, i) => (
          <div key={i} className={"group relative flex h-full flex-col justify-end " + (few ? "max-w-24 flex-1" : "flex-1")} title={`${r.label}: ${r.text}`}>
            {few && <span className="mb-0.5 text-center text-[11px] font-medium tabular-nums text-slate-700">{r.text}</span>}
            <div className="rounded-t bg-brand-500 transition-colors group-hover:bg-brand-700" style={{ height: `${Math.max(2, (r.value / top) * 85)}%` }} />
          </div>
        ))}
      </div>
      {few
        ? <div className="mt-1 flex gap-3 text-[10px] text-slate-500">{rows.map((r, i) => <span key={i} className="max-w-24 flex-1 truncate text-center" title={r.label}>{r.label}</span>)}</div>
        : <div className="mt-1 flex justify-between text-[10px] text-slate-400"><span>{rows[0]!.label}</span><span>{rows[rows.length - 1]!.label}</span></div>}
    </div>
  );
}

/** Shares of a whole, as one bar in shades of the school's colour. */
export function Split({ title, rows }: { title: string; rows: Count[] }) {
  const total = rows.reduce((s, r) => s + r.count, 0);
  if (!total) return null;
  const shades = ["bg-brand-700", "bg-brand-400", "bg-brand-200", "bg-slate-300", "bg-slate-200"];
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-slate-500">{title}</p>
      <div className="flex h-3 overflow-hidden rounded-full">{rows.map((r, i) => <span key={r.key} className={shades[i % shades.length]} style={{ width: `${(r.count / total) * 100}%` }} />)}</div>
      <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        {rows.map((r, i) => <li key={r.key} className="flex items-center gap-1.5"><span className={"h-2 w-2 rounded-full " + shades[i % shades.length]} />{r.key.replace(/_/g, " ")}: {r.count.toLocaleString()} ({Math.round((r.count / total) * 100)}%)</li>)}
      </ul>
    </div>
  );
}

/** Plain-English points worth knowing, worst first. */
export function Notes({ title = "Worth knowing", notes }: { title?: string; notes: Note[] }) {
  if (!notes.length) return null;
  return (
    <section className="card mb-5 p-5">
      <h2 className="mb-3 font-semibold">{title}</h2>
      <ul className="space-y-2">
        {notes.map((h, i) => (
          <li key={i} className="flex items-start gap-3 text-sm">
            <span aria-hidden className={"mt-1.5 h-2 w-2 shrink-0 rounded-full " + (h.tone === "bad" ? "bg-rose-600" : h.tone === "warn" ? "bg-amber-500" : "bg-emerald-500")} />
            <span className="flex-1">{h.text}</span>
            {h.href && h.tone !== "good" && <Link href={h.href} className="text-xs font-medium text-brand-700 hover:underline">Open →</Link>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A small table: label, figures. */
export function Table({ head, rows, empty }: { head: string[]; rows: (string | number | React.ReactNode)[][]; empty?: string }) {
  if (!rows.length) return empty ? <p className="text-sm text-slate-500">{empty}</p> : null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-slate-500"><tr>{head.map((h, i) => <th key={i} className={"py-1.5 font-medium " + (i ? "text-right" : "")}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-slate-100">{r.map((c, j) => <td key={j} className={"py-1.5 " + (j ? "text-right tabular-nums" : "")}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
