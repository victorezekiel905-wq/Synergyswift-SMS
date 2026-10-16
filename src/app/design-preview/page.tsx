"use client";
import { useState } from "react";
import { Page, PageHeader, Stat, Badge, Tabs, Alert, Empty, Field, Modal, Loading } from "@/components/ui";

/**
 * A page of the interface's parts with sample content, for reviewing the
 * design. Only available in builds made with NEXT_PUBLIC_DESIGN_PREVIEW=1.
 */
export default function DesignPreview() {
  const [tab, setTab] = useState<"overview" | "classes" | "fees">("overview");
  const [open, setOpen] = useState(false);
  if (process.env.NEXT_PUBLIC_DESIGN_PREVIEW !== "1") return <Page><Empty>Not available.</Empty></Page>;
  const rows = [
    ["Adaeze Okafor", "JSS1 Gold", "96%", "₦0", "green", "paid"],
    ["Tunde Bakare", "JSS1 Gold", "88%", "₦45,000", "amber", "part paid"],
    ["Chiamaka Eze", "JSS2 Blue", "99%", "₦0", "green", "paid"],
    ["Ibrahim Musa", "SS1 Science", "81%", "₦120,000", "red", "overdue"],
    ["Grace Adeyemi", "SS2 Arts", "94%", "₦0", "green", "paid"]
  ] as const;
  return (
    <Page wide>
      <PageHeader eyebrow="First Term 2026/2027" title="Greenfield College"
        subtitle="Live numbers from registers, results, fees and admissions."
        actions={<><button className="btn btn-outline">Export</button><button className="btn btn-primary" onClick={() => setOpen(true)}>New announcement</button></>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Stat label="Attendance today" value="96.4%" hint="12 absent" tone="good" />
        <Stat label="Registers taken" value="38 / 38" hint="all classes" />
        <Stat label="Fees collected this term" value="78%" hint="₦41.2m of ₦52.8m" tone="warn" />
        <Stat label="Past-due fees" value="₦6.3m" hint="41 invoices" tone="bad" />
        <Stat label="Applications in progress" value="64" hint="9 this week" />
      </div>
      <div className="mt-8"><Tabs tabs={[{ id: "overview", label: "Students" }, { id: "classes", label: "Classes" }, { id: "fees", label: "Fees" }]} value={tab} onChange={setTab} /></div>
      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card self-start overflow-x-auto lg:col-span-2">
          <table className="w-full whitespace-nowrap text-sm">
            <thead className="border-b border-slate-200 bg-slate-50/60 text-[13px] text-slate-500"><tr><th className="px-4 py-2.5 text-left">Student</th><th className="px-4 py-2.5 text-left">Class</th><th className="px-4 py-2.5 text-right">Attendance</th><th className="px-4 py-2.5 text-right">Owed</th><th className="px-4 py-2.5 text-left">Fees</th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r[0]} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                <td className="px-4 py-3 font-medium text-slate-900">{r[0]}</td><td className="px-4 py-3 text-slate-600">{r[1]}</td>
                <td className="px-4 py-3 text-right tabular-nums">{r[2]}</td><td className="px-4 py-3 text-right tabular-nums">{r[3]}</td>
                <td className="px-4 py-3"><Badge tone={r[4]}>{r[5]}</Badge></td>
              </tr>))}</tbody>
          </table>
        </section>
        <div className="space-y-4">
          <Alert tone="amber">Two registers are still open for period 3. Form tutors have been reminded.</Alert>
          <section className="card space-y-4 p-5">
            <h2 className="text-base font-semibold">Record a payment</h2>
            <Field label="Student"><input className="input" placeholder="Search by name or admission number" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount"><input className="input" defaultValue="45,000" /></Field>
              <Field label="Method"><select className="input"><option>Bank transfer</option><option>Cash</option><option>POS</option></select></Field>
            </div>
            <Field label="Note" hint="Shown on the receipt."><input className="input" /></Field>
            <div className="flex gap-2"><button className="btn btn-primary">Save payment</button><button className="btn btn-ghost">Cancel</button></div>
          </section>
          <details className="card p-4 text-sm"><summary className="font-medium">How collection rates are worked out</summary><p className="mt-2 text-slate-600">Paid divided by billed for invoices this term, leaving out void invoices.</p></details>
        </div>
      </div>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Empty>No complaints are waiting. New ones appear here as families raise them.</Empty>
        <div className="card"><Loading label="Loading timetable…" /></div>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="New announcement">
        <div className="space-y-4">
          <Field label="Title"><input className="input" defaultValue="Inter-house sports on Friday" /></Field>
          <Field label="Message"><textarea className="input" rows={4} defaultValue="Classes end at 12 noon. Parents may pick up children from the sports field." /></Field>
          <div className="flex justify-end gap-2"><button className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary">Send to families</button></div>
        </div>
      </Modal>
    </Page>
  );
}
