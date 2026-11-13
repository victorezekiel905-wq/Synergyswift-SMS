"use client";
import { useMemo, useState } from "react";
import { useApi, send, Alert, Badge, Empty, Loading } from "@/components/ui";
import type { ClassCodeRow } from "@/lib/onboarding-codes-server";
import type { ClassCode, WaitingSignup } from "@/lib/class-signup-server";
import { bestMatch } from "@/lib/class-signup";
import AddParents from "@/components/onboarding/AddParents";

type Data = { admin: boolean; classes: { id: string; name: string }[]; selected: string | null; rows: ClassCodeRow[];
  class_codes: ClassCode[] | null; waiting: WaitingSignup[] };
type Login = { id: string; name: string; username: string | null; password: string | null; sent?: number; error?: string };
export type CodeMode = "students" | "parents";

const HELP: Record<CodeMode, string> = {
  students: "Students sign up on the sign-in page (Student, then \"Sign up with your code\"), with either the class's code or their own code, and choose a username and a password. With the class's code they wait until you confirm them below; with their own code they go straight in. A student sees only their own class and their own things (results, portfolio, tuck shop, analysis).",
  parents: "Add parents above (like staff), or let them make their own account on the sign-in page (Parent, then \"Make your account\") and add each child with that child's code below. A parent sees only their own children (up to 4 parents per child's code)."
};

/** Who is where: no account, waiting to choose their own password, or signed in. */
function state(hasAccount: boolean, signedIn: boolean | null, mustChange = false): { tone: "green" | "amber" | "slate"; text: string } {
  if (!hasAccount) return { tone: "slate", text: "Not signed up yet" };
  if (signedIn === false || mustChange) return { tone: "amber", text: signedIn ? "Choosing their password" : "Not signed in yet" };
  return { tone: "green", text: "Signed up" };
}

/**
 * Students who signed up with a class's shared code and wait to be confirmed. The teacher matches
 * each one to a student in that class who has no account yet (the likeliest is chosen for them),
 * or adds them as a new student, or declines.
 */
function Waiting({ waiting, rows, selected, onOpenClass, act }: {
  waiting: WaitingSignup[]; rows: ClassCodeRow[]; selected: string | null; onOpenClass: (id: string) => void;
  act: (body: Record<string, unknown>, ok: (d: any) => string) => Promise<void>;
}) {
  const [pick, setPick] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (id: string, body: Record<string, unknown>, ok: (d: any) => string) => { setBusy(id); await act(body, ok); setBusy(null); };
  return (
    <section className="card border-amber-200 p-4 print:hidden">
      <h3 className="font-semibold">Waiting for you to confirm ({waiting.length})</h3>
      <p className="mt-0.5 text-xs text-slate-500">These students signed up with the class code. Check each is really in the class and choose their record, so they see their own results and their parents stay linked. Choose &quot;New student&quot; only for someone not on the class list yet.</p>
      <ul className="mt-3 divide-y divide-slate-100">
        {waiting.map(w => {
          const loaded = selected === "all" || selected === w.class_id || rows.some(r => r.class_id === w.class_id);
          const options = rows.filter(r => r.class_id === w.class_id && !r.has_account).map(r => ({ id: r.id, name: r.name }));
          const guess = bestMatch(w.full_name, options);
          const chosen = pick[w.id] ?? guess?.id ?? "";
          return (
            <li key={w.id} className="flex flex-wrap items-center gap-2 py-2.5">
              <div className="mr-auto min-w-[12rem]">
                <b>{w.full_name}</b>
                <span className="block text-xs text-slate-500">{w.class_name} · {w.username} · signed up {new Date(w.created_at).toLocaleDateString()}</span>
              </div>
              {!loaded ? <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => onOpenClass(w.class_id)}>Open {w.class_name ?? "the class"} to confirm</button> : (<>
                <select className="input w-56 py-1 text-sm" value={chosen} onChange={e => setPick({ ...pick, [w.id]: e.target.value })} aria-label={`Record for ${w.full_name}`}>
                  <option value="">Choose their record…</option>
                  {options.map(o => <option key={o.id} value={o.id}>{o.name}{guess?.id === o.id ? " (best match)" : ""}</option>)}
                  <option value="new">New student (not on the list)</option>
                </select>
                <button className="btn btn-primary px-3 py-1 text-xs" disabled={!chosen || busy === w.id}
                  onClick={() => (chosen !== "new" || confirm(`Add ${w.full_name} to ${w.class_name} as a new student? Do this only if they are not on the class list.`))
                    && run(w.id, { action: "approve_signup", id: w.id, student_id: chosen === "new" ? null : chosen }, d => `${d.name} confirmed${d.new_student ? " and added to the class" : ""}. Their student page is open now.`)}>Confirm</button>
              </>)}
              <button className="btn btn-ghost px-2 py-1 text-xs text-rose-600" disabled={busy === w.id}
                onClick={() => confirm(`Decline ${w.full_name}? The sign-in they made is removed; they can sign up again.`) && run(w.id, { action: "decline_signup", id: w.id }, d => `${d.name}'s sign-up was declined.`)}>Decline</button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Sign-up for students and parents, class by class. Admins choose any class (or all); a class
 * teacher sees only their own class. Subject teachers and students never reach this (the server checks).
 */
export default function ClassCodes({ mode }: { mode: CodeMode }) {
  const [cls, setCls] = useState<string | null>(null);
  const { data, error, reload } = useApi<Data>(`/api/school/class-codes${cls ? `?class=${cls}` : ""}`, [cls]);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [logins, setLogins] = useState<Login[] | null>(null);
  const [slips, setSlips] = useState(false);
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => (data?.rows ?? []).filter(r => !q.trim() || `${r.name} ${r.admission_no ?? ""} ${r.parents.map(p => p.name).join(" ")}`.toLowerCase().includes(q.trim().toLowerCase())), [data, q]);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  if (!data.classes.length) return <Empty>{data.admin ? "No classes yet. Add them under School setup." : "You are not the class teacher of any class. Only a class's class teacher and the school's admins see its students' sign-up codes."}</Empty>;
  const selected = data.selected ?? cls;

  /** A new password for a student who forgot theirs: shown once, and they choose their own at the next sign-in. */
  async function resetPassword(id: string) {
    setBusy(true); setMsg(null);
    const r = await send("/api/school/class-codes", { action: "student_login", ids: [id] }, "POST", { quiet: true });
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: r.error ?? "failed" }); return; }
    const list = (r.data as { logins: Login[] }).logins;
    setLogins(list); setSlips(false);
    setMsg(list.some(l => l.error) ? { ok: false, text: "The password could not be reset (see below)." } : { ok: true, text: "New password made. It is shown only now: print or copy it." });
    reload();
  }
  async function act(body: Record<string, unknown>, ok: (d: any) => string) {
    const r = await send("/api/school/class-codes", body, "POST", { quiet: true });
    setMsg({ ok: r.ok, text: r.ok ? ok(r.data) : r.error ?? "failed" });
    if (r.ok) reload();
  }
  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); setMsg({ ok: true, text: "Copied." }); } catch { setMsg({ ok: false, text: "Copy is blocked in this browser: select the text and copy it." }); } };

  const kind = mode === "students" ? "student" : "parent_link";
  const codeOf = (r: ClassCodeRow) => mode === "students" ? r.student_code : r.parent_code;
  const withCode = rows.filter(r => codeOf(r));
  const sendable = withCode.filter(r => r.parents.length);

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600 print:hidden">{HELP[mode]}</p>
      {msg && <div className="print:hidden"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}

      {mode === "parents" && <AddParents onAdded={reload} />}

      {mode === "students" && data.waiting.length > 0 && (
        <Waiting waiting={data.waiting} rows={data.rows} selected={selected} onOpenClass={id => { setCls(id); setLogins(null); setSlips(false); }}
          act={(body, ok) => act(body, ok)} />
      )}
      {mode === "students" && data.class_codes === null && <div className="print:hidden"><Alert tone="amber">Class sign-up codes need the database update (migration 20260101010300).</Alert></div>}
      {mode === "students" && (data.class_codes ?? []).length > 0 && (
        <section className="card p-4 print:hidden">
          <h3 className="font-semibold">Class sign-up code{(data.class_codes ?? []).length === 1 ? "" : "s"}</h3>
          <p className="mt-0.5 text-xs text-slate-500">One code for the whole class: write it on the board or share it. Students who use it appear under &quot;Waiting for you to confirm&quot;; nothing opens for them until you confirm.</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {(data.class_codes ?? []).map(c => (
              <li key={c.class_id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
                <span className="text-sm font-medium">{c.class_name}</span>
                {c.code ? <span className="font-mono text-lg tracking-widest">{c.code}</span> : <Badge tone="amber">No code</Badge>}
                {c.code && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => copy(c.code!)}>Copy</button>}
                {data.admin && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => confirm(`Make a new class code for ${c.class_name}? The old one stops working (students already waiting stay on the list).`)
                  && act({ action: "new_class_code", class_id: c.class_id }, d => `New code for ${c.class_name}: ${d.code}`)}>New code</button>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {logins && logins.length > 0 && (
        <section className="card p-4">
          <div className="mb-2 flex items-center gap-2 print:hidden">
            <h3 className="mr-auto font-semibold">New password (shown only now)</h3>
            <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => window.print()}>Print</button>
            <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setLogins(null)}>Close</button>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {logins.map(l => (
              <li key={l.id} className="break-inside-avoid rounded-lg border border-slate-200 p-3 text-sm">
                <b>{l.name}</b>
                {l.error ? <p className="text-rose-700">{l.error}</p> : (<>
                  <p>Username: <span className="font-mono">{l.username}</span></p>
                  <p>Password for now: <span className="font-mono text-base tracking-wider">{l.password}</span></p>
                  <p className="text-xs text-slate-500">Sign in at the Student tab, then choose your own password.{l.sent ? ` Also sent to ${l.sent} parent contact${l.sent === 1 ? "" : "s"}.` : ""}</p>
                </>)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {slips && withCode.length > 0 && (
        <section className="card p-4">
          <div className="mb-2 flex items-center gap-2 print:hidden">
            <h3 className="mr-auto font-semibold">{mode === "students" ? "Student sign-up slips" : "Child's code slips for parents"} ({withCode.length})</h3>
            <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => copy(withCode.map(r => `${r.name}\t${r.class_name ?? ""}\t${codeOf(r)}`).join("\n"))}>Copy all</button>
            <button className="btn btn-primary px-2 py-1 text-xs" onClick={() => window.print()}>Print</button>
            <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setSlips(false)}>Close</button>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {withCode.map(r => (
              <li key={r.id} className="break-inside-avoid rounded-lg border border-slate-200 p-3 text-sm">
                <b>{r.name}</b><span className="ml-2 text-xs text-slate-500">{[r.admission_no, r.class_name].filter(Boolean).join(" · ")}</span>
                <p className="mt-1">{mode === "students" ? "Sign-up code" : "Child's code"}: <span className="font-mono text-base tracking-widest">{codeOf(r)}</span></p>
                <p className="mt-1 text-xs text-slate-500">{mode === "students"
                  ? "Open the sign-in page, choose Student, then \"Sign up with your code\". Type this code, choose a username and a password."
                  : "Open the sign-in page, choose Parent, then \"Make your account\" (no code needed). On your page, type this code under \"Add a child\"."}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <select className="input w-auto" value={selected ?? ""} onChange={e => { setCls(e.target.value || null); setLogins(null); setSlips(false); }} aria-label="Class">
          {data.admin && <option value="">Choose a class</option>}
          {data.admin && <option value="all">All classes</option>}
          {data.classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input className="input w-56" placeholder={mode === "students" ? "Find a student" : "Find a student or parent"} value={q} onChange={e => setQ(e.target.value)} aria-label="Find" />
        <span className="ml-auto" />
        <button className="btn btn-outline" disabled={!sendable.length} onClick={() => confirm(`Send ${mode === "students" ? "the sign-up codes" : "the children's codes"} of the ${sendable.length} student${sendable.length === 1 ? "" : "s"} shown to their parents?`)
          && act({ action: "send", kind, ids: sendable.map(r => r.id) }, d => `${d.messages} message${d.messages === 1 ? "" : "s"} sent${d.skipped ? `; ${d.skipped} had no parent contact` : ""}.`)}>Send to parents ({sendable.length})</button>
        <button className="btn btn-primary" disabled={!withCode.length} onClick={() => { setSlips(true); setLogins(null); }}>Print slips ({withCode.length})</button>
      </div>

      {!selected ? <Empty>Choose a class.</Empty> : !rows.length ? <Empty>No students in this class.</Empty> : mode === "students" ? (
        <div className="card overflow-x-auto print:hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="p-3">Student</th><th className="p-3">Sign-up code</th><th className="p-3">Account</th><th className="p-3 text-right">Actions</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(r => {
                const s = state(r.has_account, r.signed_in, r.must_change);
                return (
                  <tr key={r.id}>
                    <td className="p-3"><b>{r.name}</b><span className="block text-xs text-slate-500">{[r.admission_no, r.class_name].filter(Boolean).join(" · ")}</span></td>
                    <td className="p-3">{r.has_account ? <span className="text-xs text-slate-500">Used</span>
                      : r.student_code ? <span className="font-mono text-base tracking-widest">{r.student_code}</span> : <Badge tone="amber">No code</Badge>}</td>
                    <td className="p-3"><Badge tone={s.tone}>{s.text}</Badge>{r.has_account && r.username && <span className="mt-0.5 block font-mono text-xs text-slate-500">{r.username}</span>}</td>
                    <td className="p-3 text-right">
                      {r.student_code && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => copy(r.student_code!)}>Copy</button>}
                      {r.student_code && r.parents.length > 0 && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => act({ action: "send", kind: "student", ids: [r.id] }, d => d.messages ? "Sign-up code sent to the parents." : "No parent contact on record: hand the code over in person.")}>Send</button>}
                      {!r.has_account && data.admin && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => (!r.student_code || confirm("Make a new sign-up code? The old one stops working.")) && act({ action: "new_code", kind: "student", id: r.id }, d => `New code: ${d.code}`)}>New code</button>}
                      {r.has_account && <button className="btn btn-ghost px-2 py-1 text-xs" disabled={busy}
                        onClick={() => confirm(`Reset ${r.name}'s password? Their present password stops working; they choose a new one at the next sign-in.`) && resetPassword(r.id)}>Reset password</button>}
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
              <tr><th className="p-3">Child</th><th className="p-3">Child&apos;s code (parents type it to add the child)</th><th className="p-3">Parents linked to this child</th></tr>
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
                    {!r.parents.length ? <span className="text-xs text-slate-500">No parent yet. Give the parent this child&apos;s code: they sign up and add the child themselves.</span> : (
                      <ul className="space-y-1.5">
                        {r.parents.map(p => (
                          <li key={p.id} className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{p.name}</span>
                            <Badge tone={p.has_account ? "green" : "slate"}>{p.has_account ? "Has an account" : "No account yet"}</Badge>
                            {p.email && <span className="text-xs text-slate-500">{p.email}</span>}
                          </li>
                        ))}
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
