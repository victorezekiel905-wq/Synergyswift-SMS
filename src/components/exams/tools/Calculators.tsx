"use client";
import { useState } from "react";
import { evaluate, formatResult, type AngleMode } from "@/lib/exams/calc";

const key = "rounded-md border border-slate-200 bg-white py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 active:bg-slate-100";
const op = "rounded-md border border-slate-300 bg-slate-100 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-200";
const keep = (e: React.MouseEvent) => e.preventDefault(); // keep focus on the expression

function useCalc(angle: AngleMode) {
  const [expr, setExpr] = useState("");
  const [out, setOut] = useState("");
  const [ans, setAns] = useState(0);
  const [mem, setMem] = useState(0);
  const [err, setErr] = useState(false);
  const run = () => {
    if (!expr.trim()) return;
    try { const v = evaluate(expr, { angle, ans }); setAns(v); setOut(formatResult(v)); setErr(false); }
    catch (e) { setOut((e as Error).message); setErr(true); }
  };
  const current = () => { try { return evaluate(expr || "0", { angle, ans }); } catch { return ans; } };
  return { expr, setExpr, out, setOut, err, run, ans, mem, setMem, current };
}

function Display({ expr, setExpr, out, err, run, extra }: { expr: string; setExpr: (s: string) => void; out: string; err: boolean; run: () => void; extra?: React.ReactNode }) {
  return (
    <div className="mb-2 rounded-lg bg-slate-900 p-2 text-white">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-slate-400">{extra}</div>
      <input className="w-full bg-transparent text-right font-mono text-base text-slate-100 outline-none" value={expr} onChange={e => setExpr(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") run(); }} aria-label="Calculation" spellCheck={false} autoComplete="off" data-exam-tool="1" />
      <p className={"h-7 text-right font-mono text-xl tabular-nums " + (err ? "text-rose-300" : "")} aria-live="polite">{out}</p>
    </div>
  );
}

export function BasicCalculator() {
  const c = useCalc("deg");
  const add = (s: string) => c.setExpr(c.expr + s);
  const keys: [string, string, string?][] = [
    ["MC", "mc", op], ["MR", "mr", op], ["M+", "m+", op], ["M−", "m-", op],
    ["√", "sqrt(", op], ["%", "%", op], ["⌫", "back", op], ["C", "clear", op],
    ["7", "7"], ["8", "8"], ["9", "9"], ["÷", "÷", op],
    ["4", "4"], ["5", "5"], ["6", "6"], ["×", "×", op],
    ["1", "1"], ["2", "2"], ["3", "3"], ["−", "-", op],
    ["0", "0"], [".", "."], ["=", "eq", "rounded-md bg-brand-600 py-2 text-sm font-semibold text-white hover:bg-brand-700"], ["+", "+", op]
  ];
  const press = (k: string) => {
    if (k === "clear") { c.setExpr(""); c.setOut(""); }
    else if (k === "back") c.setExpr(c.expr.slice(0, -1));
    else if (k === "eq") c.run();
    else if (k === "mc") c.setMem(0);
    else if (k === "mr") add(String(c.mem));
    else if (k === "m+") c.setMem(c.mem + c.current());
    else if (k === "m-") c.setMem(c.mem - c.current());
    else add(k);
  };
  return (
    <div className="w-64">
      <Display {...c} extra={<><span>{c.mem ? "M" : ""}</span><span /></>} />
      <div className="grid grid-cols-4 gap-1">{keys.map(([l, k, cls]) => <button key={l} type="button" onMouseDown={keep} className={cls ?? key} onClick={() => press(k)}>{l}</button>)}</div>
    </div>
  );
}

export function ScientificCalculator() {
  const [angle, setAngle] = useState<AngleMode>("deg");
  const [shift, setShift] = useState(false);
  const c = useCalc(angle);
  const add = (s: string) => c.setExpr(c.expr + s);
  const fn = (a: string, b: string) => (shift ? b : a);
  const keys: [string, string, string?][] = [
    ["SHIFT", "shift", shift ? "rounded-md bg-amber-500 py-2 text-xs font-bold text-white" : op], [angle.toUpperCase(), "angle", op], ["(", "(", op], [")", ")", op], ["⌫", "back", op], ["AC", "clear", op],
    [fn("sin", "sin⁻¹"), fn("sin(", "asin("), op], [fn("cos", "cos⁻¹"), fn("cos(", "acos("), op], [fn("tan", "tan⁻¹"), fn("tan(", "atan("), op], [fn("log", "10ˣ"), fn("log(", "10^("), op], [fn("ln", "eˣ"), fn("ln(", "e^("), op], [fn("x²", "x³"), fn("^2", "^3"), op],
    [fn("√", "∛"), fn("sqrt(", "cbrt("), op], ["xʸ", "^", op], ["x⁻¹", "^(-1)", op], ["n!", "!", op], ["nCr", "nCr(", op], ["nPr", "nPr(", op],
    ["7", "7"], ["8", "8"], ["9", "9"], ["÷", "÷", op], ["π", "π", op], ["e", "e", op],
    ["4", "4"], ["5", "5"], ["6", "6"], ["×", "×", op], [",", ",", op], ["%", "%", op],
    ["1", "1"], ["2", "2"], ["3", "3"], ["−", "-", op], ["MR", "mr", op], ["M+", "m+", op],
    ["0", "0"], [".", "."], ["×10ˣ", "E", op], ["+", "+", op], ["Ans", "Ans", op], ["=", "eq", "rounded-md bg-brand-600 py-2 text-sm font-semibold text-white hover:bg-brand-700"]
  ];
  const press = (k: string) => {
    if (k === "shift") return setShift(s => !s);
    if (k === "angle") return setAngle(a => (a === "deg" ? "rad" : "deg"));
    if (k === "clear") { c.setExpr(""); c.setOut(""); }
    else if (k === "back") c.setExpr(c.expr.slice(0, -1));
    else if (k === "eq") c.run();
    else if (k === "mr") add(String(c.mem));
    else if (k === "m+") c.setMem(c.mem + c.current());
    else add(k);
    setShift(false);
  };
  return (
    <div className="w-[300px]">
      <Display {...c} extra={<><span>{angle === "deg" ? "Degrees" : "Radians"}{shift ? " · SHIFT" : ""}</span><span>{c.mem ? "M" : ""}</span></>} />
      <div className="grid grid-cols-6 gap-1">{keys.map(([l, k, cls], i) => <button key={`${l}${i}`} type="button" onMouseDown={keep} className={(cls ?? key) + " px-0 text-xs"} onClick={() => press(k)}>{l}</button>)}</div>
      <p className="mt-2 text-[11px] text-slate-500">Type or tap. Enter calculates. nCr(5,2) needs the comma.</p>
    </div>
  );
}
