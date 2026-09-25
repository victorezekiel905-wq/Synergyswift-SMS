"use client";
import { useCallback, useEffect, useState } from "react";

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
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">{eyebrow}</p>}
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
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
  if (["submitted", "pending", "queued", "sending", "draft", "in_progress"].includes(s)) return "amber";
  if (["rejected", "failed", "locked", "withheld", "suspended", "cancelled", "revoked", "out"].includes(s)) return "red";
  if (["skipped", "closed", "expired", "used"].includes(s)) return "slate";
  return "blue";
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
  return (
    <div role="tablist" className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map(t => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
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
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onMouseDown={e => e.stopPropagation()}
        className={`card w-full ${wide ? "max-w-3xl" : "max-w-lg"} p-5`}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="btn btn-ghost px-2 py-1" aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function fmtDate(v: string | null | undefined, withTime = false) {
  if (!v) return "—";
  const d = new Date(v);
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
  is_guardian: boolean;
};

export function rolesOf(me: Me | null): Set<string> {
  return new Set([me?.profile?.role, ...(me?.profile?.extra_roles ?? [])].filter(Boolean) as string[]);
}
