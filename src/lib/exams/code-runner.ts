/**
 * Runs student code against a question's test cases (server only).
 *
 *  - JavaScript runs in-process inside QuickJS compiled to WebAssembly: no
 *    file system, network, timers or Node APIs, with time, memory, stack and
 *    output limits. Input arrives as the global `input` (and `readLine()`),
 *    output is whatever the code prints with console.log / print.
 *  - Other languages (Python, Java, C, C++, C#, SQL) run on a Judge0 server
 *    when JUDGE0_URL is set (self-hosted, or RapidAPI with JUDGE0_KEY).
 *    Without it, those answers stay with the teacher to mark.
 *
 * Output is compared after trimming trailing spaces on every line and blank
 * lines at the end, so a missing final newline never costs marks.
 */
import { getQuickJS, shouldInterruptAfterDeadline } from "quickjs-emscripten";

export type TestCase = { input: string; expected: string; hidden?: boolean; points?: number };
export type RunResult = { ok: boolean; output: string; error: string | null; timedOut: boolean };
export type TestOutcome = { passed: boolean; hidden: boolean; output: string | null; expected: string | null; error: string | null };

const MAX_OUTPUT = 64 * 1024;
const JUDGE0_LANG: Record<string, number> = { python: 71, java: 62, c: 50, cpp: 54, csharp: 51, javascript: 63, sql: 82 };

export function normalizeOutput(s: string): string {
  return String(s ?? "").replace(/\r\n/g, "\n").split("\n").map(l => l.replace(/\s+$/, "")).join("\n").replace(/\n+$/, "");
}

export function canRun(language: string): boolean {
  if (language === "javascript") return true;
  return Boolean(process.env.JUDGE0_URL) && language in JUDGE0_LANG;
}

export async function runJavaScript(code: string, input: string, timeoutMs = 2000): Promise<RunResult> {
  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(32 * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);
  const deadline = Date.now() + timeoutMs;
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(deadline));
  const vm = runtime.newContext();
  let out = "";
  const write = (s: string) => { if (out.length < MAX_OUTPUT) out += s.slice(0, MAX_OUTPUT - out.length); };
  const lines = String(input ?? "").replace(/\r\n/g, "\n").split("\n");
  let cursor = 0;
  try {
    const log = vm.newFunction("log", (...args) => {
      write(args.map(a => { const v = vm.dump(a); return typeof v === "string" ? v : JSON.stringify(v); }).join(" ") + "\n");
    });
    const consoleObj = vm.newObject();
    vm.setProp(consoleObj, "log", log);
    vm.setProp(vm.global, "console", consoleObj);
    vm.setProp(vm.global, "print", log);
    log.dispose(); consoleObj.dispose();
    const inputHandle = vm.newString(String(input ?? ""));
    vm.setProp(vm.global, "input", inputHandle);
    inputHandle.dispose();
    const readLine = vm.newFunction("readLine", () => (cursor < lines.length ? vm.newString(lines[cursor++]) : vm.null));
    vm.setProp(vm.global, "readLine", readLine);
    readLine.dispose();

    const result = vm.evalCode(String(code ?? ""), "answer.js");
    if (result.error) {
      const e = vm.dump(result.error);
      result.error.dispose();
      const timedOut = Date.now() >= deadline;
      const msg = timedOut ? "Time limit exceeded" : typeof e === "object" && e ? `${e.name ?? "Error"}: ${e.message ?? ""}`.trim() : String(e);
      return { ok: false, output: out, error: msg, timedOut };
    }
    result.value.dispose();
    return { ok: true, output: out, error: null, timedOut: false };
  } catch (e) {
    return { ok: false, output: out, error: (e as Error).message.includes("memory") ? "Memory limit exceeded" : (e as Error).message, timedOut: false };
  } finally {
    vm.dispose();
    runtime.dispose();
  }
}

async function runJudge0(language: string, code: string, input: string): Promise<RunResult> {
  const base = String(process.env.JUDGE0_URL).replace(/\/$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.JUDGE0_KEY) {
    if (base.includes("rapidapi")) { headers["X-RapidAPI-Key"] = process.env.JUDGE0_KEY; headers["X-RapidAPI-Host"] = new URL(base).host; }
    else headers["X-Auth-Token"] = process.env.JUDGE0_KEY;
  }
  const res = await fetch(`${base}/submissions?base64_encoded=false&wait=true`, {
    method: "POST", headers, signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({ language_id: JUDGE0_LANG[language], source_code: code, stdin: input, cpu_time_limit: 2, memory_limit: 128000 })
  });
  if (!res.ok) return { ok: false, output: "", error: `code runner unavailable (${res.status})`, timedOut: false };
  const j = await res.json();
  const status = j.status?.description ?? "";
  const timedOut = /time limit/i.test(status);
  const err = j.compile_output || j.stderr || (j.status?.id > 3 ? status : null);
  return { ok: !err, output: String(j.stdout ?? "").slice(0, MAX_OUTPUT), error: err ? String(err).slice(0, 2000) : null, timedOut };
}

export async function runCode(language: string, code: string, input: string): Promise<RunResult> {
  if (language === "javascript") return runJavaScript(code, input);
  if (!canRun(language)) return { ok: false, output: "", error: "no runner for this language", timedOut: false };
  return runJudge0(language, code, input);
}

/** Runs every test and awards points per passed test (equal shares unless tests carry points). */
export async function gradeCode(language: string, code: string, tests: TestCase[], maxPoints: number) {
  const list = (tests ?? []).slice(0, 20);
  const outcomes: TestOutcome[] = [];
  for (const t of list) {
    const r = await runCode(language, code, t.input ?? "");
    const passed = !r.error && normalizeOutput(r.output) === normalizeOutput(t.expected ?? "");
    outcomes.push({ passed, hidden: Boolean(t.hidden), output: t.hidden ? null : r.output.slice(0, 2000), expected: t.hidden ? null : t.expected, error: r.error });
  }
  const weights = list.map(t => (Number(t.points) > 0 ? Number(t.points) : 1));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const earned = outcomes.reduce((a, o, i) => a + (o.passed ? weights[i] : 0), 0);
  const points = Math.round((earned / total) * maxPoints * 100) / 100;
  const passed = outcomes.filter(o => o.passed).length;
  return { points, passed, total: outcomes.length, outcomes, feedback: `Passed ${passed} of ${outcomes.length} tests.` };
}
