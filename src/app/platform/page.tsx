"use client";
import { useState } from "react";
import Link from "next/link";
import { useApi, Page, PageHeader, Badge, statusTone, Empty, Alert, fmtDate, Loading } from "@/components/ui";
import PlatformNav from "@/components/platform/PlatformNav";

type Tenant = {
  id: string; name: string; slug: string; status: string; billing_hold: boolean; country: string | null; created_at: string;
  student_limit: number | null; stats: { users: number; students: number; staff: number; messages_30d: number; exams: number };
  subscriptions: { status: string; period_end: string | null; cycle: string; plans: { name: string; code: string } | null } | { status: string; period_end: string | null; cycle: string; plans: { name: string; code: string } | null }[] | null;
};

const subOf = (t: Tenant) => (Array.isArray(t.subscriptions) ? t.subscriptions[0] : t.subscriptions) ?? null;
const SUB_TONE: Record<string, "green" | "amber" | "red" | "blue" | "slate"> = { active: "green", trial: "blue", past_due: "amber", suspended: "red", cancelled: "slate" };
const SUB_LABEL: Record<string, string> = { active: "Paid", trial: "Trial", past_due: "Payment overdue", suspended: "Unpaid, paused", cancelled: "Ended" };

export default function PlatformPage() {
  const { data, error, loading } = useApi<Tenant[]>("/api/platform/tenants");
  const [q, setQ] = useState("");
  const list = (data ?? []).filter(t => !q || `${t.name} ${t.slug}`.toLowerCase().includes(q.toLowerCase()));
  const totals = (data ?? []).reduce((a, t) => ({ students: a.students + t.stats.students, staff: a.staff + t.stats.staff, msgs: a.msgs + t.stats.messages_30d }), { students: 0, staff: 0, msgs: 0 });
  const overdue = (data ?? []).filter(t => ["past_due", "suspended"].includes(subOf(t)?.status ?? "")).length;

  return (
    <Page wide>
      <PlatformNav />
      <PageHeader eyebrow="Synergy Swift platform" title="Schools"
        subtitle="Only the Synergy Swift team sees this. Schools cannot see each other or know that other schools exist."
        actions={<Link className="btn btn-primary" href="/platform/new">+ New school</Link>} />
      {error && <Alert>{error}</Alert>}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="card p-4"><p className="text-[13px] text-slate-500">Schools</p><p className="text-2xl font-bold">{data?.length ?? "…"}</p></div>
        <div className="card p-4"><p className="text-[13px] text-slate-500">Active students</p><p className="text-2xl font-bold">{totals.students}</p></div>
        <div className="card p-4"><p className="text-[13px] text-slate-500">Staff</p><p className="text-2xl font-bold">{totals.staff}</p></div>
        <div className="card p-4"><p className="text-[13px] text-slate-500">Messages sent (30 days)</p><p className="text-2xl font-bold">{totals.msgs}</p></div>
        <div className="card p-4"><p className="text-[13px] text-slate-500">Overdue or paused for payment</p><p className="text-2xl font-bold">{overdue}</p></div>
      </div>
      <input className="input mb-3 max-w-sm" placeholder="Search schools" value={q} onChange={e => setQ(e.target.value)} aria-label="Search schools" />
      {loading && !data ? <Loading /> : list.length === 0 ? <Empty>No schools yet. Create the first one.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[13px] text-slate-500">
              <tr><th className="p-3">School</th><th className="p-3">Status</th><th className="p-3">Plan</th><th className="p-3 text-right">Students</th><th className="p-3 text-right">Staff</th><th className="p-3 text-right">Msgs 30d</th><th className="p-3">Created</th></tr>
            </thead>
            <tbody>
              {list.map(t => {
                const s = subOf(t);
                return (
                  <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="p-3"><Link className="font-semibold text-brand-700 hover:underline" href={`/platform/${t.id}`}>{t.name}</Link><div className="text-xs text-slate-500">{t.slug}{t.country ? ` · ${t.country}` : ""}</div></td>
                    <td className="p-3"><Badge tone={statusTone(t.status)}>{t.billing_hold ? "paused: unpaid" : t.status}</Badge></td>
                    <td className="p-3">{s ? <><span>{s.plans?.name ?? "—"}</span> <Badge tone={SUB_TONE[s.status] ?? "slate"}>{SUB_LABEL[s.status] ?? s.status}</Badge>{s.period_end && <div className="text-xs text-slate-500">to {fmtDate(s.period_end)}</div>}</> : <span className="text-slate-500">No plan</span>}</td>
                    <td className="p-3 text-right tabular-nums">{t.stats.students}{t.student_limit ? <span className="text-slate-400"> / {t.student_limit}</span> : null}</td>
                    <td className="p-3 text-right tabular-nums">{t.stats.staff}</td>
                    <td className="p-3 text-right tabular-nums">{t.stats.messages_30d}</td>
                    <td className="p-3 text-slate-500">{fmtDate(t.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}
