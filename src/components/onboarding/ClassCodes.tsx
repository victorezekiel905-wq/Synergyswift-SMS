"use client";
import { useMemo, useState } from "react";
import { useApi, send, Alert, Badge, Empty, Loading } from "@/components/ui";
import type { ClassCodeRow } from "@/lib/onboarding-codes-server";

type Data = { admin: boolean; classes: { id: string; name: string }[]; selected: string | null; rows: ClassCodeRow[] };
type Login = { id: string; name: string; username: string | null; password: string | null; sent?: number; error?: string };
export type CodeMode = "students" | "parents";

const HELP: Record<CodeMode, string> = {
  students: "Each student signs in with a username and a one-time password, then chooses their own password before anything opens. The one-time password is shown to you once and sent to the student's parents. Students see their own class, lessons, results and analysis.",
  parents: "Each parent signs in with their email and a one-time password, then chooses their own password before anything opens. Their children linked here show on their page at once. To add another child, they type that child's code under \"Add a child\" (up to 4 parents per code)."
};

/** Who is where: no login, waiting to choose their own password, or signed in. */
function state(hasAccount: boolean, signedIn: boolean | null, mustChange = false): { tone: "green" | "amber" | "slate"; text: string } {
  if (!hasAccount) return { tone: "slate", text: "No login yet" };
  if (signedIn === false || mustChange) return { tone: "amber", text: signedIn ? "Choosing their password" : "Not signed in yet" };
  return { tone: "green", text: "Signed in" };
}

/**
 * Sign-in for students and parents, class by class. Admins choose any class (or all); a class
 * teacher sees only their own class. Subject teachers and students never reach this (the server checks).
 */
export default function ClassCodes({ mode }: { mode: CodeMode }) {
  const [cls, setCls] = useState<string | null>(null);
  const { data, error, reload } = useApi<Data>(`/api/school/class-codes${cls ? `?class=${cls}` : ""}`, [cls]);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [logins, setLogins] = useState<Login[] | null>(null);
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => (data?.rows ?? []).filter(r => !q.trim() || `${r.name} ${r.admission_no ?? ""} ${r.parents.map(p => p.name).join(" ")}`.toLowerCase().includes(q.trim().toLowerCase())), [data, q]);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  if (!data.classes.length) return <Empty>{data.admin ? "No classes yet. Add them under School setup." : "You are not the class teacher of any class. Only a class's class teacher and the school's admins see its students' sign-in details."}</Empty>;
  const selected = data.selected ?? cls;

  async function make(body: Record<string, unknown>) {
    setBusy(true); setMsg(null);
    const r = await send("/api/school/class-codes", body, "POST", { quiet: true });
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: r.error ?? "failed" }); return; }
    const list = (r.data as { logins: Login[] }).logins;
    setLogins(list);
    const bad = list.filter(l => l.error).length;
    setMsg({ ok: !bad, text: `${list.length - bad} one-time password${list.length - bad === 1 ? "" : "s"} made${bad ? `; ${bad} could not be made (see below)` : ""}. Shown only now: print or copy them.` });
    reload();
  }
  async function act(body: Record<string, unknown>, ok: (d: any) => string) {
    const r = await send("/api/school/class-codes", body, "POST", { quiet: true });
    setMsg({ ok: r.ok, text: r.ok ? ok(r.data) : r.error ?? "failed" });
    if (r.ok) reload();
  }
  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); setMsg({ ok: true, text: "Copied." }); } catch { setMsg({ ok: false, text: "Copy is blocked in this browser: select the text and copy it." }); } };

  const noLoginStudents = rows.filter(r => !r.has_account);
  const parents = rows.flatMap(r => r.parents.map(p => ({ ...p, child: r.name })));
  const uniqueParents = [...new Map(parents.map(p => [p.id, p])).values()];
  const noLoginParents = uniqueParents.filter(p => !p.has_account && (emails[p.id] || p.email));

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">{HELP[mode]}</p>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}

      {logins && logins.length > 0 && (
        <section className="card p-4">
          <div className="mb-2 flex items-center gap-2 print:hidden">
            <h3 className="mr-auto font-semibold">One-time passwords (shown only now)</h3>
            <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => copy(logins.filter(l => l.password).map(l => `${l.name}\tUsername: ${l.username}\tOne-time password: ${l.password}`).join("\n"))}>Copy all</button>
            <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => window.print()}>Print slips</button>
            <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setLogins(null)}>Close</button>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {logins.map(l => (
              <li key={l.id} className="break-inside-avoid rounded-lg border border-slate-200 p-3 text-sm">
                <b>{l.name}</b>
                {l.error ? <p className="text-rose-700">{l.error}</p> : (<>
                  <p>Username: <span className="font-mono">{l.username}</span></p>
                  <p>One-time password: <span className="font-mono text-base tracking-wider">{l.password}</span></p>
                  <p className="text-xs text-slate-500">Sign in at the {mode === "students" ? "Student" : "Parent"} tab, then choose your own password.{mode === "students" && l.sent ? ` Also sent to ${l.sent} parent contact${l.sent === 1 ? "" : "s"}.` : mode === "parents" ? " Also emailed to them." : ""}</p>
                </>)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <select className="input w-auto" value={selected ?? ""} onChange={e => { setCls(e.target.value || null); setLogins(null); }} aria-label="Class">
          {data.admin && <option value="">Choose a class</option>}
          {data.admin && <option value="all">All classes</option>}
          {data.classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input className="input w-56" placeholder={mode === "students" ? "Find a student" : "Find a student or parent"} value={q} onChange={e => setQ(e.target.value)} aria-label="Find" />
        <span className="ml-auto" />
        {mode === "students" ? (
          <button className="btn btn-primary" disabled={busy || !noLoginStudents.length} onClick={() => confirm(`Make one-time passwords for the ${noLoginStudents.length} student${noLoginStudents.length === 1 ? "" : "s"} shown with no login yet?`)
            && make({ action: "student_login", ids: noLoginStudents.slice(0, 200).map(r => r.id) })}>{busy ? "Making…" : `One-time passwords for all without a login (${noLoginStudents.length})`}</button>
        ) : (
          <button className="btn btn-primary" disabled={busy || !noLoginParents.length} onClick={() => confirm(`Make one-time passwords for the ${noLoginParents.length} parent${noLoginParents.length === 1 ? "" : "s"} shown with an email and no login yet?`)
            && make({ action: "parent_login", guardian_ids: noLoginParents.slice(0, 200).map(p => p.id), emails })}>{busy ? "Making…" : `One-time passwords for all without a login (${noLoginParents.length})`}</button>
        )}
      </div>

      {!selected ? <Empty>Choose a class.</Empty> : !rows.length ? <Empty>No students in this class.</Empty> : mode === "students" ? (
        <div className="card overflow-x-auto print:hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="p-3">Student</th><th className="p-3">Username</th><th className="p-3">Sign-in</th><th className="p-3 text-right">Actions</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(r => {
                const s = state(r.has_account, r.signed_in, r.must_change);
                return (
                  <tr key={r.id}>
                    <td className="p-3"><b>{r.name}</b><span className="block text-xs text-slate-500">{[r.admission_no, r.class_name].filter(Boolean).join(" · ")}</span></td>
                    <td className="p-3 font-mono text-xs">{r.username ?? "—"}</td>
                    <td className="p-3"><Badge tone={s.tone}>{s.text}</Badge></td>
                    <td className="p-3 text-right">
                      <button className="btn btn-ghost px-2 py-1 text-xs" disabled={busy}
                        onClick={() => (!r.has_account || confirm(r.signed_in ? `${r.name} has signed in already. Make a new one-time password? Their own password stops working.` : `Make a new one-time password for ${r.name}? The old one stops working.`))
                          && make({ action: "student_login", ids: [r.id] })}>{r.has_account ? "New one-time password" : "One-time password"}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card overflow-x-auto print:hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="p-3">Child</th><th className="p-3">Child&apos;s code (to add the child)</th><th className="p-3">Parents and their sign-in</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(r => (
                <tr key={r.id} className="align-top">
                  <td className="p-3"><b>{r.name}</b><span className="block text-xs text-slate-500">{[r.admission_no, r.class_name].filter(Boolean).join(" · ")}</span></td>
                  <td className="p-3">
                    {r.parent_code ? <span className="font-mono text-base tracking-widest">{r.parent_code}</span> : <Badge tone="amber">All uses spent</Badge>}
                    <span className="block text-xs text-slate-400">{r.parent_uses} of {r.parent_max} parents</span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {r.parent_code && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => copy(r.parent_code!)}>Copy</button>}
                      {r.parent_code && r.parents.length > 0 && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => act({ action: "send", kind: "parent_link", ids: [r.id] }, d => d.messages ? "Child's code sent to the parents." : "No parent contact on record: hand the code over in person.")}>Send</button>}
                      {data.admin && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => confirm("Make a new child's code? The old one stops working.") && act({ action: "new_code", kind: "parent_link", id: r.id }, d => `New code: ${d.code}`)}>New code</button>}
                    </div>
                  </td>
                  <td className="p-3">
                    {!r.parents.length ? <span className="text-xs text-slate-500">No parent on record. Add one under Students &amp; parents, or give the parent the child&apos;s code.</span> : (
                      <ul className="space-y-2">
                        {r.parents.map(p => {
                          const s = state(p.has_account, p.signed_in);
                          return (
                            <li key={p.id} className="flex flex-wrap items-center gap-2">
                              <span className="min-w-[8rem] font-medium">{p.name}</span>
                              <Badge tone={s.tone}>{s.text}</Badge>
                              {!p.has_account && !p.email && <input className="input w-52 py-1 text-xs" type="email" placeholder="Their email" value={emails[p.id] ?? ""} onChange={e => setEmails({ ...emails, [p.id]: e.target.value })} aria-label={`${p.name}'s email`} />}
                              {p.email && <span className="text-xs text-slate-500">{p.email}</span>}
                              {!p.signed_in && <button className="btn btn-ghost px-2 py-1 text-xs" disabled={busy || (!p.email && !emails[p.id])}
                                onClick={() => (!p.has_account || confirm(`Make a new one-time password for ${p.name}? The old one stops working.`)) && make({ action: "parent_login", guardian_ids: [p.id], emails })}>{p.has_account ? "New one-time password" : "One-time password"}</button>}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
