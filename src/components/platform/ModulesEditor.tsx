"use client";
import { MODULE_GROUPS, moduleLabel, type OverrideMode } from "@/lib/saas";
import { Badge } from "@/components/ui";

export type ModuleRowView = { key: string; label: string; group: string; fromPlan: boolean; mode: OverrideMode; expires_at: string | null; expired: boolean; effective: boolean };
export type Draft = Record<string, { mode: OverrideMode; expires_at: string; note: string }>;

const MODES: { id: OverrideMode; label: string }[] = [{ id: "inherit", label: "Plan" }, { id: "on", label: "On" }, { id: "off", label: "Off" }];

export const draftFrom = (rows: ModuleRowView[]): Draft =>
  Object.fromEntries(rows.map(r => [r.key, { mode: r.expired ? "inherit" : r.mode, expires_at: !r.expired && r.expires_at ? r.expires_at.slice(0, 10) : "", note: "" }]));

/** What the draft would make each module, before saving. */
export function effectiveOf(r: ModuleRowView, d: Draft[string] | undefined) {
  const mode = d?.mode ?? "inherit";
  const live = !d?.expires_at || new Date(`${d.expires_at}T23:59:59`) > new Date();
  return mode === "on" && live ? true : mode === "off" && live ? false : r.fromPlan;
}

/**
 * Module switches for one school: PLAN (follow the plan) / ON / OFF, each
 * with an optional end date. The effective state shows before saving.
 */
export default function ModulesEditor({ rows, draft, setDraft, readOnly }: { rows: ModuleRowView[]; draft: Draft; setDraft: (d: Draft) => void; readOnly?: boolean }) {
  const set = (k: string, p: Partial<Draft[string]>) => setDraft({ ...draft, [k]: { ...(draft[k] ?? { mode: "inherit", expires_at: "", note: "" }), ...p } });
  return (
    <div className="space-y-5">
      {MODULE_GROUPS.map(g => (
        <div key={g.key}>
          <p className="mb-1 text-sm font-semibold">{g.label} <span className="font-normal text-slate-500">· {g.hint}</span></p>
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {rows.filter(r => r.group === g.key).map(r => {
              const d = draft[r.key];
              const eff = effectiveOf(r, d);
              const changed = eff !== r.effective;
              return (
                <div key={r.key} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                  <span className="min-w-[200px] flex-1">{moduleLabel(r.key)}<span className="ml-2 text-xs text-slate-500">{r.fromPlan ? "in plan" : "not in plan"}</span></span>
                  <div className="inline-flex overflow-hidden rounded-md border border-slate-300" role="radiogroup" aria-label={`${r.label} setting`}>
                    {MODES.map(m => (
                      <button key={m.id} type="button" role="radio" aria-checked={(d?.mode ?? "inherit") === m.id} disabled={readOnly}
                        onClick={() => set(r.key, { mode: m.id, ...(m.id === "inherit" ? { expires_at: "" } : {}) })}
                        className={"px-2.5 py-1 text-xs font-medium " + ((d?.mode ?? "inherit") === m.id ? (m.id === "off" ? "bg-rose-600 text-white" : m.id === "on" ? "bg-emerald-600 text-white" : "bg-slate-700 text-white") : "bg-white text-slate-700 hover:bg-slate-50")}>{m.label}</button>
                    ))}
                  </div>
                  <label className={"flex items-center gap-1 text-xs " + ((d?.mode ?? "inherit") === "inherit" ? "invisible max-sm:hidden" : "")}>until
                    <input type="date" className="input w-36 py-0.5 text-xs" value={d?.expires_at ?? ""} disabled={readOnly} onChange={e => set(r.key, { expires_at: e.target.value })} aria-label={`${r.label} end date`} />
                  </label>
                  <span className="text-right sm:w-28">{eff ? <Badge tone="green">{changed ? "will be on" : "on"}</Badge> : <Badge tone={changed ? "amber" : "slate"}>{changed ? "will be off" : "off"}</Badge>}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
