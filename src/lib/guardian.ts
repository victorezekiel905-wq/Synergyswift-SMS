/**
 * Everything a guardian may see about their own children. Used by the
 * logged-in parent portal and the passwordless /g/<token> portal.
 */
import { startOfTodayIso, studentName } from "./school";
import { familyExtras } from "./family";
import { familyGlance } from "./portal-server";
import { beginRequest } from "./request-actor";

export async function guardianByToken(svc: any, token: string) {
  const store = beginRequest();
  if (!/^[0-9a-f]{32,128}$/i.test(token)) return null;
  const { data } = await svc.from("guardians").select("id,tenant_id,full_name,email,phone,whatsapp_phone,notify_email,notify_whatsapp,tenants(status,timezone)")
    .eq("portal_token", token).maybeSingle();
  if (!data || data.tenants?.status !== "active") return null;
  store.actor = `guardian:${data.id}`;
  return data as { id: string; tenant_id: string; full_name: string; notify_email: boolean; notify_whatsapp: boolean; tenants: { timezone: string } };
}

export async function guardianOverview(svc: any, tenantId: string, guardianId: string, timezone: string) {
  const [{ data: g }, { data: school }] = await Promise.all([
    svc.from("guardians").select("id,full_name,email,phone,whatsapp_phone,notify_email,notify_whatsapp,language")
      .eq("tenant_id", tenantId).eq("id", guardianId).maybeSingle(),
    svc.from("tenant_settings").select("school_name,logo_url,brand_color,phone,email,address").eq("tenant_id", tenantId).maybeSingle()
  ]);
  if (!g) return null;
  const { data: links } = await svc.from("student_guardians")
    .select("relation,can_pickup,students(id,first_name,last_name,other_names,admission_no,photo_url,status,class_group_id,class_groups(name))")
    .eq("tenant_id", tenantId).eq("guardian_id", guardianId);
  const students = (links ?? []).filter((l: any) => l.students && l.students.status === "active");
  const ids = students.map((l: any) => l.students.id);
  const today = startOfTodayIso(timezone);

  const [gate, reports, codes, loans] = ids.length ? await Promise.all([
    svc.from("gate_events").select("student_id,direction,method,late,at,note").eq("tenant_id", tenantId).in("student_id", ids)
      .order("at", { ascending: false }).limit(60),
    svc.from("report_cards").select("id,student_id,average,position,class_size,published_at,access_token,data")
      .eq("tenant_id", tenantId).in("student_id", ids).eq("status", "published").order("published_at", { ascending: false }),
    svc.from("pickup_codes").select("id,student_id,delegate_name,expires_at,created_at").eq("tenant_id", tenantId)
      .eq("guardian_id", guardianId).eq("status", "active").gt("expires_at", new Date().toISOString()),
    svc.from("library_loans").select("student_id,due_at,library_books(title)").eq("tenant_id", tenantId).in("student_id", ids).is("returned_at", null)
  ]) : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];

  // Classroom points this week and the latest class story posts (photos as short-lived links).
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const classIds = [...new Set(students.map((l: any) => l.students.class_group_id).filter(Boolean))] as string[];
  const [{ data: pts }, { data: posts }] = ids.length ? await Promise.all([
    svc.from("point_events").select("student_id,skill_name,points,note,created_at").eq("tenant_id", tenantId).in("student_id", ids).gte("created_at", weekAgo).order("created_at", { ascending: false }).limit(300),
    classIds.length ? svc.from("class_story_posts").select("id,class_group_id,body,photos,created_at,users:author_id(full_name)").eq("tenant_id", tenantId).in("class_group_id", classIds).order("created_at", { ascending: false }).limit(12) : Promise.resolve({ data: [] })
  ]) : [{ data: [] }, { data: [] }];
  const story: { id: string; class_group_id: string; body: string | null; photos: string[]; author: string; created_at: string }[] = [];
  for (const p of posts ?? []) {
    const photos: string[] = [];
    for (const path of p.photos ?? []) { const { data } = await svc.storage.from("class-story").createSignedUrl(path, 3600); if (data?.signedUrl) photos.push(data.signedUrl); }
    story.push({ id: p.id, class_group_id: p.class_group_id, body: p.body, photos, author: p.users?.full_name ?? "Teacher", created_at: p.created_at });
  }

  const [extras, glance] = await Promise.all([
    familyExtras(svc, tenantId, guardianId, ids, [...new Set(students.map((l: any) => l.students.class_group_id).filter(Boolean))] as string[]),
    familyGlance(svc, tenantId, timezone, students.map((l: any) => ({ id: l.students.id, class_group_id: l.students.class_group_id }))).catch(() => ({} as Record<string, any>))
  ]);
  return {
    guardian: g,
    school: school ?? null,
    extras,
    children: students.map((l: any) => {
      const s = l.students;
      const events = (gate.data ?? []).filter((e: any) => e.student_id === s.id);
      const todays = events.filter((e: any) => e.at >= today);
      return {
        id: s.id, name: studentName(s), admission_no: s.admission_no, photo_url: s.photo_url, class_group_id: s.class_group_id,
        class_name: s.class_groups?.name ?? null, relation: l.relation, can_pickup: l.can_pickup,
        on_site: todays.length ? todays[0].direction === "in" : false,
        today: todays.reverse(),
        recent_events: events.slice(0, 15),
        results: (reports.data ?? []).filter((r: any) => r.student_id === s.id).map((r: any) => ({
          id: r.id, term: r.data?.term_label, average: r.average, position: r.data?.scheme?.show_position ? r.position : null,
          class_size: r.class_size, published_at: r.published_at, access_token: r.access_token
        })),
        pickup_codes: (codes.data ?? []).filter((c: any) => c.student_id === s.id),
        loans: (loans.data ?? []).filter((x: any) => x.student_id === s.id).map((x: any) => ({ title: x.library_books?.title, due_at: x.due_at })),
        glance: glance[s.id] ?? null,
        points: (() => { const mine = (pts ?? []).filter((e: any) => e.student_id === s.id); return { week: mine.reduce((n: number, e: any) => n + e.points, 0), recent: mine.slice(0, 10) }; })(),
        story: story.filter(p => p.class_group_id === s.class_group_id).slice(0, 6)
      };
    })
  };
}

export type GuardianIdentity = { tenantId: string; guardianId: string; timezone: string; name: string };

/**
 * Identifies the parent behind a request: by the private link token when one
 * is given, otherwise by the signed-in session. Returns an error message when
 * neither identifies a guardian.
 */
export async function identifyGuardian(svc: any, token: string | null | undefined, session: () => Promise<{ tenantId: string; userId: string; timezone: string } | null>): Promise<GuardianIdentity | { error: string; status: number }> {
  if (token) {
    const g = await guardianByToken(svc, token);
    if (!g) return { error: "This link is invalid or has been replaced.", status: 404 };
    return { tenantId: g.tenant_id, guardianId: g.id, timezone: g.tenants.timezone, name: g.full_name };
  }
  const s = await session();
  if (!s) return { error: "unauthenticated", status: 401 };
  const { data: g } = await svc.from("guardians").select("id,full_name").eq("tenant_id", s.tenantId).eq("user_id", s.userId).maybeSingle();
  if (!g) return { error: "no guardian record is linked to this account", status: 403 };
  return { tenantId: s.tenantId, guardianId: g.id, timezone: s.timezone, name: g.full_name };
}

/** True when the guardian is linked to the student. */
export async function guardianHasChild(svc: any, tenantId: string, guardianId: string, studentId: string): Promise<boolean> {
  const { data } = await svc.from("student_guardians").select("student_id").eq("tenant_id", tenantId).eq("guardian_id", guardianId).eq("student_id", studentId).maybeSingle();
  return Boolean(data);
}
