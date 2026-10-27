"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";

/** Fetch JSON with loading / error state. `reload()` re-fetches. */
export function useApi<T>(url: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(url));
  const reload = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    try {
      const r = await fetch(url, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error ?? `Request failed (${r.status})`); setData(null); }
      else { setError(null); setData(j as T); }
    } catch (e) {
      setError((e as Error).message);
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}

/** POST/PUT/PATCH/DELETE JSON; returns { ok, data, error }. */
export async function send<T = any>(url: string, body?: unknown, method = "POST"): Promise<{ ok: boolean; data: T; error: string | null }> {
  try {
    const r = await fetch(url, {
      method, headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, data: j as T, error: r.ok ? null : (j.error ?? `Request failed (${r.status})`) };
  } catch (e) {
    return { ok: false, data: {} as T, error: (e as Error).message };
  }
}

export function PageHeader({ eyebrow, title, subtitle, actions }: { eyebrow?: string; title: string; subtitle?: string; actions?: React.ReactNode }) {
  // Tabs, history and bookmarks show the page name, not just the product name.
  useEffect(() => { document.title = `${title} · Synergy Swift`; }, [title]);
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-[13px] text-slate-500">{eyebrow}</p>}
        <h1 className="font-serif text-[26px] font-semibold leading-tight tracking-[-0.01em] text-slate-900 sm:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-3xl text-[15px] leading-relaxed text-slate-600 sm:text-sm">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Page({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return <main className={`mx-auto px-4 py-8 sm:px-8 sm:py-10 ${wide ? "max-w-7xl" : "max-w-6xl"}`}>{children}</main>;
}

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: "good" | "warn" | "bad" }) {
  // Figures stay in ink; a small dot carries the good / watch / act signal.
  const dot = tone === "good" ? "bg-emerald-500" : tone === "warn" ? "bg-amber-500" : tone === "bad" ? "bg-rose-600" : null;
  return (
    <div className="card px-4 py-3.5">
      <p className="flex items-center gap-1.5 text-[13px] text-slate-500">{dot && <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />}{label}</p>
      <p className="mt-1.5 text-[26px] font-semibold leading-none tracking-tight tabular-nums text-slate-900">{value}</p>
      {hint && <p className={`mt-1.5 text-xs ${tone === "bad" ? "text-rose-700" : tone === "warn" ? "text-amber-800" : "text-slate-500"}`}>{hint}</p>}
    </div>
  );
}

export function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "green" | "amber" | "red" | "blue" | "violet" }) {
  const map = {
    slate: "bg-slate-50 text-slate-600 ring-slate-500/20", green: "bg-emerald-50 text-emerald-800 ring-emerald-600/20", amber: "bg-amber-50 text-amber-800 ring-amber-600/25",
    red: "bg-rose-50 text-rose-800 ring-rose-600/20", blue: "bg-brand-50 text-brand-700 ring-brand-600/20", violet: "bg-slate-50 text-slate-700 ring-slate-600/25"
  };
  return <span className={`inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[11.5px] font-medium leading-4 ring-1 ring-inset ${map[tone]}`}>{children}</span>;
}

export function statusTone(s: string): "slate" | "green" | "amber" | "red" | "blue" | "violet" {
  if (["published", "approved", "sent", "graded", "active", "fulfilled", "in"].includes(s)) return "green";
  if (["submitted", "pending", "queued", "sending", "draft", "in_progress", "paused"].includes(s)) return "amber";
  if (["rejected", "failed", "locked", "withheld", "suspended", "cancelled", "revoked", "out"].includes(s)) return "red";
  if (["skipped", "closed", "expired", "used"].includes(s)) return "slate";
  return "blue";
}

/** Spinner with a live-region label, for data that is on its way. */
export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center justify-center gap-2.5 p-8 text-sm text-slate-500">
      <span aria-hidden className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-slate-300 border-t-slate-700" />
      {label}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-slate-200 bg-white px-6 py-10 text-center text-sm leading-relaxed text-slate-500">{children}</div>;
}

export function Alert({ tone = "red", children }: { tone?: "red" | "green" | "amber" | "blue"; children: React.ReactNode }) {
  const map = { red: "border-rose-200 bg-rose-50/70 text-rose-900 before:bg-rose-600", green: "border-emerald-200 bg-emerald-50/70 text-emerald-900 before:bg-emerald-600",
    amber: "border-amber-200 bg-amber-50/70 text-amber-950 before:bg-amber-500", blue: "border-brand-200 bg-brand-50/70 text-brand-900 before:bg-brand-600" };
  return <div role={tone === "red" ? "alert" : "status"} className={`relative overflow-hidden rounded-md border py-3 pl-5 pr-4 text-sm leading-relaxed before:absolute before:inset-y-0 before:left-0 before:w-[3px] ${map[tone]}`}>{children}</div>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  // Arrow keys move between tabs, as screen-reader and keyboard users expect.
  function onKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const i = tabs.findIndex(t => t.id === value);
    const next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    onChange(tabs[next].id);
    (e.currentTarget.children[next] as HTMLElement | undefined)?.focus();
  }
  return (
    <div role="tablist" onKeyDown={onKey} className="mb-6 flex gap-5 overflow-x-auto border-b border-slate-200">
      {tabs.map(t => (
        <button key={t.id} role="tab" aria-selected={value === t.id} tabIndex={value === t.id ? 0 : -1} onClick={() => onChange(t.id)}
          className={"-mb-px whitespace-nowrap border-b-2 px-0.5 pb-2.5 pt-1 text-sm transition-colors " +
            (value === t.id ? "border-brand-600 font-medium text-slate-900" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800")}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs leading-snug text-slate-500">{hint}</span>}
    </label>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") close.current(); };
    window.addEventListener("keydown", h);
    // Keep the page behind still, and put focus inside the dialog.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const first = box.current?.querySelector<HTMLElement>("input, select, textarea, button:not([data-close]), [href], [tabindex]:not([tabindex='-1'])");
    (first ?? box.current)?.focus();
    return () => { window.removeEventListener("keydown", h); document.body.style.overflow = overflow; before?.focus?.(); };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/40 p-4 sm:p-10" onMouseDown={onClose}>
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={e => e.stopPropagation()}
        className={`w-full rounded-lg border border-slate-200 bg-white outline-none ${wide ? "max-w-3xl" : "max-w-lg"} p-6 shadow-pop`}>
        <div className="mb-5 flex items-start justify-between gap-3">
          <h2 id={titleId} className="font-serif text-xl font-semibold leading-snug">{title}</h2>
          <button data-close onClick={onClose} className="btn btn-ghost -mr-2 p-1.5" aria-label="Close"><Icon name="x" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

const ICONS = {
  x: "M6 6l12 12M18 6L6 18",
  home: "M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  calendar: "M7 3v4M17 3v4M4 9h16M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 14 0",
  book: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zm0 0v16M8 7h7",
  chevron: "M9 6l6 6-6 6",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  menu: "M4 6h16M4 12h16M4 18h16",
  pin: "M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  alert: "M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  check: "M5 13l4 4L19 7",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm9 3l-4.35-4.35",
  logout: "M15 17l5-5-5-5M20 12H9M12 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h7",
  pinned: "M9 4h6l-1 6 3 3H7l3-3-1-6zm3 9v7",
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2",
  mail: "M4 6h16v12H4zM4 7l8 6 8-6",
  chat: "M5 5h14v10H9l-4 4V5z",
  note: "M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5",
  people: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-6 10a6 6 0 0 1 12 0M17 11a3 3 0 1 0 0-6M21 21a5 5 0 0 0-4-4.9",
  card: "M3 6h18v12H3zM3 10h18",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  ticket: "M3 8a2 2 0 0 0 0 4v4h18v-4a2 2 0 0 0 0-4V4H3zM14 4v12",
  repeat: "M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3",
  lock: "M6 11h12v10H6zM8 11V7a4 4 0 1 1 8 0v4",
  flame: "M12 22c4 0 7-3 7-7 0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-2 2-5 5-5 8 0 4 3 7 7 7z",
  medal: "M12 22a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM8.5 10.5L6 2h4l2 5 2-5h4l-2.5 8.5",
  star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z",
  hand: "M8 13V5a1.5 1.5 0 0 1 3 0v6m0-1V3.5a1.5 1.5 0 0 1 3 0V10m0-.5V5a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-2.7L3 13.5a1.5 1.5 0 0 1 2.5-1.6L8 15",
  cap: "M2 9l10-5 10 5-10 5zM6 11v5c3 2.5 9 2.5 12 0v-5",
  moon: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z",
  party: "M4 20l5-14 9 9-14 5zM14 4l1-2M18 8l3-1M17 4l2-2",
  send: "M4 12l16-8-6 16-2.5-6.5L4 12z",
  plus: "M12 5v14M5 12h14"
} as const;

/** Small line icons, sized to the text around them. Decorative unless given a label. */
export function Icon({ name, className = "h-4 w-4", label }: { name: keyof typeof ICONS; className?: string; label?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      className={className} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path d={ICONS[name]} />
    </svg>
  );
}

/** Parses a timestamp, or a YYYY-MM-DD date as that calendar day in local time (not UTC midnight). */
function toDate(v: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(v);
}

/** Today (or `daysAgo` days before) as YYYY-MM-DD in the viewer's local time. */
export function localDate(daysAgo = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function fmtDate(v: string | null | undefined, withTime = false) {
  if (!v) return "—";
  const d = toDate(v);
  if (Number.isNaN(d.getTime())) return "—";
  return withTime
    ? d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function fmtTime(v: string | null | undefined) {
  return v ? new Date(v).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "—";
}

export function money(n: number | string | null | undefined, currency = "NGN") {
  const v = Number(n ?? 0);
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(v); }
  catch { return `${currency} ${v.toFixed(2)}`; }
}

/** Me: profile + tenant, shared across pages. */
export type Me = {
  user: { id: string; email: string } | null;
  profile: { id: string; tenant_id: string; full_name: string; role: string; extra_roles: string[] } | null;
  tenant: { id: string; name: string; status: string; modules: Record<string, boolean> } | null;
  platform: boolean;
  group?: boolean;
  account?: { state: string; school?: string; message?: string | null; device?: string | null };
  prefs?: { currency: string; idle_minutes: number; password_days_left: number | null } | null;
  platform_mfa?: boolean;
  is_guardian: boolean;
};

export function rolesOf(me: Me | null): Set<string> {
  return new Set([me?.profile?.role, ...(me?.profile?.extra_roles ?? [])].filter(Boolean) as string[]);
}
