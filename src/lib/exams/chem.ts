/**
 * Chemical equations for the chemistry question type: parsing, atom and
 * charge balance, and comparing a student's equation with the key.
 * Pure functions, unit tested.
 *
 * Accepts "2H2 + O2 -> 2H2O", "CaCO3(s) → CaO(s) + CO2(g)",
 * "Fe^3+ + 3OH^- -> Fe(OH)3", "N2 + 3H2 ⇌ 2NH3", unicode subscripts (H₂O)
 * and superscripts (Fe³⁺), and hydrates written with a dot (CuSO4.5H2O).
 */
export type Species = { coef: number; formula: string; charge: number; state: string | null };
export type Equation = { left: Species[]; right: Species[]; reversible: boolean };

const SUB = "₀₁₂₃₄₅₆₇₈₉", SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const ARROW = /\s*(<=>|<->|⇌|⇄|->|→|⟶|=>|=)\s*/;

function plainDigits(s: string) {
  return s
    .replace(/[₀-₉]/g, c => String(SUB.indexOf(c)))
    // Superscript charges become caret form: Fe³⁺ → Fe^3+, OH⁻ → OH^-.
    .replace(/([⁰¹²³⁴-⁹]*)([⁺⁻])/g, (_m, d: string, sign: string) => `^${[...d].map(c => SUP.indexOf(c)).join("")}${sign === "⁺" ? "+" : "-"}`)
    .replace(/[⁰¹²³⁴-⁹]/g, c => String(SUP.indexOf(c)))
    .replace(/[·•]/g, ".");
}

/** Splits "Fe^3+" / "Fe3+" written as a charge, "SO4^2-", "OH-", "e-" into formula and charge. */
function splitCharge(raw: string): { formula: string; charge: number } {
  let s = raw;
  const caret = /\^(\d*)([+-])$/.exec(s);
  if (caret) return { formula: s.slice(0, caret.index), charge: (caret[2] === "-" ? -1 : 1) * Number(caret[1] || 1) };
  const trail = /([+-]+)$/.exec(s);
  if (trail && trail.index > 0) {
    s = s.slice(0, trail.index);
    const sign = trail[1][0] === "-" ? -1 : 1;
    return { formula: s, charge: sign * trail[1].length };
  }
  return { formula: s, charge: 0 };
}

export function parseSpecies(raw: string): Species {
  let s = plainDigits(String(raw ?? "").trim()).replace(/\s+/g, "");
  if (!s) throw new Error("missing substance");
  let state: string | null = null;
  const st = /\((s|l|g|aq)\)$/i.exec(s);
  if (st) { state = st[1].toLowerCase(); s = s.slice(0, st.index); }
  const c = /^(\d+(?:\/\d+)?|\d*\.\d+)(?=[A-Z(\[e])/.exec(s);
  let coef = 1;
  if (c) {
    coef = c[1].includes("/") ? Number(c[1].split("/")[0]) / Number(c[1].split("/")[1]) : Number(c[1]);
    s = s.slice(c[0].length);
  }
  const { formula, charge } = splitCharge(s);
  if (!formula || !/^(e|[A-Z(\[][A-Za-z0-9()\[\].]*)$/.test(formula)) throw new Error(`cannot read "${raw}"`);
  return { coef, formula, charge, state };
}

/** Splits one side on "+" signs that join substances (not the "+" of a charge such as Na+ or Fe^3+). */
function splitSide(side: string): string[] {
  const out: string[] = [];
  let cur = "";
  const s = plainDigits(side);
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
    if (ch === "+") {
      // A charge sits right after the formula and is followed by a space, another plus or the end (Na+ + Cl-, Fe^3+).
      // A joining plus has a space before it or a new substance straight after it (H2 + O2, H2+O2).
      const prev = s[k - 1] ?? "", next = s[k + 1];
      const charge = Boolean(prev) && !/\s/.test(prev) && (next === undefined || /[\s+)]/.test(next));
      if (charge) { cur += ch; continue; }
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function parseEquation(text: string): Equation {
  const t = String(text ?? "").trim();
  const m = ARROW.exec(t);
  if (!m) throw new Error("an equation needs an arrow (→)");
  const lhs = t.slice(0, m.index), rhs = t.slice(m.index + m[0].length);
  if (ARROW.test(rhs)) throw new Error("use only one arrow");
  const left = splitSide(lhs).map(parseSpecies), right = splitSide(rhs).map(parseSpecies);
  if (!left.length || !right.length) throw new Error("both sides need at least one substance");
  return { left, right, reversible: /<=>|<->|⇌|⇄/.test(m[1]) };
}

/** Atom counts for a formula such as Ca(OH)2, K4[Fe(CN)6] or CuSO4.5H2O. Electrons ("e") count nothing. */
export function atomCounts(formula: string): Record<string, number> {
  if (formula === "e") return {};
  const parts = formula.split(".");
  const total: Record<string, number> = {};
  for (const part of parts) {
    const lead = /^(\d+)/.exec(part);
    const mult = lead ? Number(lead[1]) : 1;
    const counts = groupCounts(lead ? part.slice(lead[0].length) : part);
    for (const [el, n] of Object.entries(counts)) total[el] = (total[el] ?? 0) + n * mult;
  }
  return total;
}

function groupCounts(f: string): Record<string, number> {
  let i = 0;
  function group(close?: string): Record<string, number> {
    const out: Record<string, number> = {};
    while (i < f.length) {
      const ch = f[i];
      if (ch === "(" || ch === "[") {
        i++;
        const inner = group(ch === "(" ? ")" : "]");
        const n = num();
        for (const [el, c] of Object.entries(inner)) out[el] = (out[el] ?? 0) + c * n;
        continue;
      }
      if (ch === ")" || ch === "]") {
        if (ch !== close) throw new Error("brackets do not match");
        i++;
        return out;
      }
      const m = /^[A-Z][a-z]?/.exec(f.slice(i));
      if (!m) throw new Error(`cannot read "${f}"`);
      i += m[0].length;
      out[m[0]] = (out[m[0]] ?? 0) + num();
    }
    if (close) throw new Error("brackets do not match");
    return out;
  }
  function num() {
    const m = /^\d+/.exec(f.slice(i));
    if (!m) return 1;
    i += m[0].length;
    return Number(m[0]);
  }
  return group();
}

function sideTotals(side: Species[]) {
  const atoms: Record<string, number> = {};
  let charge = 0;
  for (const sp of side) {
    for (const [el, n] of Object.entries(atomCounts(sp.formula))) atoms[el] = (atoms[el] ?? 0) + n * sp.coef;
    charge += (sp.formula === "e" ? -1 : sp.charge) * sp.coef;
  }
  return { atoms, charge };
}

/** True when atoms of every element, and total charge, are the same on both sides. */
export function isBalanced(eq: Equation): boolean {
  const l = sideTotals(eq.left), r = sideTotals(eq.right);
  const els = new Set([...Object.keys(l.atoms), ...Object.keys(r.atoms)]);
  for (const el of els) if (Math.abs((l.atoms[el] ?? 0) - (r.atoms[el] ?? 0)) > 1e-9) return false;
  return Math.abs(l.charge - r.charge) < 1e-9;
}

const key = (sp: Species, withState: boolean) => `${sp.formula}|${sp.charge}${withState ? `|${sp.state ?? ""}` : ""}`;

function sideMap(side: Species[], withState: boolean) {
  const m = new Map<string, number>();
  for (const sp of side) m.set(key(sp, withState), (m.get(key(sp, withState)) ?? 0) + sp.coef);
  return m;
}

function sameSpecies(a: Map<string, number>, b: Map<string, number>) {
  if (a.size !== b.size) return false;
  for (const k of a.keys()) if (!b.has(k)) return false;
  return true;
}

function ratioOf(a: Map<string, number>, b: Map<string, number>): number | null {
  let r: number | null = null;
  for (const [k, v] of a) {
    const x = (b.get(k) ?? 0) / v;
    if (r === null) r = x;
    else if (Math.abs(r - x) > 1e-9) return null;
  }
  return r;
}

export type ChemCompare = { species: boolean; coefficients: boolean; balanced: boolean };

/**
 * Compares a student's equation with the key. Order of substances does not
 * matter. `species` = the right substances on the right sides; `coefficients`
 * = the same numbers (or a whole multiple when `acceptMultiples`).
 */
export function compareEquations(student: string, keyEq: string, opts: { states?: boolean; acceptMultiples?: boolean } = {}): ChemCompare {
  let s: Equation;
  try { s = parseEquation(student); } catch { return { species: false, coefficients: false, balanced: false }; }
  const k = parseEquation(keyEq);
  const st = Boolean(opts.states);
  const sl = sideMap(s.left, st), sr = sideMap(s.right, st), kl = sideMap(k.left, st), kr = sideMap(k.right, st);
  const species = sameSpecies(sl, kl) && sameSpecies(sr, kr);
  const balanced = isBalanced(s);
  if (!species) return { species, coefficients: false, balanced };
  const rl = ratioOf(kl, sl), rr = ratioOf(kr, sr);
  const exact = rl === 1 && rr === 1;
  const multiple = rl !== null && rr !== null && Math.abs(rl - rr) < 1e-9 && rl > 0 && Number.isInteger(Math.round(rl * 1e9) / 1e9);
  return { species, coefficients: exact || (Boolean(opts.acceptMultiples) && multiple), balanced };
}

/** "2H2O" → [["2", false], ["H", false], ["2", true], ["O", false]]: digits after letters become subscripts for display. */
export function formatFormula(text: string): { t: string; sub?: boolean; sup?: boolean }[] {
  const out: { t: string; sub?: boolean; sup?: boolean }[] = [];
  const s = plainDigits(String(text ?? ""));
  let k = 0;
  while (k < s.length) {
    const caret = /^\^(\d*[+-])/.exec(s.slice(k));
    if (caret) { out.push({ t: caret[1], sup: true }); k += caret[0].length; continue; }
    const ch = s[k];
    const prev = s[k - 1] ?? "";
    if (/\d/.test(ch) && /[A-Za-z)\]]/.test(prev)) {
      const m = /^\d+/.exec(s.slice(k))!;
      out.push({ t: m[0], sub: true });
      k += m[0].length;
      continue;
    }
    out.push({ t: ch });
    k++;
  }
  return out;
}
/** Buttons for the chemical-equation answer box. */
export const CHEM_KEYS: [string, string][] = [["→", " → "], ["⇌", " ⇌ "], ["+", " + "], ["(s)", "(s)"], ["(l)", "(l)"], ["(g)", "(g)"], ["(aq)", "(aq)"], ["charge ⁺", "^+"], ["charge ⁻", "^-"], ["²⁺", "^2+"], ["³⁺", "^3+"], ["²⁻", "^2-"], ["e⁻", "e^-"], ["·", "."]];
