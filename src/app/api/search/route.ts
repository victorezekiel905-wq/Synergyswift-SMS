import { NextRequest, NextResponse } from "next/server";
import { requireCtx, ROLES, hasAny } from "@/lib/auth";
import { studentName } from "@/lib/school";

export const dynamic = "force-dynamic";

type Hit = { type: string; id: string; title: string; detail?: string | null; href: string };

/**
 * Search across the school. Every query runs on the caller's own client, so
 * row-level security limits results to what this person may see anyway.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  const raw = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 60);
  // Characters that would change the meaning of a PostgREST filter are dropped.
  const q = raw.replace(/[%_,()*\\"'.:]/g, " ").replace(/\s+/g, " ").trim();
  if (q.length < 2) return NextResponse.json({ results: [] });
  const like = `%${q}%`;
  const words = q.split(" ").filter(w => w.length >= 2).slice(0, 3);
  const tid = ctx.tenant.id;
  const sb = ctx.sb;
  const admin = hasAny(ctx, ROLES.admin);
  const finance = hasAny(ctx, ROLES.finance);
  const admissions = hasAny(ctx, ROLES.admissions);
  const nameOr = (cols: string[]) => cols.flatMap(c => words.map(w => `${c}.ilike.%${w}%`)).join(",");

  const jobs: Promise<Hit[]>[] = [
    sb.from("students").select("id,first_name,last_name,other_names,admission_no,status,class_groups(name)").eq("tenant_id", tid)
      .or(`${nameOr(["first_name", "last_name", "other_names"])},admission_no.ilike.${like}`).limit(8)
      .then(({ data }: any) => (data ?? []).map((s: any) => ({ type: "Student", id: s.id, title: studentName(s), detail: [s.admission_no, s.class_groups?.name, s.status !== "active" ? s.status : null].filter(Boolean).join(" · "), href: `/school/students/${s.id}` }))),
    sb.from("users").select("id,full_name,email,role").eq("tenant_id", tid).not("role", "in", "(student,parent,alumni)")
      .or(`${nameOr(["full_name"])},email.ilike.${like}`).limit(6)
      .then(({ data }: any) => (data ?? []).map((u: any) => ({ type: "Staff", id: u.id, title: u.full_name, detail: `${u.role.replace(/_/g, " ")} · ${u.email}`, href: "/school/hr" }))),
    sb.from("class_groups").select("id,name,level").eq("tenant_id", tid).ilike("name", like).limit(5)
      .then(({ data }: any) => (data ?? []).map((c: any) => ({ type: "Class", id: c.id, title: c.name, detail: c.level, href: "/school/students" }))),
    sb.from("tickets").select("id,ticket_no,subject,status").eq("tenant_id", tid).or(`ticket_no.ilike.${like},subject.ilike.${like}`).limit(5)
      .then(({ data }: any) => (data ?? []).map((t: any) => ({ type: "Complaint", id: t.id, title: `${t.ticket_no}: ${t.subject}`, detail: t.status.replace("_", " "), href: `/school/support?ticket=${t.id}` })))
  ];
  if (admin) {
    jobs.push(sb.from("guardians").select("id,full_name,phone,email").eq("tenant_id", tid).or(`${nameOr(["full_name"])},phone.ilike.${like},email.ilike.${like}`).limit(6)
      .then(({ data }: any) => (data ?? []).map((g: any) => ({ type: "Family", id: g.id, title: g.full_name, detail: g.phone ?? g.email, href: `/school/community?tab=families&family=${g.id}` }))));
    jobs.push(sb.from("alumni").select("id,full_name,graduation_year").eq("tenant_id", tid).or(nameOr(["full_name"])).limit(4)
      .then(({ data }: any) => (data ?? []).map((a: any) => ({ type: "Alumnus", id: a.id, title: a.full_name, detail: a.graduation_year ? `class of ${a.graduation_year}` : null, href: "/school/community?tab=alumni" }))));
  }
  if (finance) {
    jobs.push(sb.from("fee_invoices").select("id,invoice_no,title,status,students(first_name,last_name)").eq("tenant_id", tid).ilike("invoice_no", like).limit(5)
      .then(({ data }: any) => (data ?? []).map((i: any) => ({ type: "Invoice", id: i.id, title: `${i.invoice_no}: ${i.title}`, detail: `${studentName(i.students)} · ${i.status.replace("_", " ")}`, href: "/school/fees" }))));
    jobs.push(sb.from("crm_partners").select("id,name,kind").eq("tenant_id", tid).ilike("name", like).limit(4)
      .then(({ data }: any) => (data ?? []).map((p: any) => ({ type: "Partner", id: p.id, title: p.name, detail: p.kind, href: "/school/community?tab=partners" }))));
  }
  if (admissions) {
    jobs.push(sb.from("admission_leads").select("id,parent_name,child_name,stage").eq("tenant_id", tid).or(`${nameOr(["parent_name", "child_name"])},phone.ilike.${like}`).limit(5)
      .then(({ data }: any) => (data ?? []).map((l: any) => ({ type: "Enquiry", id: l.id, title: l.parent_name, detail: [l.child_name, l.stage.replace("_", " ")].filter(Boolean).join(" · "), href: `/school/admissions?lead=${l.id}` }))));
    jobs.push(sb.from("applications").select("id,application_no,first_name,last_name,status").eq("tenant_id", tid).or(`${nameOr(["first_name", "last_name"])},application_no.ilike.${like}`).limit(5)
      .then(({ data }: any) => (data ?? []).map((a: any) => ({ type: "Application", id: a.id, title: `${a.first_name} ${a.last_name}`, detail: `${a.application_no} · ${a.status}`, href: "/school/admissions?tab=applications" }))));
  }
  const results = (await Promise.all(jobs.map(j => j.catch(() => [] as Hit[])))).flat();
  return NextResponse.json({ results });
}
