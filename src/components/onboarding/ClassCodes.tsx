"use client";
import { useMemo, useState } from "react";
import { useApi, send, Alert, Badge, Empty, Loading } from "@/components/ui";
import type { ClassCodeRow } from "@/lib/onboarding-codes-server";

type Data = { admin: boolean; classes: { id: string; name: string }[]; selected: string | null; rows: ClassCodeRow[] };
export type CodeMode = "students" | "parents";

const HELP: Record<CodeMode, string> = {
  students: "Each student's own sign-up code. The student opens the sign-in page, chooses Student, then \"New student?\", and types it with an email and a password. Sent codes go to the student's parents.",
  parents: "Each child's parent code. A parent signs in (or makes their account) and types it under \"Add a child\": the child then shows on their page. One account can add every child they have; up to 4 parents per code."
};

/**
 * Codes class by class. Admins choose any class (or all); a class teacher sees only their own
 * class. Subject teachers and students never reach this (the server checks).
 */
export default function ClassCodes({ mode }: { mode: CodeMode }) {
  const [cls, setCls] = useState<string | null>(null);
  const { data, error, reload } = useApi<Data>(`/api/school/class-codes${cls ? `?class=${cls}` : ""}`, [cls]);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const rows = useMemo(() => (data?.rows ?? []).filter(r => !q.trim() || `${r.name} ${r.admission_no ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())), [data, q]);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  if (!data.classes.length) return <Empty>{data.admin ? "No classes yet. Add them under School setup." : "You are not the class teacher of any class, so there are no codes to show. Only a class's class teacher and the school's admins see its codes."}</Empty>;
  const kind = mode === "students" ? "student" : "parent_link";
  const codeOf = (r: ClassCodeRow) => (mode === "students" ? r.student_code : r.parent_code);
  const sendable = rows.filter(r => codeOf(r) && r.parents.length);
  const selected = data.selected ?? cls;

  async function act(body: Record<string, unknown>, ok: (d: any) => string) {
    const r = await send("/api/school/class-codes", body, "POST", { quiet: true });
    setMsg({ ok: r.ok, text: r.ok ? ok(r.data) : r.error ?? "failed" });
    if (r.ok) reload();
  }
  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); setMsg({ ok: true, text: "Copied." }); } catch { setMsg({ ok: false, text: "Copy is blocked in this browser: select the code and copy it." }); } };

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">{HELP[mode]}</p>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <select className="input w-auto" value={selected ?? ""} onChange={e => setCls(e.target.value || null)} aria-label="Class">
          {data.admin && <option value="">Choose a class</option>}
          {data.admin && <option value="all">All classes</option>}
          {data.classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input className="input w-56" placeholder="Find a student" value={q} onChange={e => setQ(e.target.value)} aria-label="Find a student" />
        <span className="ml-auto" />
        <button className="btn btn-outline" disabled={!sendable.length} onClick={() => confirm(`Send ${mode === "students" ? "sign-up" : "parent"} codes for the ${sendable.length} student${sendable.length === 1 ? "" : "s"} shown to their parents?`)
          && act({ action: "send", kind, ids: sendable.map(r => r.id) }, d => `${d.messages} message${d.messages === 1 ? "" : "s"} sent.${d.skipped ? ` ${d.skipped} had no parent contact on record: print their slips.` : ""}`)}>Send to parents</button>
        <button className="btn btn-outline" disabled={!rows.length} onClick={() => window.print()}>Print slips</button>
      </div>
      {!selected ? <Empty>Choose a class to see its codes.</Empty> : !rows.length ? <Empty>No students in this class.</Empty> : (
        <div className="card overflow-x-auto print:border-0 print:shadow-none">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 print:hidden">
              <tr><th className="p-3">Student</th><th className="p-3">{mode === "students" ? "Sign-up code" : "Parent code"}</th><th className="p-3">{mode === "students" ? "Account" : "Parents linked"}</th><th className="p-3 text-right">Actions</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(r => {
                const code = codeOf(r);
                return (
                  <tr key={r.id} className="break-inside-avoid">
                    <td className="p-3"><b>{r.name}</b><span className="block text-xs text-slate-500">{[r.admission_no, r.class_name].filter(Boolean).join(" · ")}</span></td>
                    <td className="p-3">
                      {mode === "students" && r.has_account ? <Badge tone="green">Has an account</Badge>
                        : code ? <span className="font-mono text-base tracking-widest">{code}</span> : <Badge tone="amber">{mode === "parents" ? "All uses spent" : "No code"}</Badge>}
                      <span className="hidden text-xs text-slate-600 print:block">{mode === "students" ? `${r.name}: sign in → Student → "New student?" → type this code.` : `Parent of ${r.name}: sign in → "Add a child" → type this code.`}</span>
                    </td>
                    <td className="p-3 text-xs text-slate-600">
                      {mode === "students" ? (r.has_account ? "Signed up" : "Not yet") : r.parents.length
                        ? r.parents.map(p => <span key={p.name} className="block">{p.name}{p.has_account ? "" : " (no account yet)"}</span>)
                        : "None yet"}
                      {mode === "parents" && code && <span className="block text-slate-400">{r.parent_uses} of {r.parent_max} uses</span>}
                    </td>
                    <td className="p-3 text-right print:hidden">
                      <div className="flex flex-wrap justify-end gap-1">
                        {code && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => copy(code)}>Copy</button>}
                        {code && r.parents.length > 0 && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => act({ action: "send", kind, ids: [r.id] }, d => d.messages ? "Sent to the parents." : "No parent contact on record: hand the code over in person.")}>Send</button>}
                        {data.admin && (mode === "parents" || !r.has_account) && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => confirm("Make a new code? The old one stops working.") && act({ action: "new_code", kind, id: r.id }, d => `New code: ${d.code}`)}>New code</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
