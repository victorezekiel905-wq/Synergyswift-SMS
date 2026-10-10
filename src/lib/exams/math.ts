/**
 * Maths-input marking: parses a typed expression ("2x^2 + 3(x - 1)",
 * "sqrt(2)/2", "3×4 ÷ 2") into a tree and compares two expressions by
 * evaluating them at the same sample points. Equivalent forms therefore
 * score the same: "2(x+1)" equals "2x+2". No eval(); unknown words fail.
 */

type Node =
  | { k: "num"; v: number }
  | { k: "var"; name: string }
  | { k: "neg"; a: Node }
  | { k: "bin"; op: "+" | "-" | "*" | "/" | "^"; a: Node; b: Node }
  | { k: "fn"; name: string; a: Node };

const FUNCS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan, abs: Math.abs, exp: Math.exp,
  ln: Math.log, log: Math.log10, asin: Math.asin, acos: Math.acos, atan: Math.atan
};
const CONSTS: Record<string, number> = { pi: Math.PI, "π": Math.PI, e: Math.E };

type Tok = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string } | { t: "(" } | { t: ")" };

function tokenize(src: string): Tok[] {
  const s = src.replace(/×|·/g, "*").replace(/÷/g, "/").replace(/−|–/g, "-").replace(/\*\*/g, "^").replace(/√/g, "sqrt").replace(/\s+/g, "");
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/[0-9.]/.test(c)) {
      let j = i; while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const v = Number(s.slice(i, j));
      if (!Number.isFinite(v)) throw new Error("bad number");
      out.push({ t: "num", v }); i = j; continue;
    }
    if (/[a-zA-Zπ]/.test(c)) {
      let j = i; while (j < s.length && /[a-zA-Zπ]/.test(s[j])) j++;
      let word = s.slice(i, j);
      // Split a run of letters into known function/constant names and single-letter variables: "2xy" → x·y, "xsin" → x·sin.
      while (word) {
        const known = [...Object.keys(FUNCS), "pi"].sort((a, b) => b.length - a.length).find(n => word.toLowerCase().startsWith(n));
        if (known) { out.push({ t: "id", v: known }); word = word.slice(known.length); }
        else { out.push({ t: "id", v: word[0] }); word = word.slice(1); }
      }
      i = j; continue;
    }
    if ("+-*/^".includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
    if (c === "(" || c === "[" || c === "{") { out.push({ t: "(" }); i++; continue; }
    if (c === ")" || c === "]" || c === "}") { out.push({ t: ")" }); i++; continue; }
    throw new Error(`unexpected "${c}"`);
  }
  return out;
}

/** Recursive-descent parser with implicit multiplication ("2x", "3(x+1)", "(a)(b)"). */
export function parseExpression(src: string): Node {
  const toks = tokenize(String(src ?? ""));
  if (!toks.length) throw new Error("empty");
  let p = 0;
  const peek = () => toks[p];
  const startsFactor = (t?: Tok) => !!t && (t.t === "num" || t.t === "id" || t.t === "(");

  function expr(): Node {
    let n = term();
    while (peek()?.t === "op" && ["+", "-"].includes((peek() as any).v)) {
      const op = (toks[p++] as any).v as "+" | "-";
      n = { k: "bin", op, a: n, b: term() };
    }
    return n;
  }
  function term(): Node {
    let n = unary();
    for (;;) {
      const t = peek();
      if (t?.t === "op" && (t.v === "*" || t.v === "/")) { p++; n = { k: "bin", op: t.v as "*" | "/", a: n, b: unary() }; }
      else if (startsFactor(t)) n = { k: "bin", op: "*", a: n, b: power() };
      else return n;
    }
  }
  function unary(): Node {
    const t = peek();
    if (t?.t === "op" && t.v === "-") { p++; return { k: "neg", a: unary() }; }
    if (t?.t === "op" && t.v === "+") { p++; return unary(); }
    return power();
  }
  function power(): Node {
    const base = atom();
    const t = peek();
    if (t?.t === "op" && t.v === "^") { p++; return { k: "bin", op: "^", a: base, b: unary() }; }
    return base;
  }
  function atom(): Node {
    const t = toks[p++];
    if (!t) throw new Error("unexpected end");
    if (t.t === "num") return { k: "num", v: t.v };
    if (t.t === "(") { const n = expr(); if (toks[p++]?.t !== ")") throw new Error("missing )"); return n; }
    if (t.t === "id") {
      const name = t.v;
      if (FUNCS[name.toLowerCase()]) {
        const fn = name.toLowerCase();
        // sqrt x, sin x … without brackets bind to the next factor.
        return { k: "fn", name: fn, a: peek()?.t === "(" ? atom() : power() };
      }
      if (name === "pi" || name === "π") return { k: "num", v: Math.PI };
      return { k: "var", name };
    }
    throw new Error("unexpected symbol");
  }
  const n = expr();
  if (p !== toks.length) throw new Error("unexpected symbol");
  return n;
}

export function variablesOf(n: Node, out = new Set<string>()): Set<string> {
  switch (n.k) {
    case "var": if (n.name !== "e") out.add(n.name); break;
    case "neg": case "fn": variablesOf(n.a, out); break;
    case "bin": variablesOf(n.a, out); variablesOf(n.b, out); break;
  }
  return out;
}

export function evaluate(n: Node, vars: Record<string, number>): number {
  switch (n.k) {
    case "num": return n.v;
    case "var": return n.name in vars ? vars[n.name] : n.name in CONSTS ? CONSTS[n.name] : NaN;
    case "neg": return -evaluate(n.a, vars);
    case "fn": return FUNCS[n.name](evaluate(n.a, vars));
    case "bin": {
      const a = evaluate(n.a, vars), b = evaluate(n.b, vars);
      switch (n.op) { case "+": return a + b; case "-": return a - b; case "*": return a * b; case "/": return a / b; case "^": return Math.pow(a, b); }
    }
  }
}

// Fixed, irregular sample points so results are deterministic and rarely hit special values.
const SAMPLES = [0.7312, 1.4142, 2.2361, -0.5773, 3.1173, -1.8318, 0.3183];

/** True when the two expressions agree at every sample point (relative tolerance). */
export function equivalent(answer: string, key: string, tolerance = 1e-6): boolean {
  let a: Node, k: Node;
  try { a = parseExpression(answer); k = parseExpression(key); } catch { return false; }
  const names = [...new Set([...variablesOf(a), ...variablesOf(k)])].sort();
  let compared = 0;
  for (let i = 0; i < SAMPLES.length; i++) {
    const vars = Object.fromEntries(names.map((nm, j) => [nm, SAMPLES[(i + j * 3) % SAMPLES.length] + j * 0.1]));
    const x = evaluate(a, vars), y = evaluate(k, vars);
    if (!Number.isFinite(y)) continue;          // key undefined here (e.g. 1/x at 0): skip the point
    if (!Number.isFinite(x)) return false;
    if (Math.abs(x - y) > tolerance * Math.max(1, Math.abs(y))) return false;
    compared++;
  }
  return compared > 0;
}

/** Whether a key expression is usable (for the question editor). */
export function isValidExpression(s: string): boolean {
  try { parseExpression(s); return true; } catch { return false; }
}
