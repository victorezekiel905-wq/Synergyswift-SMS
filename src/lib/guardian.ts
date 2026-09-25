/**
 * Everything a guardian may see about their own children. Used by the
 * logged-in parent portal and the passwordless /g/<token> portal.
 */
import { startOfTodayIso, studentName } from "./school";

export async function guardianByToken(svc: any, token: string) {
  if (!/^[0-9a-f]{32,128}$/i.test(token)) return null;
  const { data } = await svc.from("guardians").select("id,tenant_id,full_name,email,phone,whatsapp_phone,notify_email,notify_whatsapp,tenants(status,timezone)")
    .eq("portal_token", token).maybeSingle();
  if (!data || data.tenants?.status !== "active") return null;
  return data as { id: string; tenant_id: string; full_name: string; notify_email: boolean; notify_whatsapp: boolean; tenants: { timezone: string } };
}

export async function guardianOverview(svc: any, tenantId: string, guardianId: string, timezone: string) {
  const [{ data: g }, { data: school }] = await Promise.all([
    svc.from("guardians").select("id,full_name,email,phone,whatsapp_phone,notify_email,notify_whatsapp")
      .eq("tenant_id", tenantId).eq("id", guardianId).maybeSingle(),
    svc.from("tenant_settings").select("school_name,logo_url,brand_color,phone,email,address").eq("tenant_id", tenantId).maybeSingle()
  ]);
  if (!g) return null;
  const { data: links } = await svc.from("student_guardians")
    .select("relation,can_pickup,students(id,first_name,last_name,other_names,admission_no,photo_url,status,class_groups(name))")
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

  return {
    guardian: g,
    school: school ?? null,
    children: students.map((l: any) => {
      const s = l.students;
      const events = (gate.data ?? []).filter((e: any) => e.student_id === s.id);
      const todays = events.filter((e: any) => e.at >= today);
      return {
        id: s.id, name: studentName(s), admission_no: s.admission_no, photo_url: s.photo_url,
        class_name: s.class_groups?.name ?? null, relation: l.relation, can_pickup: l.can_pickup,
        on_site: todays.length ? todays[0].direction === "in" : false,
        today: todays.reverse(),
        recent_events: events.slice(0, 15),
        results: (reports.data ?? []).filter((r: any) => r.student_id === s.id).map((r: any) => ({
          id: r.id, term: r.data?.term_label, average: r.average, position: r.data?.scheme?.show_position ? r.position : null,
          class_size: r.class_size, published_at: r.published_at, access_token: r.access_token
        })),
        pickup_codes: (codes.data ?? []).filter((c: any) => c.student_id === s.id),
        loans: (loans.data ?? []).filter((x: any) => x.student_id === s.id).map((x: any) => ({ title: x.library_books?.title, due_at: x.due_at }))
      };
    })
  };
}
