import { NextRequest, NextResponse } from "next/server";
import { requireCtx, ROLES, jsonError } from "@/lib/auth";

/** Invoice list (filters: term_id, class_group_id, status, q) or one invoice with lines and payments (?id=). */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.finance, "fees");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url);
  const tid = ctx.tenant.id;
  const id = u.searchParams.get("id");
  if (id) {
    const { data: invoice } = await ctx.sb.from("fee_invoices")
      .select("*,students(id,first_name,last_name,other_names,admission_no,class_groups(name)),fee_invoice_lines(id,kind,description,amount),fee_payments(id,amount,method,provider,reference,status,receipt_no,paid_at,payer_name,created_at)")
      .eq("tenant_id", tid).eq("id", id).maybeSingle();
    return invoice ? NextResponse.json(invoice) : jsonError("not found", 404);
  }
  let q = ctx.sb.from("fee_invoices")
    .select("id,invoice_no,title,status,total,amount_paid,due_date,created_at,pay_token,students!inner(id,first_name,last_name,other_names,admission_no,class_group_id,class_groups(name))")
    .eq("tenant_id", tid).order("created_at", { ascending: false }).limit(2000);
  const term = u.searchParams.get("term_id"), cg = u.searchParams.get("class_group_id"), status = u.searchParams.get("status");
  const search = (u.searchParams.get("q") ?? "").replace(/[%,()]/g, " ").trim();
  if (term) q = q.eq("term_id", term);
  if (cg) q = q.eq("students.class_group_id", cg);
  if (status === "outstanding") q = q.in("status", ["issued", "part_paid"]);
  else if (status) q = q.eq("status", status);
  if (search) {
    // Invoice numbers search the invoice; anything else searches the student (inner join keeps only matches).
    q = /^inv-/i.test(search)
      ? q.ilike("invoice_no", `%${search}%`)
      : q.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,admission_no.ilike.%${search}%`, { referencedTable: "students" });
  }
  const { data, error } = await q;
  if (error) return jsonError(error.message);
  return NextResponse.json(data ?? []);
}
