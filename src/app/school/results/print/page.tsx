"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useApi, Loading, Alert } from "@/components/ui";
import ReportCardView, { type ReportCard, type SchoolBrand } from "@/components/results/ReportCardView";
import { ordinal } from "@/lib/grading";

type Card = ReportCard & { id: string; student_id: string; access_token: string };

export default function PrintResultsPage() {
  return <Suspense fallback={<Loading />}><PrintInner /></Suspense>;
}

/**
 * Whole-class printing (Print → Save as PDF gives one PDF for the class):
 *  view=cards       every report card, one per page
 *  view=broadsheet  every student × subject total and grade, with averages and positions
 *  view=master      master score sheet: every assessment score, one subject per page
 */
function PrintInner() {
  const p = useSearchParams();
  const term = p.get("term") ?? "", cg = p.get("class") ?? "", kind = p.get("kind") === "midterm" ? "midterm" : "term", view = p.get("view") ?? "cards";
  const { data: cards, error } = useApi<Card[]>(term && cg ? `/api/results/report-cards?term_id=${term}&class_group_id=${cg}&kind=${kind}` : null);
  const { data: s } = useApi<{ settings: SchoolBrand; tenant: { name: string } }>("/api/school/settings");
  if (error) return <Alert>{error}</Alert>;
  if (!cards || !s) return <Loading />;
  if (!cards.length) return <Alert tone="amber">No report cards for this class yet. Compile them first.</Alert>;
  const first = cards[0].data;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const subjects: { subject_id: string; subject: string }[] = [];
  for (const c of cards) for (const x of c.data.subjects ?? []) if (!subjects.some(y => y.subject_id === x.subject_id)) subjects.push({ subject_id: x.subject_id, subject: x.subject });
  subjects.sort((a, b) => a.subject.localeCompare(b.subject));
  const sorted = [...cards].sort((a, b) => (a.position ?? 9999) - (b.position ?? 9999) || String(a.data.student_name).localeCompare(String(b.data.student_name)));
  const title = `${s.settings?.school_name ?? s.tenant?.name ?? ""} · ${first.class_name ?? ""} · ${first.term_label ?? ""}`;
  const th = "border border-slate-400 p-1";
  const td = "border border-slate-300 p-1";

  return (
    <main className="bg-white text-slate-900">
      <div className="flex items-center gap-2 p-4 print:hidden">
        <p className="text-sm text-slate-600">{cards.length} students. Use your browser&apos;s Print and choose “Save as PDF” for one file.</p>
        <button className="btn btn-primary ml-auto" onClick={() => window.print()}>Print / save as PDF</button>
      </div>

      {view === "cards" && cards.map(c => (
        <div key={c.id} className="break-after-page">
          <ReportCardView card={c} school={s.settings} tenantName={s.tenant?.name} verifyUrl={`${origin}/r/${c.access_token}`} />
        </div>
      ))}

      {view === "broadsheet" && (
        <section className="p-4 print:p-0">
          <h1 className="mb-2 text-lg font-bold">Broadsheet: {title}</h1>
          <div className="overflow-x-auto print:overflow-visible">
            <table className="w-full border-collapse text-[11px]">
              <thead><tr className="bg-slate-100">
                <th className={th}>Pos</th><th className={th + " text-left"}>Student</th><th className={th}>Adm. no</th>
                {subjects.map(x => <th key={x.subject_id} className={th}><span className="block max-w-[70px] leading-tight">{x.subject}</span></th>)}
                <th className={th}>Total</th><th className={th}>Average</th>{first.cumulative && <th className={th}>Session avg</th>}<th className={th}>Passed</th>
              </tr></thead>
              <tbody>{sorted.map(c => {
                const by = new Map((c.data.subjects ?? []).map(x => [x.subject_id, x]));
                return (
                  <tr key={c.id}>
                    <td className={td + " text-center"}>{c.position ? ordinal(c.position) : "—"}</td>
                    <td className={td}>{c.data.student_name}</td><td className={td + " text-center"}>{c.data.admission_no}</td>
                    {subjects.map(x => { const r = by.get(x.subject_id); return <td key={x.subject_id} className={td + " text-center tabular-nums"}>{r?.total ?? "—"}{r?.grade ? <span className="ml-0.5 text-[9px] text-slate-500">{r.grade}</span> : null}</td>; })}
                    <td className={td + " text-center font-semibold"}>{c.total}</td><td className={td + " text-center font-semibold"}>{c.average}</td>
                    {first.cumulative && <td className={td + " text-center"}>{c.data.cumulative?.average ?? "—"}</td>}
                    <td className={td + " text-center"}>{(c.data.subjects ?? []).filter(x => x.total !== null && x.total >= Number(c.data.scheme?.pass_mark ?? 40)).length}/{(c.data.subjects ?? []).filter(x => x.total !== null).length}</td>
                  </tr>
                );
              })}</tbody>
              <tfoot><tr className="bg-slate-50 font-semibold">
                <td className={td} colSpan={3}>Class average</td>
                {subjects.map(x => { const r = cards.find(c => c.data.subjects?.some(y => y.subject_id === x.subject_id))?.data.subjects?.find(y => y.subject_id === x.subject_id); return <td key={x.subject_id} className={td + " text-center"}>{r?.class_average ?? "—"}</td>; })}
                <td className={td} /><td className={td + " text-center"}>{(() => { const v = cards.map(c => Number(c.average)).filter(Number.isFinite); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : "—"; })()}</td>
                {first.cumulative && <td className={td} />}<td className={td} />
              </tr></tfoot>
            </table>
          </div>
        </section>
      )}

      {view === "master" && subjects.map(x => {
        const comps = first.components ?? [];
        const rows = sorted.map(c => ({ c, r: (c.data.subjects ?? []).find(y => y.subject_id === x.subject_id) })).filter(v => v.r && v.r.total !== null)
          .sort((a, b) => (a.r!.position ?? 9999) - (b.r!.position ?? 9999));
        return (
          <section key={x.subject_id} className="break-after-page p-4 print:p-0">
            <h1 className="text-lg font-bold">Master score sheet: {x.subject}</h1>
            <p className="mb-2 text-xs text-slate-600">{title}</p>
            <table className="w-full border-collapse text-xs">
              <thead><tr className="bg-slate-100"><th className={th}>S/N</th><th className={th + " text-left"}>Student</th><th className={th}>Adm. no</th>
                {comps.map(cp => <th key={cp.id} className={th}>{cp.name} /{cp.max_score}</th>)}<th className={th}>Total</th><th className={th}>Grade</th><th className={th}>Position</th><th className={th + " text-left"}>Remark</th></tr></thead>
              <tbody>{rows.map(({ c, r }, i) => (
                <tr key={c.id}><td className={td + " text-center"}>{i + 1}</td><td className={td}>{c.data.student_name}</td><td className={td + " text-center"}>{c.data.admission_no}</td>
                  {comps.map(cp => <td key={cp.id} className={td + " text-center tabular-nums"}>{r!.components?.[cp.id] ?? "—"}</td>)}
                  <td className={td + " text-center font-semibold"}>{r!.total}</td><td className={td + " text-center"}>{r!.grade}</td><td className={td + " text-center"}>{ordinal(r!.position)}</td><td className={td}>{r!.remark}</td></tr>
              ))}</tbody>
            </table>
            <p className="mt-2 text-xs">Highest {rows[0]?.r?.highest ?? "—"} · Lowest {rows[0]?.r?.lowest ?? "—"} · Class average {rows[0]?.r?.class_average ?? "—"}</p>
            <div className="mt-8 grid grid-cols-3 gap-6 text-xs"><p className="border-t border-slate-400 pt-1">Subject teacher</p><p className="border-t border-slate-400 pt-1">Head of department</p><p className="border-t border-slate-400 pt-1">Principal</p></div>
          </section>
        );
      })}
    </main>
  );
}
