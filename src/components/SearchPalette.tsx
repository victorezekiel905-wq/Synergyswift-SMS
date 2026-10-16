"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Hit = { type: string; id: string; title: string; detail?: string | null; href: string };

/** Search everything (Ctrl/⌘ K): students, staff, families, classes, invoices, complaints, enquiries, and pages. */
export default function SearchPalette({ pages = [] }: { pages?: { href: string; label: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen(o => !o); }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  useEffect(() => { if (open) { setTimeout(() => input.current?.focus(), 0); } else { setQ(""); setHits([]); } }, [open]);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); return; }
    const t = setTimeout(async () => {
      setBusy(true);
      const r = await fetch(`/api/search?q=${encodeURIComponent(term)}`).then(x => x.json()).catch(() => ({ results: [] }));
      setBusy(false);
      setHits(r.results ?? []);
      setSel(0);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const term = q.trim().toLowerCase();
  const pageHits: Hit[] = term.length >= 2 ? pages.filter(p => p.label.toLowerCase().includes(term)).slice(0, 5).map(p => ({ type: "Page", id: p.href, title: p.label, href: p.href })) : [];
  const all = [...pageHits, ...hits];
  const go = (h: Hit) => { setOpen(false); router.push(h.href); };

  return (
    <>
      <button className="hidden h-8 w-56 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 text-[13px] text-slate-500 transition-colors hover:border-slate-300 hover:bg-white md:flex" onClick={() => setOpen(true)} aria-label="Search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-3.5 w-3.5" aria-hidden><path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm9 3l-4.35-4.35" /></svg>
        <span className="flex-1 text-left">Search</span><kbd className="rounded border border-slate-200 bg-white px-1 font-mono text-[10px] text-slate-400">Ctrl K</kbd>
      </button>
      <button className="btn btn-ghost px-2 py-1.5 md:hidden" onClick={() => setOpen(true)} aria-label="Search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-4 w-4" aria-hidden><path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm9 3l-4.35-4.35" /></svg></button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/40 px-4 pt-[12vh]" onClick={() => setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="Search" className="w-full max-w-xl overflow-hidden rounded-lg border border-slate-200 bg-white shadow-pop" onClick={e => e.stopPropagation()}>
            <input ref={input} className="w-full border-b border-slate-200 px-4 py-3 text-base outline-none" placeholder="Search students, staff, families, invoices, complaints…" value={q}
              onChange={e => setQ(e.target.value)} aria-label="Search" role="combobox" aria-expanded={all.length > 0} aria-controls="search-results"
              onKeyDown={e => {
                if (e.key === "ArrowDown") { e.preventDefault(); setSel(s => Math.min(all.length - 1, s + 1)); }
                if (e.key === "ArrowUp") { e.preventDefault(); setSel(s => Math.max(0, s - 1)); }
                if (e.key === "Enter" && all[sel]) go(all[sel]);
              }} />
            <ul id="search-results" role="listbox" className="max-h-[60vh] overflow-y-auto py-1">
              {all.map((h, i) => (
                <li key={`${h.type}-${h.id}`} role="option" aria-selected={i === sel}>
                  <button className={"flex w-full items-center gap-3 px-4 py-2 text-left text-sm " + (i === sel ? "bg-slate-100" : "hover:bg-slate-50")} onMouseEnter={() => setSel(i)} onClick={() => go(h)}>
                    <span className="w-20 shrink-0 text-xs capitalize text-slate-400">{h.type}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{h.title}</span>{h.detail && <span className="block truncate text-xs text-slate-500">{h.detail}</span>}</span>
                  </button>
                </li>
              ))}
              {term.length >= 2 && !busy && !all.length && <li className="px-4 py-6 text-center text-sm text-slate-500">No matches.</li>}
              {busy && !all.length && <li className="px-4 py-6 text-center text-sm text-slate-500">Searching…</li>}
              {term.length < 2 && <li className="px-4 py-4 text-xs text-slate-500">Type at least two letters. Use ↑ ↓ and Enter.</li>}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
