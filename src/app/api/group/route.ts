import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { jsonError } from "@/lib/auth";
import { toCsv } from "@/lib/school";

/**
 * Proprietor / group console: side-by-side numbers for every school in the
 * groups this user administers. Group admins see only their own schools;
 * schools never see the group or each other.
 */
export async function GET(req: NextRequest) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return jsonError("unauthenticated", 401);
  const { data: groupIds } = await sb.rpc("my_group_ids");
  if (!groupIds?.length) return jsonError("not found", 404);
  const svc = createServiceClient();
  const { data: groups } = await svc.from("tenant_groups").select("id,name").in("id", groupIds);
  const { data: tenants } = await svc.from("tenants").select("id,name,status,group_id,timezone").in("group_id", groupIds).order("name");
  const since30 = new Date(Date.now() - 30 * 86400_000).toISOString();
  const count = async (t: string, tid: string, f?: (q: any) => any) => {
    let q = svc.from(t).select("id", { count: "exact", head: true }).eq("tenant_id", tid);
    if (f) q = f(q);
    return (await q).count ?? 0;
  };
  const schools = await Promise.all((tenants ?? []).map(async (t: any) => {
    const [{ data: term }, students, staff, { data: settings }] = await Promise.all([
      svc.from("terms").select("id,name").eq("tenant_id", t.id).eq("is_current", true).maybeSingle(),
      count("students", t.id, q => q.eq("status", "active")),
      count("staff", t.id, q => q.neq("status", "exited")),
      svc.from("tenant_settings").select("currency").eq("tenant_id", t.id).maybeSingle()
    ]);
    const since90 = new Date(Date.now() - 90 * 86400_000).toISOString();
    const [invoices, att, cards, pays, staffIns, applied, admitted] = await Promise.all([
      term ? svc.from("fee_invoices").select("total,amount_paid").eq("tenant_id", t.id).eq("term_id", term.id).neq("status", "void").limit(20000) : { data: [] },
      svc.from("class_attendance").select("status").eq("tenant_id", t.id).gte("date", since30.slice(0, 10)).limit(50000),
      term ? svc.from("report_cards").select("average").eq("tenant_id", t.id).eq("term_id", term.id).eq("kind", "term").limit(20000) : { data: [] },
      svc.from("fee_payments").select("amount").eq("tenant_id", t.id).eq("status", "success").gte("paid_at", since30).limit(50000),
      // Phase 14l: staff punctuality and admissions, for comparing branches.
      svc.from("gate_events").select("late").eq("tenant_id", t.id).eq("person_type", "staff").eq("direction", "in").gte("at", since30).limit(50000),
      count("applications", t.id, q => q.gte("created_at", since90)),
      count("applications", t.id, q => q.gte("created_at", since90).in("status", ["offered", "accepted", "enrolled"]))
    ]);
    const billed = (invoices.data ?? []).reduce((a: number, i: any) => a + Number(i.total), 0);
    const paid = (invoices.data ?? []).reduce((a: number, i: any) => a + Number(i.amount_paid), 0);
    const a = att.data ?? [];
    const avgs = (cards.data ?? []).map((c: any) => c.average).filter((x: any) => x !== null).map(Number);
    return {
      id: t.id, name: t.name, status: t.status, group_id: t.group_id, term: term?.name ?? null, students, staff, currency: settings?.currency ?? "NGN",
      fees: { billed, paid, outstanding: billed - paid, collection_rate: billed ? Math.round((paid / billed) * 1000) / 10 : null },
      collected_30d: (pays.data ?? []).reduce((s: number, p: any) => s + Number(p.amount), 0),
      attendance_30d: a.length ? Math.round((a.filter((x: any) => x.status === "present" || x.status === "late").length / a.length) * 1000) / 10 : null,
      average_score: avgs.length ? Math.round((avgs.reduce((s: number, x: number) => s + x, 0) / avgs.length) * 10) / 10 : null,
      pass_rate: avgs.length ? Math.round((avgs.filter((x: number) => x >= 50).length / avgs.length) * 1000) / 10 : null,
      staff_on_time: (staffIns.data ?? []).length ? Math.round(((staffIns.data ?? []).filter((g: any) => !g.late).length / (staffIns.data ?? []).length) * 1000) / 10 : null,
      applications_90d: applied, admitted_90d: admitted
    };
  }));
  if (new URL(req.url).searchParams.get("format") === "csv") {
    const csv = toCsv([["School", "Term", "Students", "Staff", "Fee collection %", "Outstanding", "Collected (30 days)", "Attendance % (30 days)", "Average score", "Pass rate %", "Staff on time % (30 days)", "Applications (90 days)", "Offered places (90 days)"],
      ...schools.map((s: any) => [s.name, s.term, s.students, s.staff, s.fees.collection_rate, s.fees.outstanding, s.collected_30d, s.attendance_30d, s.average_score, s.pass_rate, s.staff_on_time, s.applications_90d, s.admitted_90d])]);
    return new NextResponse("\uFEFF" + csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="branches.csv"' } });
  }
  return NextResponse.json({ groups: groups ?? [], schools });
}
