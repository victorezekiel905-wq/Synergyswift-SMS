/**
 * Staff onboarding (migration 9800): staff are added with their email, the subjects they teach
 * and (optionally) their ID number, then get in by sign-up code, invitation link or one-time
 * password. The pieces talk to each other: the subjects show in HR and in Class teams, and the
 * admins are told when someone has joined so they can be put in classes.
 */
import { fetchAll } from "./fetch-all";
import { tellStaff } from "./hr-server";
import { assignmentChanges, type Assignment } from "./staff-onboarding";

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

/**
 * When each account in the school last signed in (migration 10200), by user id. Null before
 * the database update, when it cannot be known.
 */
export async function tenantSignIns(svc: Svc, tenantId: string): Promise<Map<string, string | null> | null> {
  try {
    const rows = await fetchAll<{ user_id: string; last_sign_in_at: string | null }>(() => svc.rpc("tenant_sign_ins", { p_tenant: tenantId }).order("user_id"));
    return new Map(rows.map(r => [r.user_id, r.last_sign_in_at]));
  } catch { return null; }
}

export type OnboardRow = {
  id: string; full_name: string; email: string | null; staff_no: string; position: string | null; created_at: string;
  subject_ids: string[]; has_account: boolean; role: string | null; code: string | null; classes: number; active: boolean | null;
  /** Has the person ever signed in? False: the account was made (link or one-time password) but not used. Null: not known yet. */
  signed_in: boolean | null;
  /** Their classes now (signed up) or the classes waiting for them (not yet). */
  assignments: Assignment[];
};

/**
 * Everyone on the staff list with where they are: waiting to sign up (with their live code),
 * signed up, and how many classes they are in (form teacher, subject teacher or class team).
 */
export async function onboardingList(svc: Svc, tenantId: string): Promise<OnboardRow[]> {
  const [staff, subjects, codes, users, offerings, forms, team, plans, signIns] = await Promise.all([
    fetchAll<any>(() => svc.from("staff").select("id,full_name,email,staff_no,position,created_at,user_id,status").eq("tenant_id", tenantId).neq("status", "exited").order("id")),
    subjectsByStaff(svc, tenantId),
    fetchAll<any>(() => svc.from("account_codes").select("staff_id,code,role,used_at,uses,max_uses").eq("tenant_id", tenantId).eq("kind", "staff").is("revoked_at", null).order("id")).catch(() => []),
    fetchAll<any>(() => svc.from("users").select("id,role,active").eq("tenant_id", tenantId).order("id")),
    fetchAll<any>(() => svc.from("subject_offerings").select("class_group_id,subject_id,teacher_id").eq("tenant_id", tenantId).not("teacher_id", "is", null).order("id")),
    fetchAll<any>(() => svc.from("class_groups").select("id,form_teacher_id").eq("tenant_id", tenantId).not("form_teacher_id", "is", null).order("id")),
    fetchAll<any>(() => svc.from("class_staff").select("class_group_id,user_id").eq("tenant_id", tenantId).order("id")).catch(() => []),
    fetchAll<any>(() => svc.from("staff_class_plans").select("staff_id,class_group_id,subject_id").eq("tenant_id", tenantId).order("id")).catch(() => []),
    tenantSignIns(svc, tenantId)
  ]);
  const own = new Map<string, Assignment[]>();
  const put = (key: string | null, a: Assignment) => { if (key) own.set(key, [...(own.get(key) ?? []), a]); };
  for (const o of offerings) put(`u:${o.teacher_id}`, { class_group_id: o.class_group_id, subject_id: o.subject_id });
  for (const c of forms) put(`u:${c.form_teacher_id}`, { class_group_id: c.id, subject_id: null });
  for (const pl of plans) put(`s:${pl.staff_id}`, { class_group_id: pl.class_group_id, subject_id: pl.subject_id ?? null });
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
      code: !s.user_id && live ? formatCode(c.code) : null, classes: s.user_id ? (classesOf.get(s.user_id)?.size ?? 0) : 0, active: u ? Boolean(u.active) : null,
      assignments: s.user_id ? own.get(`u:${s.user_id}`) ?? [] : own.get(`s:${s.id}`) ?? [],
      signed_in: !s.user_id ? false : signIns ? Boolean(signIns.get(s.user_id)) : null
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

/**
 * Sets the classes someone teaches to exactly what was ticked. Signed up: put in place now
 * (subject teacher, or form teacher). Not yet: kept and put in place the moment they sign up.
 */
export async function setStaffClasses(svc: Svc, p: { tenantId: string; staffId: string; actor: string; want: Assignment[] }): Promise<{ error?: string; applied?: boolean; count: number }> {
  const tid = p.tenantId;
  const { data: s } = await svc.from("staff").select("id,user_id").eq("tenant_id", tid).eq("id", p.staffId).maybeSingle();
  if (!s) return { error: "staff not found", count: 0 };
  const classIds = [...new Set(p.want.map(a => a.class_group_id))], subjectIds = [...new Set(p.want.map(a => a.subject_id).filter(Boolean) as string[])];
  if (classIds.length) {
    const { data } = await svc.from("class_groups").select("id").eq("tenant_id", tid).in("id", classIds);
    if ((data ?? []).length !== classIds.length) return { error: "a class chosen is not one of the school's classes", count: 0 };
  }
  if (subjectIds.length) {
    const { data } = await svc.from("subjects").select("id").eq("tenant_id", tid).in("id", subjectIds);
    if ((data ?? []).length !== subjectIds.length) return { error: "a subject chosen is not one of the school's subjects", count: 0 };
  }
  if (!s.user_id) {
    const { error: dErr } = await svc.from("staff_class_plans").delete().eq("tenant_id", tid).eq("staff_id", s.id);
    if (dErr) return { error: /does not exist|schema cache/i.test(dErr.message) ? "choosing classes before sign-up needs the database update (migration 20260101009800)" : dErr.message, count: 0 };
    const rows = [...new Map(p.want.map(a => [`${a.class_group_id}:${a.subject_id ?? ""}`, a])).values()]
      .map(a => ({ tenant_id: tid, staff_id: s.id, class_group_id: a.class_group_id, subject_id: a.subject_id, created_by: p.actor }));
    if (rows.length) { const { error } = await svc.from("staff_class_plans").insert(rows); if (error) return { error: error.message, count: 0 }; }
    return { applied: false, count: rows.length };
  }
  const uid = s.user_id;
  const [{ data: offs }, { data: forms }] = await Promise.all([
    svc.from("subject_offerings").select("id,class_group_id,subject_id").eq("tenant_id", tid).eq("teacher_id", uid),
    svc.from("class_groups").select("id").eq("tenant_id", tid).eq("form_teacher_id", uid)
  ]);
  const have: Assignment[] = [...(offs ?? []).map((o: any) => ({ class_group_id: o.class_group_id, subject_id: o.subject_id })), ...(forms ?? []).map((c: any) => ({ class_group_id: c.id, subject_id: null }))];
  const { add, remove } = assignmentChanges(have, p.want);
  for (const a of remove) {
    const r = a.subject_id
      ? await svc.from("subject_offerings").update({ teacher_id: null }).eq("tenant_id", tid).eq("class_group_id", a.class_group_id).eq("subject_id", a.subject_id).eq("teacher_id", uid)
      : await svc.from("class_groups").update({ form_teacher_id: null }).eq("tenant_id", tid).eq("id", a.class_group_id).eq("form_teacher_id", uid);
    if (r.error) return { error: r.error.message, count: 0 };
  }
  for (const a of add) {
    const r = a.subject_id
      ? await svc.from("subject_offerings").upsert({ tenant_id: tid, class_group_id: a.class_group_id, subject_id: a.subject_id, teacher_id: uid }, { onConflict: "class_group_id,subject_id" })
      : await svc.from("class_groups").update({ form_teacher_id: uid }).eq("tenant_id", tid).eq("id", a.class_group_id);
    if (r.error) return { error: r.error.message, count: 0 };
  }
  if (add.length || remove.length) await svc.from("audit_logs").insert({ tenant_id: tid, actor_id: p.actor, action: "staff.classes_set", target: uid, meta: { added: add.length, removed: remove.length } });
  return { applied: true, count: p.want.length };
}