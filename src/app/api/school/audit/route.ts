import { NextRequest, NextResponse } from "next/server";
import { requireCtx, ROLES, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

// Plain names for the tables people ask about most.
const TABLE_LABEL: Record<string, string> = {
  students: "Students", guardians: "Parents", student_guardians: "Parent links", staff: "Staff", users: "Accounts", score_entries: "Scores", report_cards: "Report cards",
  class_attendance: "Attendance", fee_invoices: "Invoices", fee_payments: "Payments", fee_items: "Fee items", expenses: "Expenses", payslips: "Payslips",
  tenant_settings: "School settings", class_groups: "Classes", subjects: "Subjects", subject_offerings: "Class subjects", grading_schemes: "Grading schemes",
  behaviour_records: "Behaviour", medical_profiles: "Medical", applications: "Applications", admission_leads: "Enquiries", tickets: "Complaints",
  exams: "Exams", wallet_transactions: "Wallet", consent_records: "Consent", school_sections: "Sections", staff_devices: "Staff devices"
};

/**
 * The record of every create, edit and delete, newest first. Filters: table,
 * op, actor (user id), row (record id), q (searches the changed values),
 * from/to (dates). format=csv downloads the result. Admins only.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin);
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url).searchParams;
  const tid = ctx.tenant.id;
  const csv = u.get("format") === "csv";
  let q = ctx.sb.from("data_changes").select("id,table_name,row_id,op,actor_id,actor,changes,at").eq("tenant_id", tid).order("at", { ascending: false }).limit(csv ? 5000 : 200);
  const table = u.get("table"), op = u.get("op"), actor = u.get("actor"), row = u.get("row"), from = u.get("from"), to = u.get("to"), before = u.get("before");
  if (table) q = q.eq("table_name", table);
  if (op && ["insert", "update", "delete"].includes(op)) q = q.eq("op", op);
  if (actor === "system") q = q.is("actor_id", null).eq("actor", "system");
  else if (actor && /^[0-9a-f-]{36}$/i.test(actor)) q = q.eq("actor_id", actor);
  if (row) q = q.eq("row_id", row.slice(0, 64));
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) q = q.gte("at", `${from}T00:00:00Z`);
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) q = q.lte("at", `${to}T23:59:59Z`);
  if (before && /^\d+$/.test(before)) q = q.lt("id", Number(before));
  const { data, error } = await q;
  if (error) return jsonError(error.message);
  let items = data ?? [];
  const text = (u.get("q") ?? "").trim().toLowerCase();
  if (text) items = items.filter((c: any) => JSON.stringify(c.changes).toLowerCase().includes(text));

  const svc = createServiceClient();
  const ids = [...new Set(items.map((c: any) => c.actor_id).filter(Boolean))] as string[];
  const guardians = [...new Set(items.map((c: any) => /^guardian:/.test(c.actor) ? c.actor.slice(9) : null).filter(Boolean))] as string[];
  const [{ data: users }, { data: gs }] = await Promise.all([
    ids.length ? svc.from("users").select("id,full_name,role").in("id", ids) : { data: [] },
    guardians.length ? svc.from("guardians").select("id,full_name").eq("tenant_id", tid).in("id", guardians) : { data: [] }
  ]);
  const who = (c: any) => {
    if (c.actor_id) { const x = (users ?? []).find((y: any) => y.id === c.actor_id); return x ? `${x.full_name} (${x.role.replace(/_/g, " ")})` : "Former user"; }
    if (/^guardian:/.test(c.actor)) return `${(gs ?? []).find((g: any) => g.id === c.actor.slice(9))?.full_name ?? "A parent"} (parent link)`;
    return c.actor === "public" ? "Public page" : "System";
  };
  const rows = items.map((c: any) => ({ ...c, who: who(c), table_label: TABLE_LABEL[c.table_name] ?? c.table_name.replace(/_/g, " ") }));
  if (csv) {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const body = ["when,who,what,table,record,changes", ...rows.map((r: any) => [r.at, r.who, r.op, r.table_label, r.row_id, JSON.stringify(r.changes)].map(esc).join(","))].join("\n");
    await ctx.sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "change_history.exported", meta: { rows: rows.length } });
    return new NextResponse(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="change-history-${new Date().toISOString().slice(0, 10)}.csv"` } });
  }
  const { data: staff } = await svc.from("users").select("id,full_name").eq("tenant_id", tid).not("role", "in", "(student,parent,alumni)").order("full_name");
  return NextResponse.json({ items: rows, tables: Object.entries(TABLE_LABEL).map(([k, v]) => ({ key: k, label: v })).sort((a, b) => a.label.localeCompare(b.label)), staff: staff ?? [],
    next: rows.length === 200 ? rows[rows.length - 1].id : null });
}
