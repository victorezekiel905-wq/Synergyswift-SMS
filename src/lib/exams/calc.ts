/**
 * Calculator engine for the exam tools: scientific calculator, basic
 * calculator and graph plotter. A small recursive-descent parser; never uses
 * eval. Pure functions, unit tested.
 *
 * Supports + - * / ^ ( ), implicit multiplication (2pi, 3(4), 2x), postfix !
 * and %, scientific notation (6.02e23, 6.02E23), the constants pi, π and e, the
 * variables x and Ans, and the functions below. nCr(n,r) and nPr(n,r) take two
 * arguments.
 */
export type AngleMode = "deg" | "rad";
export type CalcEnv = { angle?: AngleMode; x?: number; ans?: number };

const FACT_LIMIT = 170;

export function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0) throw new Error("factorial needs a whole number");
  if (n > FACT_LIMIT) throw new Error("number too large");
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

export function nCr(n: number, r: number): number {
  if (![n, r].every(Number.isInteger) || n < 0 || r < 0 || r > n) throw new Error("nCr needs whole numbers with r ≤ n");
  let out = 1;
  for (let i = 1; i <= Math.min(r, n - r); i++) out = (out * (n - i + 1)) / i;
  return Math.round(out);
}

export function nPr(n: number, r: number): number {
  if (![n, r].every(Number.isInteger) || n < 0 || r < 0 || r > n) throw new Error("nPr needs whole numbers with r ≤ n");
  let out = 1;
  for (let i = 0; i < r; i++) out *= n - i;
  return out;
}

export function evaluate(expr: string, env: CalcEnv = {}): number {
  const angle = env.angle ?? "deg";
  const toRad = (v: number) => (angle === "deg" ? (v * Math.PI) / 180 : v);
  const fromRad = (v: number) => (angle === "deg" ? (v * 180) / Math.PI : v);
  // Exact values at the common angles so sin(30) is 0.5 and tan(45) is 1, not 0.49999….
  const snap = (v: number) => (Math.abs(v - Math.round(v)) < 1e-12 ? Math.round(v) : Math.abs(v * 2 - Math.round(v * 2)) < 1e-12 ? Math.round(v * 2) / 2 : v);
  const trig = (f: (r: number) => number) => (v: number) => snap(f(toRad(v)));
  const FN: Record<string, (v: number) => number> = {
    sin: trig(Math.sin), cos: trig(Math.cos),
    tan: v => {
      const r = toRad(v);
      if (Math.abs(Math.cos(r)) < 1e-12) throw new Error("tan is undefined here");
      return snap(Math.tan(r));
    },
    asin: v => { if (v < -1 || v > 1) throw new Error("math error"); return snap(fromRad(Math.asin(v))); },
    acos: v => { if (v < -1 || v > 1) throw new Error("math error"); return snap(fromRad(Math.acos(v))); },
    atan: v => snap(fromRad(Math.atan(v))),
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    sqrt: v => { if (v < 0) throw new Error("math error"); return Math.sqrt(v); },
    cbrt: Math.cbrt,
    log: v => { if (v <= 0) throw new Error("math error"); return Math.log10(v); },
    ln: v => { if (v <= 0) throw new Error("math error"); return Math.log(v); },
    abs: Math.abs, exp: Math.exp
  };
  const FN2: Record<string, (a: number, b: number) => number> = { ncr: nCr, npr: nPr, log_: (b, v) => Math.log(v) / Math.log(b) };

  const s = String(expr ?? "")
    .replace(/\s+/g, "")
    .replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-")
    .replace(/√/g, "sqrt").replace(/∛/g, "cbrt").replace(/π/g, "pi")
    .replace(/²/g, "^2").replace(/³/g, "^3")
    .replace(/sin⁻¹/g, "asin").replace(/cos⁻¹/g, "acos").replace(/tan⁻¹/g, "atan");
  if (!s) throw new Error("empty");
  let i = 0;
  const eat = (c: string) => { if (s[i] === c) { i++; return true; } return false; };

  function number(): number | null {
    const m = /^(\d+\.?\d*|\.\d+)(E[+-]?\d+|e[+-]?\d+(?![a-z]))?/.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    return parseFloat(m[0]);
  }
  function args(): number[] {
    const out = [expr1()];
    while (eat(",")) out.push(expr1());
    if (!eat(")")) throw new Error("missing )");
    return out;
  }
  function primary(): number {
    if (eat("(")) { const v = expr1(); if (!eat(")")) throw new Error("missing )"); return v; }
    const n = number();
    if (n !== null) return n;
    const m = /^[A-Za-z_]+/.exec(s.slice(i));
    if (!m) throw new Error("syntax error");
    const word = m[0];
    // Longest known name first, so "pix" reads as pi·x and "sinx" as sin(x).
    const names = ["asin", "acos", "atan", "sinh", "cosh", "tanh", "sin", "cos", "tan", "sqrt", "cbrt", "log", "ln", "abs", "exp", "ncr", "npr", "ans", "pi", "e", "x"];
    const lower = word.toLowerCase();
    const name = names.find(k => lower.startsWith(k));
    if (!name) throw new Error(`unknown ${word}`);
    i += name.length;
    if (name === "pi") return Math.PI;
    if (name === "e") return Math.E;
    if (name === "ans") return env.ans ?? 0;
    if (name === "x") { if (env.x === undefined) throw new Error("x has no value"); return env.x; }
    if (name === "ncr" || name === "npr") {
      if (!eat("(")) throw new Error(`${name} needs brackets`);
      const a = args();
      if (a.length !== 2) throw new Error(`${name} needs two numbers`);
      return FN2[name](a[0], a[1]);
    }
    const f = FN[name];
    if (eat("(")) {
      const a = args();
      if (a.length !== 1) throw new Error(`${name} takes one number`);
      return f(a[0]);
    }
    // sin30, sqrt9, ln x
    return f(power());
  }
  function postfix(): number {
    let v = primary();
    for (;;) {
      if (eat("!")) v = factorial(v);
      else if (eat("%")) v = v / 100;
      else return v;
    }
  }
  function unary(): number {
    if (eat("-")) return -unary();
    if (eat("+")) return unary();
    return power();
  }
  function power(): number {
    const b = postfix();
    if (eat("^")) return Math.pow(b, unary());
    return b;
  }
  function term(): number {
    let v = unary();
    for (;;) {
      if (eat("*")) v *= unary();
      else if (eat("/")) { const d = unary(); if (d === 0) throw new Error("cannot divide by zero"); v /= d; }
      else if (i < s.length && /[(\dA-Za-z.]/.test(s[i])) v *= power();
      else return v;
    }
  }
  function expr1(): number {
    let v = term();
    for (;;) {
      if (eat("+")) v += term();
      else if (eat("-")) v -= term();
      else return v;
    }
  }
  const v = expr1();
  if (i !== s.length) throw new Error("syntax error");
  if (!Number.isFinite(v)) throw new Error("math error");
  return v;
}

/** Display form: up to 10 significant figures, scientific notation for very large or small values. */
export function formatResult(v: number): string {
  if (!Number.isFinite(v)) return "math error";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e10 || a < 1e-6) {
    const [m, e] = v.toExponential(9).split("e");
    return `${String(Number(m))} × 10^${Number(e)}`;
  }
  return String(Number(v.toPrecision(10)));
}

/** Points for the graph plotter. Gaps (NaN) where the function is undefined or jumps off the screen. */
export function samplePlot(expr: string, xMin: number, xMax: number, steps: number, angle: AngleMode = "rad", yClip = 1e6): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let k = 0; k <= steps; k++) {
    const x = xMin + ((xMax - xMin) * k) / steps;
    let y = NaN;
    try { y = evaluate(expr, { x, angle }); } catch { /* undefined here */ }
    out.push({ x, y: Math.abs(y) > yClip ? NaN : y });
  }
  return out;
}
