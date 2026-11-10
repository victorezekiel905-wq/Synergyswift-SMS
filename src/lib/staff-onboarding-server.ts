/**
 * Staff onboarding (migration 9800): staff are added with their email, the subjects they teach
 * and (optionally) their ID number, then get in by sign-up code, invitation link or one-time
 * password. The pieces talk to each other: the subjects show in HR and in Class teams, and the
 * admins are told when someone has joined so they can be put in classes.
 */
import { fetchAll } from "./fetch-all";
import { tellStaff } from "./hr-server";

type Svc = any;

/** The subjects each member of staff teaches, by staff id. Empty before the database update. */
export async function subjectsByStaff(svc: Svc, tenantId: string): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const rows = await fetchAll<{ staff_id: string; subject_id: string }>(() =>
    svc.from("staff_subjects").select("staff_id,subject_id").eq("tenant_id", tenantId).order("staff_id").order("subject_id")).catch(() => []);
  for (const r of rows) out.set(r.staff_id, [...(out.get(r.staff_id) ?? []), r.subject_id]);
  return out;
}

/** Replace the subjects a member of staff teaches (only this school's subjects are kept). */
export async function setStaffSubjects(sb: Svc, tenantId: string, staffId: string, subjectIds: string[]): Promise<{ error?: string }> {
  const ids = [...new Set(subjectIds)];
  if (ids.length) {
    const { data: ok } = await sb.from("subjects").select("id").eq("tenant_id", tenantId).in("id", ids);
    if ((ok ?? []).length !== ids.length) return { error: "a subject chosen is not one of the school's subjects" };
  }
  const { data: now, error: rErr } = await sb.from("staff_subjects").select("subject_id").eq("tenant_id", tenantId).eq("staff_id", staffId);
  if (rErr) return { error: /does not exist|schema cache/i.test(rErr.message) ? "subjects need the database update (migration 20260101009800)" : rErr.message };
  const have = new Set<string>((now ?? []).map((r: any) => r.subject_id as string));
  const drop = [...have].filter(id => !ids.includes(id)), add = ids.filter(id => !have.has(id));
  if (drop.length) {
    const { error } = await sb.from("staff_subjects").delete().eq("tenant_id", tenantId).eq("staff_id", staffId).in("subject_id", drop);
    if (error) return { error: error.message };
  }
  if (add.length) {
    const { error } = await sb.from("staff_subjects").insert(add.map(subject_id => ({ tenant_id: tenantId, staff_id: staffId, subject_id })));
    if (error) return { error: error.message };
  }
  return {};
}

/** The next free staff number (STF-0001 …), worked out here if the database function is not there yet. */
export async function nextStaffNo(svc: Svc, tenantId: string): Promise<string> {
  const { data, error } = await svc.rpc("next_staff_no", { p_tenant: tenantId });
  if (!error && data) return data as string;
  const rows = await fetchAll<{ staff_no: string }>(() => svc.from("staff").select("staff_no,id").eq("tenant_id", tenantId).like("staff_no", "STF-%").order("id"));
  const max = Math.max(0, ...rows.map(r => Number(/^STF-(\d{1,9})$/.exec(r.staff_no)?.[1] ?? 0)));
  return `STF-${String(max + 1).padStart(4, "0")}`;
}

export type OnboardRow = {
  id: string; full_name: string; email: string | null; staff_no: string; position: string | null; created_at: string;
  subject_ids: string[]; has_account: boolean; role: string | null; code: string | null; classes: number; active: boolean | null;
};

/**
 * Everyone on the staff list with where they are: waiting to sign up (with their live code),
 * signed up, and how many classes they are in (form teacher, subject teacher or class team).
 */
export async function onboardingList(svc: Svc, tenantId: string): Promise<OnboardRow[]> {
  const [staff, subjects, codes, users, offerings, forms, team] = await Promise.all([
    fetchAll<any>(() => svc.from("staff").select("id,full_name,email,staff_no,position,created_at,user_id,status").eq("tenant_id", tenantId).neq("status", "exited").order("id")),
    subjectsByStaff(svc, tenantId),
    fetchAll<any>(() => svc.from("account_codes").select("staff_id,code,role,used_at,uses,max_uses").eq("tenant_id", tenantId).eq("kind", "staff").is("revoked_at", null).order("id")).catch(() => []),
    fetchAll<any>(() => svc.from("users").select("id,role,active").eq("tenant_id", tenantId).order("id")),
    fetchAll<any>(() => svc.from("subject_offerings").select("class_group_id,teacher_id").eq("tenant_id", tenantId).not("teacher_id", "is", null).order("id")),
    fetchAll<any>(() => svc.from("class_groups").select("id,form_teacher_id").eq("tenant_id", tenantId).not("form_teacher_id", "is", null).order("id")),
    fetchAll<any>(() => svc.from("class_staff").select("class_group_id,user_id").eq("tenant_id", tenantId).order("id")).catch(() => [])
  ]);
  const classesOf = new Map<string, Set<string>>();
  const add = (uid: string | null, cls: string) => { if (uid) classesOf.set(uid, (classesOf.get(uid) ?? new Set()).add(cls)); };
  for (const o of offerings) add(o.teacher_id, o.class_group_id);
  for (const c of forms) add(c.form_teacher_id, c.id);
  for (const t of team) add(t.user_id, t.class_group_id);
  const userById = new Map(users.map((u: any) => [u.id, u]));
  const { formatCode } = await import("./sign-up-codes");
  return staff.map((s: any) => {
    const c = codes.find((x: any) => x.staff_id === s.id);
    const live = c && !c.used_at && c.uses < c.max_uses;
    const u: any = s.user_id ? userById.get(s.user_id) : null;
    return {
      id: s.id, full_name: s.full_name, email: s.email, staff_no: s.staff_no, position: s.position, created_at: s.created_at,
      subject_ids: subjects.get(s.id) ?? [], has_account: Boolean(s.user_id), role: u?.role ?? c?.role ?? null,
      code: !s.user_id && live ? formatCode(c.code) : null, classes: s.user_id ? (classesOf.get(s.user_id)?.size ?? 0) : 0, active: u ? Boolean(u.active) : null
    };
  }).sort((a: OnboardRow, b: OnboardRow) => b.created_at.localeCompare(a.created_at));
}

/**
 * The handshake when someone on the staff list makes their account: the school's admins are
 * told, with the subjects they teach, so they can put them in classes.
 */
export async function staffJoined(svc: Svc, p: { tenantId: string; userId: string; baseUrl: string }) {
  const { data: s } = await svc.from("staff").select("id,full_name").eq("tenant_id", p.tenantId).eq("user_id", p.userId).maybeSingle();
  if (!s) return;
  const subjects = (await subjectsByStaff(svc, p.tenantId)).get(s.id) ?? [];
  const { data: names } = subjects.length ? await svc.from("subjects").select("name").in("id", subjects).order("name") : { data: [] };
  const { data: admins } = await svc.from("users").select("id,role,extra_roles").eq("tenant_id", p.tenantId).eq("active", true);
  const to = (admins ?? []).filter((u: any) => ["school_admin", "principal"].some(r => u.role === r || (u.extra_roles ?? []).includes(r))).map((u: any) => u.id);
  const teaches = (names ?? []).map((n: any) => n.name).join(", ");
  await tellStaff(svc, p.tenantId, to, "staff_joined", `${s.full_name} has signed up`,
    `${s.full_name} has made their account${teaches ? ` and teaches ${teaches}` : ""}. Put them in their classes under School office → Class teams.`,
    `${p.baseUrl}/school/class-teams`, s.id);
}
