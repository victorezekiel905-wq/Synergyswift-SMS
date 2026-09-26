import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { jsonError, readJson } from "@/lib/auth";
import { startOnlinePayment, financeSettings } from "@/lib/fees";
import { providerConfigured } from "@/lib/payments";
import { appUrl, studentName } from "@/lib/school";

export const dynamic = "force-dynamic";

/** Public invoice behind the private pay link sent to parents. */
export async function GET(_req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  if (!/^[0-9a-f]{32,128}$/i.test(token)) return jsonError("not found", 404);
  const svc = createServiceClient();
  const { data: inv } = await svc.from("fee_invoices")
    .select("id,tenant_id,invoice_no,title,status,total,amount_paid,due_date,created_at,notes,tenants(status,name),students(first_name,last_name,other_names,admission_no,class_groups(name)),fee_invoice_lines(kind,description,amount),fee_payments(amount,method,status,receipt_no,paid_at,reference)")
    .eq("pay_token", token).maybeSingle();
  if (!inv || inv.tenants?.status !== "active") return jsonError("This payment link is not valid.", 404);
  const s = await financeSettings(svc, inv.tenant_id);
  const { data: school } = await svc.from("tenant_settings").select("school_name,logo_url,address,phone,email,brand_color").eq("tenant_id", inv.tenant_id).maybeSingle();
  return NextResponse.json({
    school: { name: school?.school_name ?? inv.tenants?.name, logo_url: school?.logo_url, address: school?.address, phone: school?.phone, email: school?.email, brand_color: school?.brand_color },
    invoice: {
      invoice_no: inv.invoice_no, title: inv.title, status: inv.status, total: Number(inv.total), amount_paid: Number(inv.amount_paid),
      balance: Math.max(0, Number(inv.total) - Number(inv.amount_paid)), due_date: inv.due_date, created_at: inv.created_at,
      student: { name: studentName(inv.students), admission_no: inv.students?.admission_no, class_name: inv.students?.class_groups?.name ?? null },
      lines: inv.fee_invoice_lines ?? [],
      payments: (inv.fee_payments ?? []).filter((p: any) => p.status === "success")
    },
    currency: s.currency, bank_details: s.bankDetails, online: providerConfigured(s.provider), provider: s.provider
  }, { headers: { "Cache-Control": "no-store" } });
}

const Body = z.object({ amount: z.number().positive().max(1e10).nullish(), email: z.string().trim().email().nullish() });

/** Start an online payment; returns the provider checkout URL. */
export async function POST(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  if (!/^[0-9a-f]{32,128}$/i.test(token)) return jsonError("not found", 404);
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("enter a valid amount and email");
  try {
    const r = await startOnlinePayment(createServiceClient(), { payToken: token, amount: parsed.data.amount, email: parsed.data.email, baseUrl: appUrl(req) });
    return NextResponse.json(r);
  } catch (e) {
    return jsonError((e as Error).message);
  }
}
