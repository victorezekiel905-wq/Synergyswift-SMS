"use client";
import { useEffect, useState } from "react";
import { useApi, Page, PageHeader, Alert, Loading, Empty } from "@/components/ui";
import StudentAnalysisView from "@/components/analysis/StudentAnalysisView";
import type { StudentAnalysis } from "@/lib/analysis-student-server";

type Data = { children: { id: string; name: string; class_name: string | null }[]; currency?: string; analysis: StudentAnalysis | null };

/** Parents: each child's analysis across every module the school uses. */
export default function ParentAnalysisPage() {
  const [child, setChild] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => { const q = new URLSearchParams(window.location.search); setChild(q.get("child")); setToken(q.get("token")); }, []);
  const qs = new URLSearchParams({ ...(child ? { student_id: child } : {}), ...(token ? { token } : {}) }).toString();
  const { data, error } = useApi<Data>(`/api/family/analysis${qs ? `?${qs}` : ""}`);
  const pick = (id: string) => { setChild(id); const u = new URL(window.location.href); u.searchParams.set("child", id); window.history.replaceState(null, "", u); };
  return (
    <Page wide>
      <PageHeader eyebrow="My children" title="Child analysis" subtitle="How each child is doing across the school: attendance, results, homework, tests, behaviour, learning, activities, health, library, fees and the tuck shop." />
      {error ? <Alert>{error}</Alert> : !data ? <Loading label="Bringing your child's figures together…" /> : !data.children.length ? <Empty>No children are linked to your account yet. Add a child with their parent code on your page.</Empty> : (
        <>
          {data.children.length > 1 && (
            <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="Choose a child">
              {data.children.map(c => {
                const on = (data.analysis?.student.id ?? child) === c.id;
                return <button key={c.id} role="tab" aria-selected={on} onClick={() => pick(c.id)}
                  className={"rounded-full border px-3.5 py-1.5 text-sm " + (on ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white hover:border-brand-400")}>
                  {c.name}{c.class_name ? <span className={on ? "text-white/80" : "text-slate-500"}> · {c.class_name}</span> : null}</button>;
              })}
            </div>
          )}
          {data.analysis && <StudentAnalysisView a={data.analysis} currency={data.currency ?? "NGN"} forParent />}
        </>
      )}
    </Page>
  );
}
