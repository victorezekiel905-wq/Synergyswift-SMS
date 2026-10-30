"use client";
import { useState } from "react";
import { MODULE_GROUPS, moduleLabel, type OverrideMode } from "@/lib/saas";
import { Badge } from "@/components/ui";

export type ModuleRowView = { key: string; label: string; group: string; fromPlan: boolean; mode: OverrideMode; expires_at: string | null; expired: boolean; effective: boolean };
export type Draft = Record<string, { mode: OverrideMode; expires_at: string; note: string }>;

const MODES: { id: OverrideMode; label: string }[] = [{ id: "inherit", label: "Plan" }, { id: "on", label: "On" }, { id: "off", label: "Off" }];

export const draftFrom = (rows: ModuleRowView[]): Draft =>
  Object.fromEntries(rows.map(r => [r.key, { mode: r.expired ? "inherit" : r.mode, expires_at: !r.expired && r.expires_at ? r.expires_at.slice(0, 10) : "", note: "" }]));

const BLANK: Draft[string] = { mode: "inherit", expires_at: "", note: "" };

/** Every module (or every module in one area) set to the same switch. "Plan" clears the end date. */
export function setAllModes(draft: Draft, keys: string[], mode: OverrideMode): Draft {
  const next = { ...draft };
  for (const k of keys) next[k] = { ...(draft[k] ?? BLANK), mode, ...(mode === "inherit" ? { expires_at: "" } : {}) };
  return next;
}

/** One end date for every module switched On or Off ("" removes their end dates); modules following the plan have none. */
export function dateForSwitched(draft: Draft, keys: string[], date: string): Draft {
  const next = { ...draft };
  for (const k of keys) if (draft[k] && draft[k].mode !== "inherit") next[k] = { ...draft[k], expires_at: date };
  return next;
}

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
  const [until, setUntil] = useState("");
  const set = (k: string, p: Partial<Draft[string]>) => setDraft({ ...draft, [k]: { ...(draft[k] ?? BLANK), ...p } });
  const keys = rows.map(r => r.key);
  const switched = keys.filter(k => draft[k] && draft[k].mode !== "inherit").length;
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  return (
    <div className="space-y-5">
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
          <span className="font-medium">Every module:</span>
          <div className="flex gap-1.5">
            <button type="button" className="btn btn-sm bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setDraft(setAllModes(draft, keys, "on"))}>All on</button>
            <button type="button" className="btn btn-sm bg-rose-600 text-white hover:bg-rose-700" onClick={() => setDraft(setAllModes(draft, keys, "off"))}>All off</button>
            <button type="button" className="btn btn-sm btn-outline" onClick={() => setDraft(setAllModes(draft, keys, "inherit"))}>All follow plan</button>
          </div>
          <label className="flex items-center gap-1.5">
            <span className="text-slate-600">until</span>
            <input type="date" className="input w-36 py-0.5 text-xs" min={tomorrow} value={until} onChange={e => setUntil(e.target.value)} aria-label="End date for every module switched on or off" />
          </label>
          <button type="button" className="btn btn-sm btn-outline" disabled={!switched} onClick={() => setDraft(dateForSwitched(draft, keys, until))}
            title={switched ? undefined : "Switch modules on or off first; modules following the plan have no end date"}>
            {until ? `Apply date to ${switched} switched` : `Clear dates on ${switched} switched`}
          </button>
        </div>
      )}
      {MODULE_GROUPS.map(g => (
        <div key={g.key}>
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold">{g.label} <span className="font-normal text-slate-500">· {g.hint}</span></p>
            {!readOnly && (
              <span className="flex gap-2 text-xs">
                <button type="button" className="text-emerald-700 hover:underline" onClick={() => setDraft(setAllModes(draft, rows.filter(r => r.group === g.key).map(r => r.key), "on"))}>All on</button>
                <button type="button" className="text-rose-700 hover:underline" onClick={() => setDraft(setAllModes(draft, rows.filter(r => r.group === g.key).map(r => r.key), "off"))}>All off</button>
                <button type="button" className="text-slate-600 hover:underline" onClick={() => setDraft(setAllModes(draft, rows.filter(r => r.group === g.key).map(r => r.key), "inherit"))}>Plan</button>
              </span>
            )}
          </div>
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
                    <input type="date" className="input w-36 py-0.5 text-xs" min={tomorrow} value={d?.expires_at ?? ""} disabled={readOnly} onChange={e => set(r.key, { expires_at: e.target.value })} aria-label={`${r.label} end date`} />
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
