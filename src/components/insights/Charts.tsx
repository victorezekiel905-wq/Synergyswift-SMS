"use client";

/** Monthly bars, one or two series side by side, with month labels. */
export function MonthBars({ series, format = (v: number) => String(v), height = 140 }: {
  series: { label: string; color: string; points: { month: string; value: number }[] }[];
  format?: (v: number) => string; height?: number;
}) {
  const months = series[0]?.points.map(p => p.month) ?? [];
  const max = Math.max(1, ...series.flatMap(s => s.points.map(p => p.value)));
  const w = 100 / Math.max(1, months.length);
  const bw = (w * 0.8) / Math.max(1, series.length);
  const name = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleString("en-GB", { month: "short" });
  return (
    <div>
      <svg viewBox={`0 0 100 ${height / 3}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label={series.map(s => s.label).join(" and ") + " by month"}>
        {months.map((m, i) => series.map((s, j) => {
          const v = s.points[i]?.value ?? 0;
          const h = (v / max) * (height / 3 - 2);
          return <rect key={`${m}-${j}`} x={i * w + w * 0.1 + j * bw} y={height / 3 - h} width={bw * 0.92} height={h} fill={s.color}><title>{`${name(m)} ${m.slice(0, 4)} · ${s.label}: ${format(v)}`}</title></rect>;
        }))}
      </svg>
      <div className="mt-1 flex text-[10px] text-slate-500">{months.map(m => <span key={m} className="flex-1 text-center">{name(m)}</span>)}</div>
      <div className="mt-1 flex flex-wrap gap-3 text-xs">{series.map(s => <span key={s.label} className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />{s.label}</span>)}</div>
    </div>
  );
}

const BAND_COLORS = ["#059669", "#34d399", "#fbbf24", "#fb923c", "#e11d48"];
/** A stacked bar of how many scores fell in each band. */
export function BandBar({ bands }: { bands: Record<string, number> }) {
  const entries = Object.entries(bands);
  const total = entries.reduce((a, [, n]) => a + n, 0) || 1;
  return (
    <div className="flex h-3 w-full min-w-[80px] overflow-hidden rounded bg-slate-100" title={entries.map(([b, n]) => `${b}: ${n}`).join(" · ")}>
      {entries.map(([b, n], i) => n ? <div key={b} style={{ width: `${(n / total) * 100}%`, background: BAND_COLORS[i] }} /> : null)}
    </div>
  );
}
export function BandKey({ bands }: { bands: string[] }) {
  return <div className="flex flex-wrap gap-3 text-xs text-slate-500">{bands.map((b, i) => <span key={b} className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: BAND_COLORS[i] }} />{b}</span>)}</div>;
}

/** Cell colour for an average score. */
export function heat(v: number | null | undefined) {
  if (v === null || v === undefined) return "";
  if (v >= 70) return "bg-emerald-100";
  if (v >= 60) return "bg-emerald-50";
  if (v >= 50) return "bg-amber-50";
  if (v >= 40) return "bg-orange-100";
  return "bg-rose-100";
}
