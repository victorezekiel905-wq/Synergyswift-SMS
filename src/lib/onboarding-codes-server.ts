/**
 * Codes by class, for School office → Onboarding (admins, every class) and Teaching → My class
 * codes (a class teacher, their own class only): each student's sign-up code and each child's
 * parent code. And transcript codes (migration 10100), which only admins make.
 * Service client: callers decide which classes the person may see.
 */
import { fetchAll, chunks } from "./fetch-all";
import { formatCode } from "./sign-up-codes";
import { studentName } from "./school";
import { loadBrand, rowsForGuardian, enqueue, tryDispatch, type OutboxRow } from "./messaging/outbox";
import { communityNote } from "./messaging/notices";

type Svc = any;

export type ClassCodeRow = {
  id: string; name: string; admission_no: string | null; class_id: string | null; class_name: string | null; has_account: boolean;
  student_code: string | null; parent_code: string | null; parent_uses: number; parent_max: number;
  parents: { name: string; has_account: boolean }[];
};

/** The classes a person may see codes for: every class for admins, else the classes they are class (form) teacher of. */
export async function codeClasses(svc: Svc, p: { tenantId: string; userId: string; admin: boolean }) {
  let q = svc.from("class_groups").select("id,name,level").eq("tenant_id", p.tenantId).order("name");
  if (!p.admin) q = q.eq("form_teacher_id", p.userId);
  const { data } = await q;
  return (data ?? []) as { id: string; name: string; level: string | null }[];
}

/** Every student in these classes with their sign-up code, parent code and linked parents. */
export async function classCodes(svc: Svc, tenantId: string, classIds: string[]): Promise<ClassCodeRow[]> {
  if (!classIds.length) return [];
  const students = (await Promise.all(chunks(classIds).map(c => fetchAll<any>(() =>
    svc.from("students").select("id,first_name,last_name,other_names,admission_no,class_group_id,user_id,class_groups(name)")
      .eq("tenant_id", tenantId).eq("status", "active").in("class_group_id", c).order("id"))))).flat();
  const ids = students.map((s: any) => s.id as string);
  const [codes, links] = ids.length ? await Promise.all([
    Promise.all(chunks(ids).map(c => fetchAll<any>(() => svc.from("account_codes").select("id,kind,student_id,code,uses,max_uses,used_at")
      .eq("tenant_id", tenantId).in("kind", ["student", "parent_link"]).is("revoked_at", null).in("student_id", c).order("id")))).then(x => x.flat()).catch(() => []),
    Promise.all(chunks(ids).map(c => fetchAll<any>(() => svc.from("student_guardians").select("student_id,guardian_id,guardians(full_name,user_id)")
      .eq("tenant_id", tenantId).in("student_id", c).order("student_id").order("guardian_id")))).then(x => x.flat())
  ]) : [[], []];
  const live = (c: any) => c && !c.used_at && c.uses < c.max_uses;
  return students.map((s: any) => {
    const sc = codes.find((c: any) => c.kind === "student" && c.student_id === s.id);
    const pc = codes.find((c: any) => c.kind === "parent_link" && c.student_id === s.id);
    return {
      id: s.id, name: studentName(s), admission_no: s.admission_no ?? null, class_id: s.class_group_id, class_name: s.class_groups?.name ?? null,
      has_account: Boolean(s.user_id),
      student_code: !s.user_id && live(sc) ? formatCode(sc.code) : null,
      parent_code: live(pc) ? formatCode(pc.code) : null, parent_uses: pc?.uses ?? 0, parent_max: pc?.max_uses ?? 4,
      parents: links.filter((l: any) => l.student_id === s.id && l.guardians).map((l: any) => ({ name: l.guardians.full_name, has_account: Boolean(l.guardians.user_id) }))
    };
  }).sort((a: ClassCodeRow, b: ClassCodeRow) => (a.class_name ?? "").localeCompare(b.class_name ?? "") || a.name.localeCompare(b.name));
}

// ---------------- Transcript codes ----------------

export type TranscriptRow = {
  id: string; name: string; admission_no: string | null; class_id: string | null; class_name: string | null;
  code: string | null; uses: number; max_uses: number; expires_at: string | null; released: boolean;
  unlocked_by: { user_id: string; name: string; at: string }[]; parents: number;
};

export const transcriptNeedsUpdate = (m: string) => /transcript_(codes|access)|issue_transcript_code|unlock_transcript/.test(m);

/** Every active student with their live transcript code and which parents have opened their transcript. */
export async function transcriptCodes(svc: Svc, tenantId: string): Promise<TranscriptRow[]> {
  const [students, codes, access, links] = await Promise.all([
    fetchAll<any>(() => svc.from("students").select("id,first_name,last_name,other_names,admission_no,class_group_id,transcript_allowed,class_groups(name)").eq("tenant_id", tenantId).eq("status", "active").order("id")),
    fetchAll<any>(() => svc.from("transcript_codes").select("id,student_id,code,uses,max_uses,expires_at").eq("tenant_id", tenantId).is("revoked_at", null).order("id")),
    fetchAll<any>(() => svc.from("transcript_access").select("student_id,user_id,granted_at,users(full_name)").eq("tenant_id", tenantId).is("revoked_at", null).order("student_id").order("user_id")),
    fetchAll<any>(() => svc.from("student_guardians").select("student_id,guardian_id").eq("tenant_id", tenantId).order("student_id").order("guardian_id"))
  ]);
  const now = new Date().toISOString();
  return students.map((s: any) => {
    const c = codes.find((x: any) => x.student_id === s.id);
    const usable = c && (!c.expires_at || c.expires_at > now);
    return {
      id: s.id, name: studentName(s), admission_no: s.admission_no ?? null, class_id: s.class_group_id ?? null, class_name: s.class_groups?.name ?? null,
      code: usable ? formatCode(c.code) : null, uses: c?.uses ?? 0, max_uses: c?.max_uses ?? 4, expires_at: c?.expires_at ?? null, released: Boolean(s.transcript_allowed),
      unlocked_by: access.filter((a: any) => a.student_id === s.id).map((a: any) => ({ user_id: a.user_id, name: a.users?.full_name ?? "A parent", at: a.granted_at })),
      parents: links.filter((l: any) => l.student_id === s.id).length
    };
  }).sort((a: TranscriptRow, b: TranscriptRow) => (a.class_name ?? "~").localeCompare(b.class_name ?? "~") || a.name.localeCompare(b.name));
}

/** Makes (or replaces) transcript codes for these students. Returns how many were made. */
export async function makeTranscriptCodes(svc: Svc, p: { tenantId: string; studentIds: string[]; by: string; days: number | null }) {
  // A whole school at once: ids in batches (a long list does not fit in one request), ten codes at a time.
  let made = 0;
  for (const c of chunks([...new Set(p.studentIds)])) {
    const { data: mine } = await svc.from("students").select("id").eq("tenant_id", p.tenantId).in("id", c);
    const ids = (mine ?? []).map((s: { id: string }) => s.id);
    for (let i = 0; i < ids.length; i += 10) {
      const results = await Promise.all(ids.slice(i, i + 10).map((id: string) => svc.rpc("issue_transcript_code", { p_student: id, p_by: p.by, p_days: p.days })));
      const failed = results.find((r: any) => r.error);
      if (failed) throw new Error(transcriptNeedsUpdate(failed.error.message) ? "Transcript codes need the database update (migration 20260101010100)." : failed.error.message);
      made += results.length;
    }
  }
  return made;
}

/** Sends each child's live transcript code to the parents linked to them. */
export async function sendTranscriptCodes(svc: Svc, p: { tenantId: string; studentIds: string[]; baseUrl: string; actor: string }) {
  const brand = await loadBrand(svc, p.tenantId);
  const rows: OutboxRow[] = [];
  let skipped = 0;
  for (const c of chunks(p.studentIds)) {
    const [{ data: codes }, { data: links }, { data: st }] = await Promise.all([
      svc.from("transcript_codes").select("student_id,code,expires_at").eq("tenant_id", p.tenantId).is("revoked_at", null).in("student_id", c),
      svc.from("student_guardians").select("student_id,guardians(id,full_name,email,phone,whatsapp_phone,notify_email,notify_whatsapp,notify_sms)").eq("tenant_id", p.tenantId).in("student_id", c),
      svc.from("students").select("id,first_name,last_name,other_names").eq("tenant_id", p.tenantId).in("id", c)
    ]);
    for (const sid of c) {
      const code = (codes ?? []).find((x: any) => x.student_id === sid);
      const kids = (links ?? []).filter((l: any) => l.student_id === sid && l.guardians);
      if (!code || !kids.length) { skipped++; continue; }
      const child = studentName((st ?? []).find((x: any) => x.id === sid));
      const until = code.expires_at ? ` It works until ${new Date(code.expires_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.` : "";
      for (const l of kids) rows.push(...rowsForGuardian(p.tenantId, { ...l.guardians, notify_email: true }, "transcript_code", communityNote(brand, {
        name: l.guardians.full_name, subject: `${child}'s transcript code`,
        lines: [`${child}'s transcript code: ${formatCode(code.code)}`, `Sign in, open Portfolio & transcript, choose ${child} and type the code to open the transcript.${until}`],
        link: `${p.baseUrl}/parent/portfolio?student=${sid}`, linkLabel: "Open the transcript" }), sid, p.actor));
    }
  }
  if (rows.length) { await enqueue(svc, rows); await tryDispatch(svc, { budgetMs: 6000 }).catch(() => null); }
  return { messages: rows.length, skipped };
}

/** Whether this parent has opened this child's transcript. Before the database update there are no codes: open, as before. */
export async function parentHasTranscript(svc: Svc, p: { tenantId: string; studentId: string; userId: string }): Promise<boolean> {
  const { data, error } = await svc.from("transcript_access").select("student_id").eq("tenant_id", p.tenantId).eq("student_id", p.studentId).eq("user_id", p.userId).is("revoked_at", null).maybeSingle();
  if (error) return transcriptNeedsUpdate(error.message);
  return Boolean(data);
}
