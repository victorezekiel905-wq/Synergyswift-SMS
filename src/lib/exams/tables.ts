/**
 * Mathematical tables for the exam tools, laid out like the printed
 * four-figure tables used in WAEC, NECO and BECE halls: a row label, ten
 * columns and nine "mean difference" columns. Values are computed, not typed
 * in, so they are always right. Pure functions, unit tested.
 */
export type TableId = "log" | "antilog" | "square" | "sqrt_1_10" | "sqrt_10_100" | "reciprocal" | "sin" | "cos" | "tan" | "log_sin" | "log_cos" | "log_tan";

export type FigureTable = {
  id: TableId;
  title: string;
  note: string;
  rowHead: string;
  columns: string[];
  rows: { label: string; values: string[]; diffs: (number | null)[]; subtract?: boolean }[];
};

export const TABLES: { id: TableId; title: string }[] = [
  { id: "log", title: "Logarithms" },
  { id: "antilog", title: "Antilogarithms" },
  { id: "square", title: "Squares" },
  { id: "sqrt_1_10", title: "Square roots (1 to 10)" },
  { id: "sqrt_10_100", title: "Square roots (10 to 100)" },
  { id: "reciprocal", title: "Reciprocals" },
  { id: "sin", title: "Natural sines" },
  { id: "cos", title: "Natural cosines" },
  { id: "tan", title: "Natural tangents" },
  { id: "log_sin", title: "Logarithms of sines" },
  { id: "log_cos", title: "Logarithms of cosines" },
  { id: "log_tan", title: "Logarithms of tangents" }
];

/** Four significant figures as printed: 2.534 → "2.534", 0.0123 → "0.01230", 123.4 → "123.4". */
export function fourFigures(v: number): string {
  if (!Number.isFinite(v)) return "∞";
  if (v === 0) return "0.0000";
  const digits = Math.max(0, 3 - Math.floor(Math.log10(Math.abs(v))));
  return v.toFixed(Math.min(digits, 6));
}

/** Mantissa of log10 as the four digits a log table prints: log 2.534 = 0.4038 → "4038". */
export function logMantissa(v: number): string {
  return String(Math.round((Math.log10(v) - Math.floor(Math.log10(v))) * 10000) % 10000).padStart(4, "0");
}

/** Bar notation for the characteristic of a log: log 0.02534 = -2 + 0.4038 → "2̄.4038". */
export function barLog(v: number): string {
  const l = Math.log10(v);
  const ch = Math.floor(l);
  const m = logMantissa(v);
  if (ch >= 0) return `${ch}.${m}`;
  return `${Math.abs(ch)}̄.${m}`;
}

/** Mean differences: how much to add for a 4th digit of 1 to 9, from the average step across the row. */
function meanDiffs(first: number, last: number, scale: number, perColumn = 10, count = 9): number[] {
  const step = Math.abs(last - first) / 9; // change per column
  return Array.from({ length: count }, (_, k) => Math.round(((step * (k + 1)) / perColumn) * scale));
}

/** Units of the last printed digit for four significant figures: 2.534 → 1000, 0.3946 → 10000, 25.34 → 100. */
const lastDigitScale = (v: number) => Math.pow(10, 3 - Math.floor(Math.log10(Math.abs(v))));

const COLS10 = Array.from({ length: 10 }, (_, k) => String(k));
const COLS_MIN = Array.from({ length: 10 }, (_, k) => `${k * 6}′`);

/** Builds a whole table. Natural trig tables use columns of 6 minutes (0.1°) and mean differences for 1′ to 5′. */
export function buildTable(id: TableId): FigureTable {
  const title = TABLES.find(t => t.id === id)?.title ?? id;
  const rows: FigureTable["rows"] = [];
  const num = (f: (x: number) => number, from: number, to: number, step: number, format: (v: number) => string, diffScale: number, label = (x: number) => x.toFixed(1)) => {
    for (let x = from; x <= to + 1e-9; x += step) {
      const r = Math.round(x * 100) / 100;
      const vals = Array.from({ length: 10 }, (_, k) => f(r + (k * step) / 10));
      rows.push({ label: label(r), values: vals.map(format), diffs: meanDiffs(vals[0], vals[9], diffScale || lastDigitScale(vals[5])) });
    }
  };
  const trig = (f: (deg: number) => number, format: (v: number) => string, diffScale: number, subtract = false) => {
    for (let d = 0; d < 90; d++) {
      const vals = Array.from({ length: 10 }, (_, k) => f(d + k / 10));
      const md = meanDiffs(vals[0], vals[9], diffScale, 6, 5); // per minute: a column is 6′
      rows.push({ label: `${d}°`, values: vals.map(format), diffs: [...md, null, null, null, null], subtract });
    }
  };
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const logFmt = (v: number) => (v <= 0 || !Number.isFinite(v) ? "–∞" : barLog(v));
  switch (id) {
    case "log":
      num(Math.log10, 1, 9.9, 0.1, v => String(Math.round(v * 10000) % 10000).padStart(4, "0"), 10000, x => String(Math.round(x * 10)));
      return { id, title, rowHead: "x", columns: COLS10, rows, note: "Gives the decimal part (mantissa) of log₁₀ for numbers 1.000 to 9.999. Row 25, column 3, mean difference 4 is 2.534. Add the whole-number part from the position of the decimal point." };
    case "antilog":
      num(x => Math.pow(10, x), 0, 0.99, 0.01, v => fourFigures(v).replace(".", "").slice(0, 4).padEnd(4, "0"), 0, x => x.toFixed(2).slice(1));
      return { id, title, rowHead: "x", columns: COLS10, rows, note: "Gives the digits of 10ˣ for decimal parts .0000 to .9999. Place the decimal point using the whole-number part of the logarithm." };
    case "square":
      num(x => x * x, 1, 9.9, 0.1, fourFigures, 0);
      return { id, title, rowHead: "x", columns: COLS10, rows, note: "x² for x from 1.000 to 9.999. For 25.34², look up 2.534 and multiply by 100." };
    case "sqrt_1_10":
      num(Math.sqrt, 1, 9.9, 0.1, fourFigures, 0);
      return { id, title, rowHead: "x", columns: COLS10, rows, note: "√x for x from 1.000 to 9.999. Use for numbers with an odd number of digits before the point (2.534, 253.4)." };
    case "sqrt_10_100":
      num(Math.sqrt, 10, 99, 1, fourFigures, 0, x => String(Math.round(x)));
      return { id, title, rowHead: "x", columns: COLS10, rows, note: "√x for x from 10.00 to 99.99. Use for numbers with an even number of digits before the point (25.34, 2534)." };
    case "reciprocal":
      num(x => 1 / x, 1, 9.9, 0.1, fourFigures, 0);
      for (const r of rows) r.subtract = true;
      return { id, title, rowHead: "x", columns: COLS10, rows, note: "1/x for x from 1.000 to 9.999. Subtract the mean differences. For 1/25.34, look up 2.534 and divide by 10." };
    case "sin":
      trig(d => Math.sin(rad(d)), v => v.toFixed(4), 10000);
      return { id, title, rowHead: "Degrees", columns: COLS_MIN, rows, note: "sin θ for 0° to 89.9°. Columns are minutes (6′ = 0.1°); mean differences are for 1′ to 5′." };
    case "cos":
      trig(d => Math.cos(rad(d)), v => v.toFixed(4), 10000, true);
      return { id, title, rowHead: "Degrees", columns: COLS_MIN, rows, note: "cos θ for 0° to 89.9°. Subtract the mean differences, because cosine falls as the angle grows." };
    case "tan":
      trig(d => Math.tan(rad(d)), v => (v >= 10 ? v.toFixed(2) : v.toFixed(4)), 10000);
      return { id, title, rowHead: "Degrees", columns: COLS_MIN, rows, note: "tan θ for 0° to 89.9°. Mean differences are less reliable near 90°; read the nearest column there." };
    case "log_sin":
      trig(d => Math.sin(rad(d)), logFmt, 10000);
      for (const r of rows) r.diffs = [null, null, null, null, null, null, null, null, null];
      return { id, title, rowHead: "Degrees", columns: COLS_MIN, rows, note: "log₁₀ sin θ in bar notation (2̄.4038 means −2 + 0.4038)." };
    case "log_cos":
      trig(d => Math.cos(rad(d)), logFmt, 10000, true);
      for (const r of rows) r.diffs = [null, null, null, null, null, null, null, null, null];
      return { id, title, rowHead: "Degrees", columns: COLS_MIN, rows, note: "log₁₀ cos θ in bar notation." };
    case "log_tan":
      trig(d => Math.tan(rad(d)), logFmt, 10000);
      for (const r of rows) r.diffs = [null, null, null, null, null, null, null, null, null];
      return { id, title, rowHead: "Degrees", columns: COLS_MIN, rows, note: "log₁₀ tan θ in bar notation." };
  }
}

/** Standard normal cumulative probability Φ(z) (Abramowitz and Stegun 26.2.17, error under 7.5e-8). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

/** Φ(z) table for z = 0.00 to 3.99: rows by tenths, columns by hundredths. */
export function normalTable(): { rows: { label: string; values: string[] }[]; columns: string[] } {
  const rows = [];
  for (let r = 0; r < 40; r++) {
    const z = r / 10;
    rows.push({ label: z.toFixed(1), values: Array.from({ length: 10 }, (_, k) => normalCdf(z + k / 100).toFixed(4)) });
  }
  return { rows, columns: Array.from({ length: 10 }, (_, k) => `.0${k}`) };
}
