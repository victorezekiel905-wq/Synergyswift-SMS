"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useApi, send, Page, PageHeader, Alert, Field, Loading } from "@/components/ui";
import PlatformNav from "@/components/platform/PlatformNav";
import PlanPicker, { emptyChoice, type PlanChoice, type PlanOption } from "@/components/platform/PlanPicker";
import ModulesEditor, { effectiveOf, type Draft, type ModuleRowView } from "@/components/platform/ModulesEditor";
import { resolveModules, planModules, moduleLabel, naira } from "@/lib/saas";

const ROLE_LABELS: Record<string, string> = {
  school_admin: "School admin", principal: "Principal", teacher: "Teacher", it_admin: "IT admin", bursar: "Bursar", librarian: "Librarian",
  hr_manager: "HR manager", qa_officer: "QA officer", gate_officer: "Gate officer", transport_officer: "Transport officer",
  hostel_warden: "Hostel warden", nurse: "Nurse", admissions_officer: "Admissions officer", cashier: "Cashier", counsellor: "Counsellor", exam_officer: "Exam officer"
};
const STEPS = ["School", "Plan", "Modules", "Roles", "Check and create"] as const;

/**
 * Onboarding a school: details and first admin, the plan it paid for, any
 * module switches, the staff roles it may use, then one check before creating.
 */
export default function NewSchool() {
  const router = useRouter();
  const { data: catalog } = useApi<{ plans: PlanOption[]; group_prices: Record<string, number[]> }>("/api/platform/plans");
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ name: "", slug: "", country: "Nigeria", timezone: "Africa/Lagos", admin_name: "", admin_email: "", student_limit: "" });
  const [plan, setPlan] = useState<PlanChoice>(emptyChoice());
  const [usePlan, setUsePlan] = useState(true);
  const [draft, setDraft] = useState<Draft>({});
  const [roles, setRoles] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // From the sales CRM: /platform/new?lead=<id> fills in the school, its contact and the quoted plan.
  const [leadId, setLeadId] = useState<string | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("lead");
    if (!id) return;
    setLeadId(id);
    fetch(`/api/platform/sales?lead=${id}`).then(r => (r.ok ? r.json() : null)).then(d => {
      if (!d?.lead) return;
      const l = d.lead;
      setF(cur => ({ ...cur, name: l.school_name ?? cur.name, admin_name: l.contact_name ?? cur.admin_name, admin_email: l.email ?? cur.admin_email,
        student_limit: l.students_estimate ? String(l.students_estimate) : cur.student_limit }));
      const q = (d.quotes ?? []).find((x: { status: string }) => x.status === "accepted") ?? (d.quotes ?? [])[0];
      if (q) setPlan(cur => ({ ...cur, plan_code: q.plan_code, band: q.band, cycle: q.cycle, add_on_groups: q.add_on_groups ?? [], custom_annual: q.custom_annual ?? null,
        discount_pct: Number(q.discount_pct ?? 0), notes: `From quote ${q.number}` }));
    }).catch(() => {});
  }, []);
  const chosen = catalog?.plans.find(p => p.code === plan.plan_code);

  const rows: ModuleRowView[] = useMemo(() => {
    const mods = usePlan && chosen ? planModules(chosen.groups, plan.add_on_groups) : null;
    return resolveModules(mods, []).rows.map(r => ({ ...r, expires_at: null }));
  }, [usePlan, chosen, plan.add_on_groups]);
  const finalOn = rows.filter(r => effectiveOf(r, draft[r.key]));
  const slug = f.slug || f.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

  function next() {
    setErr(null);
    if (step === 0 && (!f.name.trim() || !f.admin_name.trim() || !/\S+@\S+\.\S+/.test(f.admin_email))) return setErr("Enter the school's name and its first admin's name and email.");
    if (step === 1 && usePlan && (plan.band === null || !chosen?.prices) && plan.custom_annual == null) return setErr("Enter the agreed yearly price.");
    setStep(s => Math.min(STEPS.length - 1, s + 1));
  }

  async function create() {
    setBusy(true); setErr(null);
    const overrides = Object.entries(draft).filter(([, d]) => d.mode !== "inherit").map(([module, d]) => ({ module, mode: d.mode, expires_at: d.expires_at ? new Date(`${d.expires_at}T23:59:59`).toISOString() : null, note: d.note || null }));
    const r = await send<{ id: string; invoice: { number: string } | null }>("/api/platform/tenants", {
      ...f, slug, student_limit: f.student_limit ? Number(f.student_limit) : null, overrides, allowed_roles: roles, ...(leadId ? { lead_id: leadId } : {}),
      subscription: usePlan ? { ...plan, notes: plan.notes || null, custom_annual: plan.custom_annual } : undefined
    });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    router.push(`/platform/${r.data.id}?created=1`);
  }

  if (!catalog) return <Page wide><PlatformNav /><Loading /></Page>;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF(p => ({ ...p, [k]: e.target.value }));
  return (
    <Page wide>
      <PlatformNav />
      <PageHeader eyebrow="Onboarding" title="New school" subtitle="Five short steps. Nothing is created until the last one." />
      <ol className="mb-6 flex flex-wrap gap-2 text-sm">
        {STEPS.map((s, i) => (
          <li key={s}><button type="button" disabled={i > step} onClick={() => setStep(i)}
            className={"rounded-full px-3 py-1 " + (i === step ? "bg-brand-600 text-white" : i < step ? "bg-brand-50 text-brand-800" : "bg-slate-100 text-slate-500")}>{i + 1}. {s}</button></li>
        ))}
      </ol>
      <section className="card p-5">
        {step === 0 && (
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="School name"><input className="input" value={f.name} onChange={set("name")} required /></Field>
            <Field label="Short name for links" hint={`Becomes ${slug || "school-name"}. Leave blank to use the name.`}><input className="input" value={f.slug} onChange={set("slug")} /></Field>
            <Field label="Country"><input className="input" value={f.country} onChange={set("country")} /></Field>
            <Field label="Time zone"><input className="input" value={f.timezone} onChange={set("timezone")} /></Field>
            <Field label="First admin's name"><input className="input" value={f.admin_name} onChange={set("admin_name")} /></Field>
            <Field label="First admin's email" hint="They get an invitation to set a password."><input className="input" type="email" value={f.admin_email} onChange={set("admin_email")} /></Field>
            <Field label="Student limit (optional)"><input className="input" type="number" min={1} value={f.student_limit} onChange={set("student_limit")} /></Field>
          </div>
        )}
        {step === 1 && (
          <div className="space-y-4">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={usePlan} onChange={e => setUsePlan(e.target.checked)} /> Put this school on a plan now (untick for a school still deciding: every module stays on, no bill)</label>
            {usePlan && <PlanPicker plans={catalog.plans} groupPrices={catalog.group_prices} value={plan} onChange={setPlan} />}
          </div>
        )}
        {step === 2 && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">Modules follow the plan. Switch any of them on or off for this school, for good or until a date (a free trial of a module, or a module the school does not want).</p>
            <ModulesEditor rows={rows} draft={draft} setDraft={setDraft} />
          </div>
        )}
        {step === 3 && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">Staff roles this school may give its people. School admin, principal and teacher are always allowed. The school&apos;s admins can make their own roles from these.</p>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={roles === null} onChange={e => setRoles(e.target.checked ? null : ["school_admin", "principal", "teacher"])} /> Every role</label>
            {roles !== null && (
              <div className="grid gap-2 sm:grid-cols-3">
                {Object.keys(ROLE_LABELS).map(r => (
                  <label key={r} className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={["school_admin", "principal", "teacher"].includes(r)} checked={roles.includes(r) || ["school_admin", "principal", "teacher"].includes(r)}
                    onChange={e => setRoles(e.target.checked ? [...roles, r] : roles.filter(x => x !== r))} /> {ROLE_LABELS[r] ?? r}</label>
                ))}
              </div>
            )}
          </div>
        )}
        {step === 4 && (
          <div className="grid gap-4 text-sm md:grid-cols-2">
            <div className="space-y-1">
              <p className="label">School</p>
              <p className="text-base font-semibold">{f.name}</p>
              <p>{f.country} · {f.timezone} · link name {slug}</p>
              <p>First admin: {f.admin_name} ({f.admin_email})</p>
              <p className="label pt-3">Plan</p>
              {usePlan && chosen ? <p>{chosen.name}{plan.add_on_groups.length ? ` + ${plan.add_on_groups.join(", ")}` : ""}, {plan.cycle === "annual" ? "yearly" : "termly"}{plan.status === "trial" ? ", 30-day trial" : ""}{plan.discount_pct ? `, ${plan.discount_pct}% off` : ""}{plan.custom_annual ? `, agreed ${naira(plan.custom_annual)} a year` : ""}{plan.issue_invoice && plan.status !== "trial" ? ". First invoice sent on creation." : "."}</p> : <p>No plan yet: every module on, no bill.</p>}
              <p className="label pt-3">Roles</p>
              <p>{roles === null ? "Every role" : ["school_admin", "principal", "teacher", ...roles.filter(r => !["school_admin", "principal", "teacher"].includes(r))].map(r => ROLE_LABELS[r] ?? r).join(", ")}</p>
            </div>
            <div>
              <p className="label">Modules switched on ({finalOn.length})</p>
              <p className="leading-relaxed">{finalOn.map(r => moduleLabel(r.key)).join(" · ") || "None"}</p>
              <p className="label pt-3">Off</p>
              <p className="leading-relaxed text-slate-600">{rows.filter(r => !effectiveOf(r, draft[r.key])).map(r => moduleLabel(r.key)).join(" · ") || "None"}</p>
            </div>
          </div>
        )}
        {err && <div className="mt-4"><Alert>{err}</Alert></div>}
        <div className="mt-6 flex justify-between">
          <button type="button" className="btn btn-ghost" disabled={step === 0} onClick={() => setStep(s => s - 1)}>Back</button>
          {step < STEPS.length - 1
            ? <button type="button" className="btn btn-primary" onClick={next}>Next</button>
            : <button type="button" className="btn btn-primary" disabled={busy} onClick={create}>{busy ? "Creating…" : "Create school"}</button>}
        </div>
      </section>
    </Page>
  );
}

