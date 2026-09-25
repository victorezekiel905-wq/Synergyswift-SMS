"use client";
import { useState } from "react";

/**
 * Safe scientific calculator. Parses with a small recursive-descent parser;
 * never uses eval. Supports + - * / ^ ( ), sqrt sin cos tan log ln abs, pi, e.
 */
export function evaluate(expr: string): number {
  const s = expr.replace(/\s+/g, "").replace(/×/g, "*").replace(/÷/g, "/");
  let i = 0;
  const peek = () => s[i];
  const eat = (c: string) => { if (s[i] === c) { i++; return true; } return false; };
  const FN: Record<string, (x: number) => number> = { sqrt: Math.sqrt, sin: x => Math.sin(x * Math.PI / 180), cos: x => Math.cos(x * Math.PI / 180), tan: x => Math.tan(x * Math.PI / 180), log: Math.log10, ln: Math.log, abs: Math.abs };
  function primary(): number {
    if (eat("(")) { const v = expr1(); if (!eat(")")) throw new Error("missing )"); return v; }
    if (eat("-")) return -primary();
    if (eat("+")) return primary();
    const m = /^[a-z]+/.exec(s.slice(i));
    if (m) {
      i += m[0].length;
      if (m[0] === "pi") return Math.PI;
      if (m[0] === "e") return Math.E;
      const f = FN[m[0]];
      if (!f || !eat("(")) throw new Error(`unknown ${m[0]}`);
      const v = expr1(); if (!eat(")")) throw new Error("missing )");
      return f(v);
    }
    const n = /^\d*\.?\d+(e[+-]?\d+)?/i.exec(s.slice(i));
    if (!n) throw new Error("syntax error");
    i += n[0].length;
    return parseFloat(n[0]);
  }
  function power(): number { const b = primary(); return eat("^") ? Math.pow(b, power()) : b; }
  function term(): number { let v = power(); for (;;) { if (eat("*")) v *= power(); else if (eat("/")) v /= power(); else if (peek() === "(" ) v *= power(); else return v; } }
  function expr1(): number { let v = term(); for (;;) { if (eat("+")) v += term(); else if (eat("-")) v -= term(); else return v; } }
  const v = expr1();
  if (i !== s.length) throw new Error("syntax error");
  if (!Number.isFinite(v)) throw new Error("math error");
  return v;
}

export default function Calculator({ onClose }: { onClose: () => void }) {
  const [x, setX] = useState("");
  const [out, setOut] = useState<string>("");
  const keys = ["7", "8", "9", "/", "sqrt(", "4", "5", "6", "*", "^", "1", "2", "3", "-", "(", "0", ".", "pi", "+", ")"];
  const run = () => { try { setOut(String(Math.round(evaluate(x) * 1e10) / 1e10)); } catch (e) { setOut((e as Error).message); } };
  return (
    <div className="fixed bottom-4 right-4 z-40 w-72 rounded-xl border border-slate-300 bg-white p-3 shadow-xl" role="dialog" aria-label="Calculator">
      <div className="mb-2 flex items-center justify-between"><span className="text-sm font-semibold">Calculator</span><button className="text-slate-400" onClick={onClose} aria-label="Close calculator">✕</button></div>
      <input className="input font-mono" value={x} onChange={e => setX(e.target.value)} onKeyDown={e => e.key === "Enter" && run()} aria-label="Expression" />
      <p className="my-1 h-6 text-right font-mono text-lg" aria-live="polite">{out}</p>
      <div className="grid grid-cols-5 gap-1">
        {keys.map(k => <button key={k} className="rounded bg-slate-100 py-1.5 text-sm hover:bg-slate-200" onClick={() => setX(v => v + k)}>{k.replace("(", "") || k}</button>)}
        <button className="col-span-2 rounded bg-slate-200 py-1.5 text-sm" onClick={() => { setX(""); setOut(""); }}>C</button>
        <button className="rounded bg-slate-200 py-1.5 text-sm" onClick={() => setX(v => v.slice(0, -1))}>⌫</button>
        <button className="col-span-2 rounded bg-brand-600 py-1.5 text-sm text-white" onClick={run}>=</button>
      </div>
    </div>
  );
}
