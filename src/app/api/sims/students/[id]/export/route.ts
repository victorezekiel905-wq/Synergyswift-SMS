import { NextRequest, NextResponse } from "next/server";
import { requireCtx, ROLES, jsonError } from "@/lib/auth";

/**
 * Everything the school holds about one student, as a single JSON file, for
 * data-subject access requests under the GDPR, Nigeria's NDPA and similar laws.
 * Admins only; every export is written to the audit log.
 */
const TABLES: { key: string; table: string; select: string; by?: string }[] = [
  { key: "guardians", table: "student_guardians", select: "relation,can_pickup,guardians(full_name,email,phone,whatsapp_phone,language,notify_email,notify_whatsapp)" },
  { key: "scores", table: "score_entries", select: "term_id,subject_id,component_id,score,updated_at" },
  { key: "report_cards", table: "report_cards", select: "term_id,status,average,position,class_size,teacher_comment,principal_comment,published_at,data" },
  { key: "class_attendance", table: "class_attendance", select: "date,status,reason,marked_at" },
  { key: "gate_events", table: "gate_events", select: "direction,method,late,at,note" },
  { key: "behaviour", table: "behaviour_records", select: "kind,points,note,occurred_at" },
  { key: "traits", table: "trait_ratings", select: "term_id,trait_id,rating" },
  { key: "interventions", table: "student_interventions", select: "reason,plan,status,review_on,outcome,created_at" },
  { key: "medical_profile", table: "medical_profiles", select: "blood_group,genotype,allergies,conditions,medications,dietary,emergency_contact,doctor,updated_at" },
  { key: "sickbay_visits", table: "sickbay_visits", select: "complaint,temperature,treatment,outcome,parent_notified,at" },
  { key: "homework_submissions", table: "homework_submissions", select: "homework_id,submitted_at,late,score,feedback" },
  { key: "invoices", table: "fee_invoices", select: "invoice_no,title,status,total,amount_paid,due_date,created_at,fee_invoice_lines(description,amount,kind)" },
  { key: "payments", table: "fee_payments", select: "amount,currency,method,status,receipt_no,paid_at" },
  { key: "wallet", table: "wallets", select: "balance,daily_limit,low_balance_alert,frozen,updated_at" },
  { key: "wallet_transactions", table: "wallet_transactions", select: "kind,amount,balance_after,status,description,items,created_at" },
  { key: "library_loans", table: "library_loans", select: "issued_at,due_at,returned_at,fine_amount,library_books(title)" },
  { key: "transport", table: "transport_assignments", select: "stop_name,direction,transport_routes(name)" },
  { key: "transport_events", table: "transport_events", select: "kind,stop_name,at" },
  { key: "boarding", table: "hostel_allocations", select: "bed_label,allocated_at,ended_at,hostel_rooms(name,hostels(name))" },
  { key: "exeats", table: "exeat_requests", select: "reason,leave_at,return_by,status,created_at" },
  { key: "pickups", table: "pickup_codes", select: "delegate_name,status,expires_at,created_at,used_at" },
  { key: "conversations", table: "conversations", select: "subject,status,created_at,conversation_messages(sender_kind,sender_name,body,created_at)" }
];

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const ctx = await requireCtx(ROLES.sims, "sims");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const { data: student } = await ctx.sb.from("students").select("*,class_groups(name)").eq("tenant_id", tid).eq("id", id).maybeSingle();
  if (!student) return jsonError("student not found", 404);
  const out: Record<string, unknown> = {
    exported_at: new Date().toISOString(), school: ctx.tenant.name, exported_by: ctx.profile.full_name, student
  };
  const results = await Promise.all(TABLES.map(t => ctx.sb.from(t.table).select(t.select).eq("tenant_id", tid).eq(t.by ?? "student_id", id).limit(10000)));
  TABLES.forEach((t, i) => { out[t.key] = results[i].error ? { unavailable: results[i].error.message } : results[i].data ?? []; });
  await ctx.sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "student.data_exported", target: id });
  const name = `${student.admission_no ?? "student"}-data-${new Date().toISOString().slice(0, 10)}.json`.replace(/[^\w.-]/g, "_");
  return new NextResponse(JSON.stringify(out, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" }
  });
}
