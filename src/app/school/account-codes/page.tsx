"use client";
import { useMemo, useState } from "react";
import { useApi, send, Page, PageHeader, Tabs, Modal, Alert, Badge, Field, Loading, Empty } from "@/components/ui";
import type { CodeKind } from "@/lib/sign-up-codes";

type Row = { kind: CodeKind; id: string; name: string; detail: string | null; code: string | null; role: string | null; extra_roles: string[];
  uses: number; max_uses: number; has_account: boolean; email: string | null; phone: string | null };

const ROLES = ["teacher", "school_admin", "principal", "it_admin", "bursar", "librarian", "hr_manager", "qa_officer", "gate_officer", "transport_officer",
  "hostel_warden", "nurse", "admissions_officer", "cashier", "counsellor", "exam_officer"];
const words = (r: string) => r.replace(/_/g, " ");
const TABS: { id: CodeKind; label: string }[] = [
  { id: "staff", label: "Staff" }, { id: "student", label: "Students" }, { id: "guardian", label: "Parents" }, { id: "parent_link", label: "Parent codes for children" }
];
const HELP: Record<CodeKind, string> = {
  staff: "Each member of staff makes their account at /join with their code and gets the role shown here. Set the role before they sign up.",
  student: "Students make their account at /join with their code. Sent codes go to the student's parents.",
  guardian: "Parents make their account at /join with their code. Their children on the school's records show on their page straight away.",
  parent_link: "Each child's parent code: a parent signs up with it at /join, or types it under \"Add a child\" on their page. Up to 4 parents per code."
};

/** School office → Sign-up codes & logins (migration 9600): the two ways in for everyone the school adds. */
export default function AccountCodesPage() {
  const { data, error, reload } = useApi<{ rows: Row[] }>("/api/school/account-codes");
  const [tab, setTab] = useState<CodeKind>("staff");
  const [all, setAll] = useState(false);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [otp, setOtp] = useState<{ row: Row; mode: "otp" | "invite" } | null>(null);
  const [roleFor, setRoleFor] = useState<Row | null>(null);

  const rows = useMemo(() => (data?.rows ?? []).filter(r => r.kind === tab && (all || tab === "parent_link" || !r.has_account)
    && (!q.trim() || `${r.name} ${r.detail ?? ""} ${r.email ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()))), [data, tab, all, q]);
  const sendable = rows.filter(r => r.code && !r.has_account);

  async function act(body: Record<string, unknown>, ok: (d: any) => string) {
    const r = await send("/api/school/account-codes", body);
    setMsg({ ok: r.ok, text: r.ok ? ok(r.data) : r.error ?? "failed" });
    if (r.ok) reload();
    return r;
  }
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); setMsg({ ok: true, text: "Copied." }); } catch { setMsg({ ok: false, text: "Copy is blocked in this browser: select the code and copy it." }); } };

  return (
    <Page wide>
      <PageHeader eyebrow="School office" title="Sign-up codes & logins"
        subtitle="Three ways in for everyone you add; use whichever suits each person. 1. Their sign-up code: they make their own account at /join with their email and a password. 2. An email invitation link: they open it and set their password. 3. A one-time password: you enter their email, they sign in with it and choose their own password straight away." />
      {msg && <div className="mb-4"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      {error && <Alert>{error}</Alert>}
      <Tabs tabs={TABS} value={tab} onChange={t => { setTab(t); setMsg(null); }} />
      <p className="mt-3 text-sm text-slate-600">{HELP[tab]}</p>
      <div className="my-4 flex flex-wrap items-center gap-2 print:hidden">
        <input className="input w-64" placeholder="Search names" value={q} onChange={e => setQ(e.target.value)} aria-label="Search" />
        {tab !== "parent_link" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> Include people who already have an account</label>}
        <span className="ml-auto" />
        <button className="btn btn-outline" disabled={!sendable.length} onClick={() => confirm(`Send codes to the ${sendable.length} ${sendable.length === 1 ? "person" : "people"} shown (by email, WhatsApp or SMS)?`)
          && act({ action: "send", items: sendable.map(r => ({ kind: r.kind, id: r.id })) }, d => `${d.messages} message${d.messages === 1 ? "" : "s"} sent.${d.skipped ? ` ${d.skipped} had no email or phone on record: print or hand over their codes.` : ""}`)}>Send codes to all shown</button>
        <button className="btn btn-outline" onClick={() => window.print()}>Print slips</button>
      </div>

      {!data ? <Loading /> : !rows.length ? <Empty>{tab === "parent_link" ? "No students yet." : "Everyone here already has an account."}</Empty> : (
        <div className="card overflow-x-auto print:border-0 print:shadow-none">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 print:hidden">
              <tr><th className="p-3">{tab === "parent_link" ? "Child" : "Name"}</th><th className="p-3">Code</th>{tab === "staff" && <th className="p-3">Signs up as</th>}<th className="p-3 text-right">Actions</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(r => (
                <tr key={`${r.kind}-${r.id}`} className="break-inside-avoid">
                  <td className="p-3"><b>{r.name}</b>{r.detail && <span className="block text-xs text-slate-500">{r.detail}</span>}</td>
                  <td className="p-3">
                    {r.has_account && r.kind !== "parent_link" ? <Badge tone="green">Has an account</Badge>
                      : r.code ? <span className="font-mono text-base tracking-widest">{r.code}</span> : <Badge tone="amber">{r.kind === "parent_link" ? "All uses spent" : "No code"}</Badge>}
                    {r.kind === "parent_link" && r.code && <span className="block text-xs text-slate-500">{r.uses} of {r.max_uses} parents</span>}
                    <span className="hidden text-xs text-slate-600 print:block">Make your account at /join with this code.</span>
                  </td>
                  {tab === "staff" && <td className="p-3 capitalize">{r.has_account ? "—" : <>{words(r.role ?? "teacher")}{r.extra_roles.length ? <span className="block text-xs text-slate-500">+ {r.extra_roles.map(words).join(", ")}</span> : null}</>}</td>}
                  <td className="p-3 text-right print:hidden">
                    <div className="flex flex-wrap justify-end gap-1">
                      {r.code && !r.has_account && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => copy(r.code!)}>Copy</button>}
                      {r.code && !r.has_account && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => act({ action: "send", items: [{ kind: r.kind, id: r.id }] }, d => d.messages ? "Sent." : "No email or phone on record: hand the code over in person.")}>Send</button>}
                      {tab === "staff" && !r.has_account && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setRoleFor(r)}>Role</button>}
                      {(!r.has_account || r.kind === "parent_link") && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => confirm("Make a new code? The old one stops working.") && act({ action: "new_code", kind: r.kind, id: r.id }, d => `New code: ${d.code}`)}>New code</button>}
                      {r.kind !== "parent_link" && !r.has_account && <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => setOtp({ row: r, mode: "invite" })}>Email invitation</button>}
                      {r.kind !== "parent_link" && !r.has_account && <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => setOtp({ row: r, mode: "otp" })}>One-time password</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <OneTimePassword row={otp?.row ?? null} mode={otp?.mode ?? "otp"} onClose={() => setOtp(null)} onDone={() => reload()} />
      <RoleForm row={roleFor} onClose={() => setRoleFor(null)} onDone={t => { setRoleFor(null); setMsg({ ok: true, text: t }); reload(); }} />
    </Page>
  );
}

function OneTimePassword({ row, mode, onClose, onDone }: { row: Row | null; mode: "otp" | "invite"; onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [made, setMade] = useState<{ username: string; password: string; sent: number } | null>(null);
  const [invited, setInvited] = useState<string | null>(null);
  const close = () => { setEmail(""); setErr(null); setMade(null); setInvited(null); onClose(); };
  if (mode === "invite") return (
    <Modal open={Boolean(row)} onClose={close} title={`Email invitation: ${row?.name ?? ""}`}>
      {invited ? (
        <div className="space-y-3 text-sm">
          <Alert tone="green">Invitation link emailed to {invited}. They open it and set their password; the link lasts 24 hours.</Alert>
          <div className="flex justify-end"><button className="btn btn-primary" onClick={close}>Done</button></div>
        </div>
      ) : (
        <form className="space-y-3" onSubmit={async e => {
          e.preventDefault();
          setBusy(true); setErr(null);
          const r = await send<{ email: string }>("/api/school/account-codes", { action: "invite", kind: row!.kind, id: row!.id, email: email || row!.email || "" });
          setBusy(false);
          if (!r.ok) { setErr(r.error); return; }
          setInvited(r.data.email); onDone();
        }}>
          <p className="text-sm text-slate-600">A link goes to this email. They open it, set their password and sign in{row?.kind === "staff" ? " with the role shown on this page" : ""}. The email becomes their username.</p>
          <Field label="Email"><input className="input" type="email" required autoFocus value={email || row?.email || ""} onChange={e => setEmail(e.target.value)} /></Field>
          {err && <Alert>{err}</Alert>}
          <div className="flex justify-end gap-2"><button type="button" className="btn btn-ghost" onClick={close}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? "Sending…" : "Send invitation"}</button></div>
        </form>
      )}
    </Modal>
  );
  return (
    <Modal open={Boolean(row)} onClose={close} title={`One-time password: ${row?.name ?? ""}`}>
      {made ? (
        <div className="space-y-3 text-sm">
          <Alert tone="green">The login is ready{made.sent ? ` and the details were sent (${made.sent} message${made.sent === 1 ? "" : "s"})` : ""}. It is shown only now: hand it over if they did not get the message.</Alert>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md bg-slate-50 p-3">
            <dt className="text-slate-500">Username</dt><dd className="font-mono">{made.username}</dd>
            <dt className="text-slate-500">One-time password</dt><dd className="font-mono text-base">{made.password}</dd>
          </dl>
          <p className="text-slate-600">At their first sign-in they choose their own password (typed twice) before anything else.</p>
          <div className="flex justify-end"><button className="btn btn-primary" onClick={close}>Done</button></div>
        </div>
      ) : (
        <form className="space-y-3" onSubmit={async e => {
          e.preventDefault();
          setBusy(true); setErr(null);
          const r = await send<{ username: string; password: string; sent: number }>("/api/school/account-codes", { action: "one_time_password", kind: row!.kind, id: row!.id, email: email || row!.email || "" });
          setBusy(false);
          if (!r.ok) { setErr(r.error); return; }
          setMade(r.data); onDone();
        }}>
          <p className="text-sm text-slate-600">Their email becomes their username. A one-time password is made and sent to that email{row?.kind === "student" ? " and to the student's parents" : ""}.</p>
          <Field label="Email"><input className="input" type="email" required autoFocus value={email || row?.email || ""} onChange={e => setEmail(e.target.value)} /></Field>
          {err && <Alert>{err}</Alert>}
          <div className="flex justify-end gap-2"><button type="button" className="btn btn-ghost" onClick={close}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? "Making the login…" : "Make login and send"}</button></div>
        </form>
      )}
    </Modal>
  );
}

function RoleForm({ row, onClose, onDone }: { row: Row | null; onClose: () => void; onDone: (t: string) => void }) {
  const [role, setRole] = useState<string>("");
  const [extra, setExtra] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const r0 = role || row?.role || "teacher";
  const x0 = extra ?? row?.extra_roles ?? [];
  const close = () => { setRole(""); setExtra(null); setErr(null); onClose(); };
  return (
    <Modal open={Boolean(row)} onClose={close} title={`Signs up as: ${row?.name ?? ""}`}>
      <form className="space-y-3" onSubmit={async e => {
        e.preventDefault();
        const r = await send<{ code: string }>("/api/school/account-codes", { action: "staff_role", staff_id: row!.id, role: r0, extra_roles: x0 });
        if (!r.ok) { setErr(r.error); return; }
        setRole(""); setExtra(null); setErr(null);
        onDone(`${row!.name} will sign up as ${words(r0)}. Their new code is ${r.data.code} (the old one stopped working).`);
      }}>
        <Field label="Main role"><select className="input" value={r0} onChange={e => setRole(e.target.value)}>{ROLES.map(x => <option key={x} value={x}>{words(x)}</option>)}</select></Field>
        <fieldset><legend className="label">Extra duties</legend>
          <div className="grid grid-cols-2 gap-1 text-sm">{ROLES.filter(x => x !== r0).map(x => (
            <label key={x} className="flex items-center gap-2 capitalize"><input type="checkbox" checked={x0.includes(x)} onChange={e => setExtra(e.target.checked ? [...x0, x] : x0.filter(y => y !== x))} />{words(x)}</label>))}</div>
        </fieldset>
        {err && <Alert>{err}</Alert>}
        <div className="flex justify-end gap-2"><button type="button" className="btn btn-ghost" onClick={close}>Cancel</button><button className="btn btn-primary">Save</button></div>
      </form>
    </Modal>
  );
}
