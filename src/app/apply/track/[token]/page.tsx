"use client";
import { use } from "react";
import { useApi, fmtDate, money } from "@/components/ui";

const STEPS = ["new", "reviewing", "assessment", "interview", "offered", "accepted", "enrolled"];
const LABEL: Record<string, string> = { new: "Received", reviewing: "Under review", assessment: "Entrance assessment", interview: "Interview", offered: "Offer made", accepted: "Offer accepted", enrolled: "Enrolled", rejected: "Not successful", withdrawn: "Withdrawn" };

export default function TrackPage(props: { params: Promise<{ token: string }> }) {
  const { token } = use(props.params);
  const { data, error } = useApi<{ application: any; school: { name: string; logo_url: string | null; brand_color: string | null; phone: string | null; email: string | null }; application_fee: number; currency: string }>(`/api/apply/track/${token}`);
  if (error) return <main className="mx-auto max-w-xl p-6"><p className="rounded-lg bg-slate-100 p-4">{error}</p></main>;
  if (!data) return <main className="p-10 text-center text-sm text-slate-500">Loading…</main>;
  const a = data.application;
  const color = data.school.brand_color ?? "#1d5ddb";
  const idx = STEPS.indexOf(a.status);
  return (
    <main className="mx-auto max-w-xl p-6">
      <p className="text-sm font-semibold" style={{ color }}>{data.school.name}</p>
      <h1 className="text-2xl font-bold">{a.first_name} {a.last_name}</h1>
      <p className="text-sm text-slate-600">Application {a.application_no} · {a.applying_for} · received {fmtDate(a.created_at)}</p>
      {["rejected", "withdrawn"].includes(a.status) ? <p className="mt-4 rounded-lg bg-slate-100 p-4">{LABEL[a.status]}.{a.decision_note ? ` ${a.decision_note}` : ""}</p> : (
        <ol className="mt-5 space-y-2">{STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-3"><span className={"grid h-7 w-7 place-items-center rounded-full text-xs font-bold " + (i <= idx ? "text-white" : "bg-slate-200 text-slate-500")} style={i <= idx ? { background: color } : undefined}>{i < idx ? "✓" : i + 1}</span>
            <span className={i === idx ? "font-semibold" : "text-slate-500"}>{LABEL[s]}{s === "assessment" && a.assessment_at ? ` · ${fmtDate(a.assessment_at, true)}` : ""}{s === "interview" && a.interview_at ? ` · ${fmtDate(a.interview_at, true)}` : ""}</span></li>))}</ol>
      )}
      {a.decision_note && !["rejected", "withdrawn"].includes(a.status) && <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">{a.decision_note}</p>}
      {data.application_fee > 0 && <p className="mt-4 text-sm">Application fee {money(data.application_fee, data.currency)}: <b>{a.fee_paid ? "paid" : "not yet paid"}</b></p>}
      <p className="mt-6 text-xs text-slate-500">Questions? {data.school.phone ?? ""} {data.school.email ?? ""}</p>
    </main>
  );
}
