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
  useEffect(() => { document.title = `${title} · EduClass Fusion`; }, [title]);
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">{eyebrow}</p>}
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-slate-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Page({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return <main className={`mx-auto px-4 py-8 sm:px-6 ${wide ? "max-w-7xl" : "max-w-6xl"}`}>{children}</main>;
}

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "good" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : tone === "bad" ? "text-rose-600" : "text-slate-900";
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "green" | "amber" | "red" | "blue" | "violet" }) {
  const map = {
    slate: "bg-slate-100 text-slate-700", green: "bg-emerald-100 text-emerald-700", amber: "bg-amber-100 text-amber-800",
    red: "bg-rose-100 text-rose-700", blue: "bg-brand-50 text-brand-700", violet: "bg-violet-100 text-violet-700"
  };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${map[tone]}`}>{children}</span>;
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
    <div role="status" aria-live="polite" className="flex items-center justify-center gap-2 p-6 text-sm text-slate-500">
      <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
      {label}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">{children}</div>;
}

export function Alert({ tone = "red", children }: { tone?: "red" | "green" | "amber" | "blue"; children: React.ReactNode }) {
  const map = { red: "border-rose-200 bg-rose-50 text-rose-800", green: "border-emerald-200 bg-emerald-50 text-emerald-800",
    amber: "border-amber-200 bg-amber-50 text-amber-900", blue: "border-brand-200 bg-brand-50 text-brand-800" };
  return <div role={tone === "red" ? "alert" : "status"} className={`rounded-lg border px-4 py-3 text-sm ${map[tone]}`}>{children}</div>;
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
    <div role="tablist" onKeyDown={onKey} className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map(t => (
        <button key={t.id} role="tab" aria-selected={value === t.id} tabIndex={value === t.id ? 0 : -1} onClick={() => onChange(t.id)}
          className={"whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition " +
            (value === t.id ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800")}>
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
      {hint && <span className="mt-1 block text-[11px] text-slate-500">{hint}</span>}
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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-[2px] sm:p-8" onMouseDown={onClose}>
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={e => e.stopPropagation()}
        className={`card w-full outline-none ${wide ? "max-w-3xl" : "max-w-lg"} p-5 shadow-xl`}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-lg font-semibold tracking-tight">{title}</h2>
          <button data-close onClick={onClose} className="btn btn-ghost -mr-2 p-1.5" aria-label="Close"><Icon name="x" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

const ICONS = {
  x: "M6 6l12 12M18 6L6 18",
  menu: "M4 6h16M4 12h16M4 18h16",
  pin: "M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  alert: "M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  check: "M5 13l4 4L19 7",
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
  account?: { state: string; school?: string; message?: string | null };
  platform_mfa?: boolean;
  is_guardian: boolean;
};

export function rolesOf(me: Me | null): Set<string> {
  return new Set([me?.profile?.role, ...(me?.profile?.extra_roles ?? [])].filter(Boolean) as string[]);
}
