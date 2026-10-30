"use client";
import { useEffect, useState } from "react";

/**
 * Short notices after an action ("Saved", "Not saved: …"), at the bottom of the
 * screen. send() in components/ui raises them for every save, so each button
 * says whether it worked. Anything can call notify().
 */
export type Notice = { tone: "ok" | "error"; text: string };
const EVENT = "ss-notice";

export function notify(n: Notice) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<Notice>(EVENT, { detail: n }));
}

type Shown = Notice & { id: number };
let next = 1;

export default function Toaster() {
  const [list, setList] = useState<Shown[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const n = (e as CustomEvent<Notice>).detail;
      const id = next++;
      // The same message twice in a row (a double click) shows once.
      setList(l => (l.at(-1)?.text === n.text ? l : [...l.slice(-2), { ...n, id }]));
      setTimeout(() => setList(l => l.filter(x => x.id !== id)), n.tone === "error" ? 8000 : 3000);
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6 lg:items-end lg:px-6" aria-live="polite" role="status">
      {list.map(n => (
        <div key={n.id} className={"pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-lg px-4 py-2.5 text-[13.5px] shadow-pop ring-1 " + (n.tone === "ok"
          ? "bg-white text-slate-800 ring-emerald-200" : "bg-white text-rose-800 ring-rose-200")}>
          <span aria-hidden className={"mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white " + (n.tone === "ok" ? "bg-emerald-600" : "bg-rose-600")}>{n.tone === "ok" ? "✓" : "!"}</span>
          <span className="min-w-0 flex-1">{n.text}</span>
          <button type="button" onClick={() => setList(l => l.filter(x => x.id !== n.id))} className="-mr-1 text-slate-400 hover:text-slate-700" aria-label="Dismiss">×</button>
        </div>
      ))}
    </div>
  );
}

/** What a request did, in the words of its notice. Reads and previews stay quiet unless they fail. */
export function noticeFor(method: string, body: unknown): { done: string; failed: string; quietWhenOk: boolean } {
  const action = body && typeof body === "object" && "action" in body ? String((body as { action: unknown }).action) : "";
  if (/^(preview|check|validate|lookup|search|estimate|count|generate|suggest|draft|explain|summar|translate)|^ai_|_preview$/.test(action))
    return { done: "Done", failed: "That didn't work", quietWhenOk: true };
  if (method === "DELETE" || /^(delete|remove)/.test(action)) return { done: "Deleted", failed: "Not deleted", quietWhenOk: false };
  if (/(cancel|void|withdraw|revoke)/.test(action)) return { done: "Cancelled", failed: "Not cancelled", quietWhenOk: false };
  if (/^(send|email|sms|remind|notify|invite|share|reply|message)/.test(action) || /^send_/.test(action)) return { done: "Sent", failed: "Not sent", quietWhenOk: false };
  return { done: "Saved", failed: "Not saved", quietWhenOk: false };
}
