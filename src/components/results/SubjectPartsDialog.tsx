"use client";
import { useEffect, useState } from "react";
import { useApi, send, Modal, Alert, Loading } from "@/components/ui";
import PartsEditor, { PARTS_HINT, partsProblem, type Part } from "./PartsEditor";

type Info = {
  subject: string; class_name: string; can_set: boolean; why_not: string | null; scheme_name: string | null;
  school_parts: Part[]; own_parts: Part[] | null; marks_on_school_parts: number;
  siblings: { class_group_id: string; name: string; has_own: boolean }[];
};

/**
 * A subject teacher sets the parts for their own subject in a class (CAT 1, CAT 2, HW,
 * Test, Exam…), when the school allows it. Grades and the report card stay the school's.
 */
export default function SubjectPartsDialog({ cg, subject, onClose, onSaved }: { cg: string; subject: string; onClose: () => void; onSaved: () => void }) {
  const { data, error } = useApi<Info>(`/api/results/subject-parts?class_group_id=${cg}&subject_id=${subject}`, [cg, subject]);
  const [parts, setParts] = useState<Part[]>([]);
  const [also, setAlso] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Start from the subject's own parts, or a copy of the school's (new parts, so no ids).
  useEffect(() => {
    if (data) setParts(data.own_parts ?? data.school_parts.map(({ name, max_score, weight, midterm }) => ({ name, max_score, weight, midterm })));
  }, [data]);

  async function save() {
    const issue = partsProblem(parts);
    if (issue) { setProblem(issue); return; }
    setBusy(true); setProblem(null);
    const r = await send("/api/results/subject-parts", {
      class_group_id: cg, subject_id: subject, also_class_group_ids: [...also],
      parts: parts.map(p => ({ id: p.id, name: p.name.trim(), max_score: Number(p.max_score), weight: Number(p.weight), midterm: Boolean(p.midterm) }))
    }, "PUT");
    setBusy(false);
    if (r.ok) onSaved(); else setProblem(r.error);
  }
  async function useSchool() {
    if (!confirm(`Go back to the school's parts for ${data?.subject} in ${data?.class_name}?`)) return;
    setBusy(true);
    const r = await send(`/api/results/subject-parts?class_group_id=${cg}&subject_id=${subject}`, undefined, "DELETE");
    setBusy(false);
    if (r.ok) onSaved(); else setProblem(r.error);
  }

  const blocked = Boolean(data && !data.own_parts && data.marks_on_school_parts > 0);
  return (
    <Modal open onClose={onClose} wide title={data ? `${data.subject} in ${data.class_name}: its own parts` : "This subject's parts"}>
      {error && <Alert>{error}</Alert>}
      {!data && !error && <Loading />}
      {data && !data.can_set && <Alert tone="amber">{data.why_not}</Alert>}
      {data && data.can_set && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            {data.own_parts
              ? <>{data.subject} uses its own parts in {data.class_name}. </>
              : <>{data.subject} uses the school&apos;s parts from <b>{data.scheme_name}</b>. Change them below to give {data.subject} its own. </>}
            The grades, pass mark and report card stay the school&apos;s, so results still compare across subjects.
          </p>
          {blocked && (
            <Alert tone="amber">{data.marks_on_school_parts} mark{data.marks_on_school_parts === 1 ? " has" : "s have"} already been entered for {data.subject} in {data.class_name} with the school&apos;s parts. A subject can switch to its own parts before marks are entered. Ask an admin if those marks should be cleared first.</Alert>
          )}
          <p className="text-xs leading-relaxed text-slate-500">{PARTS_HINT}</p>
          <PartsEditor parts={parts} onChange={setParts} />
          {data.siblings.length > 0 && (
            <div className="rounded-md border border-slate-200 p-3">
              <p className="mb-2 text-sm font-medium">Use the same parts for your other {data.subject} classes in this year too</p>
              <div className="flex flex-wrap gap-1.5">
                {data.siblings.map(c => (
                  <label key={c.class_group_id} className={"flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm " + (also.has(c.class_group_id) ? "border-brand-600 bg-brand-50" : "border-slate-200")}>
                    <input type="checkbox" checked={also.has(c.class_group_id)} onChange={e => setAlso(s => { const n = new Set(s); if (e.target.checked) n.add(c.class_group_id); else n.delete(c.class_group_id); return n; })} />
                    {c.name}{c.has_own && <span className="text-[11px] text-slate-400">· has its own</span>}
                  </label>
                ))}
              </div>
            </div>
          )}
          {problem && <p role="alert" className="text-sm text-rose-700">{problem}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4">
            {data.own_parts ? <button type="button" className="btn btn-ghost text-sm" disabled={busy} onClick={useSchool}>Use the school&apos;s parts again</button> : <span />}
            <div className="flex gap-2">
              <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={busy || blocked} onClick={save}>{busy ? "Saving…" : "Save parts"}</button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
