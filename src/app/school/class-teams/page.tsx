"use client";
import { useState } from "react";
import { useApi, send, Page, PageHeader, Alert, Badge, Field, Loading, Empty } from "@/components/ui";

type Staff = { id: string; full_name: string; role: string };
type Member = { id: string; class_group_id: string; subject_id: string | null; user_id: string; role: string; can_teach_live: boolean; can_give_points: boolean; can_post_story: boolean; can_message_parents: boolean; can_see_results: boolean };
type Data = {
  classes: { id: string; name: string; level: string | null; form_teacher_id: string | null }[];
  offerings: { id: string; class_group_id: string; subject_id: string; teacher_id: string | null; subjects: { name: string } | null }[];
  team: Member[]; staff: Staff[]; subjects: { id: string; name: string }[];
  settings: { auto_student_logins?: boolean; auto_parent_invites?: boolean; story_photo_consent?: boolean; ussd_enabled?: boolean; all_classes_roles?: string[] };
  accounts: { students: number; students_without_login: number; students_waiting: { id: string; first_name: string; last_name: string; login_sent_at: string | null }[]; parents: number; parents_without_login: number; parents_waiting: { id: string; full_name: string; email: string | null; phone: string | null }[] };
};

const PRIVS: [keyof Member, string][] = [["can_teach_live", "Live lessons"], ["can_give_points", "Points"], ["can_post_story", "Class story"], ["can_message_parents", "Message parents"], ["can_see_results", "See results"]];

/** Who teaches each class and what they may do there; and sign-ins that set themselves up. */
export default function ClassTeamsPage() {
  const { data, error, reload } = useApi<Data>("/api/school/class-teams");
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [add, setAdd] = useState({ user_id: "", role: "co_teacher", subject_id: "" });
  if (error) return <Page><Alert>{error}</Alert></Page>;
  if (!data) return <Page><Loading /></Page>;
  const name = (id: string | null) => data.staff.find(s => s.id === id)?.full_name ?? "—";
  const act = async (body: Record<string, unknown>, ok: string) => {
    const r = await send("/api/school/class-teams", body);
    setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" });
    if (r.ok) reload();
    return r;
  };
  const staffSelect = (value: string | null, onChange: (v: string | null) => void, label: string) => (
    <select className="input py-1" value={value ?? ""} onChange={e => onChange(e.target.value || null)} aria-label={label}>
      <option value="">Nobody yet</option>{data.staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
    </select>
  );
  const a = data.accounts;
  return (
    <Page wide>
      <PageHeader eyebrow="School office" title="Class teams and accounts" subtitle="Who teaches each class and what they may do there. Students and parents get their sign-ins automatically." />
      {msg && <div className="mb-4"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}

      <section className="card mb-5 grid gap-4 p-5 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-3">
          <h2 className="font-semibold">Automatic sign-ins</h2>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={data.settings.auto_student_logins !== false} onChange={e => act({ action: "settings", auto_student_logins: e.target.checked }, "Saved")} />
            <span><b>Students</b>: every student gets a username and a starting password. The details go to their parents by email, WhatsApp or SMS, and the student chooses their own password at the first sign-in.</span></label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={data.settings.auto_parent_invites !== false} onChange={e => act({ action: "settings", auto_parent_invites: e.target.checked }, "Saved")} />
            <span><b>Parents</b>: parents with an email get an invitation to set a password; parents with only a phone get their private portal link and can sign in with a code sent to their phone.</span></label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={data.settings.story_photo_consent !== false} onChange={e => act({ action: "settings", story_photo_consent: e.target.checked }, "Saved")} />
            <span><b>Class story photos</b> only of children whose parents agreed to photos inside the school.</span></label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={data.settings.ussd_enabled !== false} onChange={e => act({ action: "settings", ussd_enabled: e.target.checked }, "Saved")} />
            <span><b>Basic phones (USSD)</b>: parents dial the Synergy Swift code from the phone number on their child&apos;s record to check results (with a result PIN if you sell them), fees, today&apos;s attendance and the school bus.</span></label>
          <div className="rounded-md border border-slate-200 p-3 text-sm">
            <p><b>Who sees every class</b> in the learning space (homework, discussions, online lessons, class story). Everyone else sees only the classes they teach or are in. Admins and the principal always see every class.</p>
            <div className="mt-2 flex flex-wrap gap-3">
              {([["exam_officer", "Exam officers"], ["qa_officer", "Quality assurance"], ["counsellor", "Counsellors"], ["it_admin", "IT admins"], ["librarian", "Librarians"], ["hr_manager", "HR"], ["teacher", "All teachers"]] as const).map(([role, label]) => {
                const list = data.settings.all_classes_roles ?? ["school_admin", "principal"];
                return <label key={role} className="flex items-center gap-1.5"><input type="checkbox" checked={list.includes(role)}
                  onChange={e => act({ action: "settings", all_classes_roles: [...new Set([...list.filter(r => r !== role), ...(e.target.checked ? [role] : []), "school_admin", "principal"])] }, "Saved")} />{label}</label>;
              })}
            </div>
          </div>
          <button className="btn btn-primary" onClick={async () => { const r = await act({ action: "run_accounts" }, "Done"); if (r.ok) setMsg({ ok: true, text: `${r.data.student_logins} student sign-ins sent to parents, ${r.data.parent_invites} parents invited.` }); }}>Set up waiting accounts now</button>
          <p className="text-xs text-slate-500">This also happens by itself every few minutes, so new students and parents are set up without anyone remembering to.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg border border-slate-200 p-3"><p className="text-xs text-slate-500">Students with a sign-in</p><p className="text-2xl font-bold tabular-nums">{a.students - a.students_without_login} <span className="text-base font-normal text-slate-500">/ {a.students}</span></p></div>
          <div className="rounded-lg border border-slate-200 p-3"><p className="text-xs text-slate-500">Parents with a sign-in</p><p className="text-2xl font-bold tabular-nums">{a.parents - a.parents_without_login} <span className="text-base font-normal text-slate-500">/ {a.parents}</span></p></div>
          <div className="col-span-2 max-h-56 overflow-auto rounded-lg border border-slate-200 p-3">
            <p className="mb-1 text-xs font-semibold text-slate-500">Waiting</p>
            {!a.students_waiting.length && !a.parents_waiting.length ? <p className="text-slate-500">Nobody is waiting.</p> : (
              <ul className="space-y-1">
                {a.students_waiting.map(s => <li key={s.id} className="flex items-center gap-2"><span className="flex-1">{s.first_name} {s.last_name} <span className="text-xs text-slate-500">student{s.login_sent_at ? ", could not be set up: check the parents' contacts" : ""}</span></span><button className="text-xs text-brand-700 hover:underline" onClick={() => act({ action: "resend_key", student_id: s.id }, `Sign-in for ${s.first_name} sent to the parents`)}>Set up now</button></li>)}
                {a.parents_waiting.map(g => <li key={g.id} className="flex items-center gap-2"><span className="flex-1">{g.full_name} <span className="text-xs text-slate-500">parent · {g.email ?? g.phone ?? "no contact"}</span></span><button className="text-xs text-brand-700 hover:underline" onClick={() => act({ action: "invite_parent", guardian_id: g.id }, `${g.full_name} invited`)}>Invite now</button></li>)}
              </ul>
            )}
          </div>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="mb-1 font-semibold">Classes</h2>
        <p className="mb-3 text-sm text-slate-600">Form teachers and subject teachers can do everything in their classes. Add co-teachers, assistants and support staff with just the privileges they need.</p>
        {!data.classes.length ? <Empty>No classes yet. Add them under School setup.</Empty> : (
          <ul className="divide-y divide-slate-100">
            {data.classes.map(c => {
              const offers = data.offerings.filter(o => o.class_group_id === c.id);
              const team = data.team.filter(t => t.class_group_id === c.id);
              const isOpen = open === c.id;
              return (
                <li key={c.id} className="py-2">
                  <button type="button" className="flex w-full items-center gap-3 text-left" onClick={() => setOpen(isOpen ? null : c.id)} aria-expanded={isOpen}>
                    <span className="flex-1 font-medium">{c.name}</span>
                    <span className="text-sm text-slate-500">Form teacher: {name(c.form_teacher_id)} · {offers.length} subjects · {team.length} more</span>
                    <span className="text-slate-400">{isOpen ? "▾" : "▸"}</span>
                  </button>
                  {isOpen && (
                    <div className="mt-3 space-y-4 rounded-lg bg-slate-50 p-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Form teacher">{staffSelect(c.form_teacher_id, v => act({ action: "form_teacher", class_group_id: c.id, user_id: v }, "Form teacher saved"), "Form teacher")}</Field>
                      </div>
                      {offers.length > 0 && (
                        <div>
                          <p className="label">Subject teachers</p>
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {offers.map(o => <label key={o.id} className="text-sm"><span className="mb-0.5 block text-xs text-slate-600">{o.subjects?.name}</span>{staffSelect(o.teacher_id, v => act({ action: "subject_teacher", offering_id: o.id, user_id: v }, "Subject teacher saved"), `${o.subjects?.name} teacher`)}</label>)}
                          </div>
                        </div>
                      )}
                      <div>
                        <p className="label">Co-teachers, assistants and support</p>
                        {!team.length ? <p className="text-sm text-slate-500">Nobody added.</p> : (
                          <table className="w-full text-sm">
                            <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">Who</th><th>Role</th>{PRIVS.map(([, l]) => <th key={l} className="text-center">{l}</th>)}<th /></tr></thead>
                            <tbody>
                              {team.map(t => (
                                <tr key={t.id} className="border-t border-slate-200">
                                  <td className="py-1.5">{name(t.user_id)}{t.subject_id && <span className="block text-xs text-slate-500">{data.subjects.find(s => s.id === t.subject_id)?.name} only</span>}</td>
                                  <td><Badge>{t.role.replace("_", "-")}</Badge></td>
                                  {PRIVS.map(([k, l]) => <td key={l} className="text-center"><input type="checkbox" aria-label={`${l} for ${name(t.user_id)}`} checked={Boolean(t[k])} onChange={e => act({ action: "update", id: t.id, [k]: e.target.checked }, "Privileges saved")} /></td>)}
                                  <td className="text-right"><button className="text-xs text-rose-700 hover:underline" onClick={() => act({ action: "remove", id: t.id }, "Removed")}>Remove</button></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_150px_180px_auto] sm:items-end">
                          <Field label="Add someone">{staffSelect(add.user_id || null, v => setAdd({ ...add, user_id: v ?? "" }), "Add someone")}</Field>
                          <Field label="As"><select className="input py-1" value={add.role} onChange={e => setAdd({ ...add, role: e.target.value })}><option value="co_teacher">Co-teacher</option><option value="assistant">Assistant</option><option value="support">Support (SEN, etc.)</option></select></Field>
                          <Field label="For"><select className="input py-1" value={add.subject_id} onChange={e => setAdd({ ...add, subject_id: e.target.value })}><option value="">The whole class</option>{offers.map(o => <option key={o.subject_id} value={o.subject_id}>{o.subjects?.name} only</option>)}</select></Field>
                          <button className="btn btn-primary" disabled={!add.user_id} onClick={async () => { const r = await act({ action: "add", class_group_id: c.id, user_id: add.user_id, role: add.role, subject_id: add.subject_id || null }, "Added to the class"); if (r.ok) setAdd({ user_id: "", role: "co_teacher", subject_id: "" }); }}>Add</button>
                        </div>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </Page>
  );
}
