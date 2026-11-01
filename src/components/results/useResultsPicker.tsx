"use client";
import { useEffect, useMemo, useState } from "react";
import { useApi, Field } from "@/components/ui";

export type ResultsSession = { id: string; name: string; terms: { id: string; name: string; is_current: boolean }[] };
export type ResultsStructure = {
  class_groups: { id: string; name: string; form_teacher_id: string | null; scheme_id?: string | null; students?: number }[];
  subjects: { id: string; name: string; department_id?: string | null }[];
  offerings: { class_group_id: string; subject_id: string; teacher_id: string | null }[];
  departments?: { id: string; name: string; head_user_id: string | null }[];
};
type SchemeLite = { id: string; template?: string | null; is_default: boolean };

const read = (k: string) => { try { return sessionStorage.getItem(k) ?? ""; } catch { return ""; } };
const write = (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* storage blocked */ } };

/**
 * The term and class every results page works on. The choice carries from page to
 * page (Score entry → Report cards …), and `which` limits the classes to preschool
 * ones, the rest, or all.
 */
export function useResultsPicker(which: "all" | "preschool" | "graded" = "all") {
  const { data: sessions } = useApi<ResultsSession[]>("/api/school/academic");
  const { data: structure } = useApi<ResultsStructure>("/api/school/structure");
  const { data: schemes } = useApi<SchemeLite[]>("/api/school/grading");
  const [termId, setTermId] = useState("");
  const [cg, setCg] = useState("");
  // Restored after mount (not during render), so the server and browser draw the same first page.
  useEffect(() => { setTermId(t => t || read("results:term")); setCg(c => c || read("results:class")); }, []);

  // A class with no grading system of its own uses the school default.
  const early = useMemo(() => {
    const byId = new Map((schemes ?? []).map(s => [s.id, s]));
    const fallback = (schemes ?? []).find(s => s.is_default) ?? (schemes ?? [])[0];
    return new Set((structure?.class_groups ?? []).filter(g => (g.scheme_id ? byId.get(g.scheme_id) : fallback)?.template === "early_years").map(g => g.id));
  }, [schemes, structure]);
  const classes = useMemo(() => (structure?.class_groups ?? []).filter(g => which === "all" || (which === "preschool") === early.has(g.id)), [structure, early, which]);

  useEffect(() => {
    if (!sessions) return;
    const terms = sessions.flatMap(s => s.terms);
    if (termId && terms.some(t => t.id === termId)) return;
    const cur = terms.find(t => t.is_current) ?? terms[0];
    if (cur) setTermId(cur.id);
  }, [sessions, termId]);
  useEffect(() => {
    if (!structure || !schemes) return;
    if (cg && classes.some(g => g.id === cg)) return;
    setCg(classes[0]?.id ?? "");
  }, [structure, schemes, classes, cg]);
  useEffect(() => { if (termId) write("results:term", termId); }, [termId]);
  useEffect(() => { if (cg) write("results:class", cg); }, [cg]);

  const picker = (
    <div className="mb-5 flex flex-wrap gap-3">
      <Field label="Term">
        <select className="input min-w-[220px]" value={termId} onChange={e => setTermId(e.target.value)}>
          {(sessions ?? []).map(s => <optgroup key={s.id} label={s.name}>{s.terms.map(t => <option key={t.id} value={t.id}>{t.name} {s.name}{t.is_current ? " (current)" : ""}</option>)}</optgroup>)}
        </select>
      </Field>
      <Field label="Class">
        <select className="input min-w-[180px]" value={cg} onChange={e => setCg(e.target.value)} disabled={!classes.length}>
          {!classes.length && <option value="">{which === "preschool" ? "No preschool classes yet" : "No classes yet"}</option>}
          {classes.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </Field>
    </div>
  );
  return { sessions, structure, termId, cg, classes, early, picker, loaded: Boolean(sessions && structure && schemes) };
}
