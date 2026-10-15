import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireCtx, ROLES, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { readUpload } from "@/lib/files";
import { localParts } from "@/lib/attendance";

export const dynamic = "force-dynamic";

const RECEIPT = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/**
 * Spending from a petty cash float (the custodian or the bursary), with an optional photo or PDF of the receipt.
 * The spend is an expense paid from the float; the database checks who may spend and that the float has the money.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "fees");
  if (ctx instanceof NextResponse) return ctx;
  const form = await req.formData().catch(() => null);
  if (!form) return jsonError("invalid form");
  const floatId = String(form.get("float_id") ?? ""), amount = Number(form.get("amount"));
  const category = String(form.get("category") ?? "").trim(), description = String(form.get("description") ?? "").trim();
  const onDate = String(form.get("on_date") ?? "") || localParts(new Date(), ctx.tenant.timezone).date;
  if (!/^[0-9a-f-]{36}$/i.test(floatId)) return jsonError("choose a float");
  if (!(amount > 0 && amount <= 1e10)) return jsonError("enter an amount");
  if (!category || !description) return jsonError("say what the money was spent on");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(onDate)) return jsonError("enter the date");

  // Check the float before storing anything.
  const { data: f } = await ctx.sb.from("petty_cash_floats").select("id").eq("tenant_id", ctx.tenant.id).eq("id", floatId).maybeSingle();
  if (!f) return jsonError("petty cash float not found", 404);

  const svc = createServiceClient();
  let path: string | null = null;
  const file = form.get("receipt");
  if (file instanceof File && file.size > 0) {
    const r = await readUpload(file, RECEIPT, 5);
    if (!r.ok) return jsonError(r.error, r.status);
    path = `${ctx.tenant.id}/${onDate.slice(0, 7)}/${randomUUID()}.${r.ext}`;
    const up = await svc.storage.from("expense-receipts").upload(path, r.buf, { contentType: r.type, upsert: false });
    if (up.error) return jsonError("could not store the receipt; try again");
  }
  const { data, error } = await ctx.sb.rpc("petty_cash_spend", {
    p_float: floatId, p_amount: Math.round(amount * 100) / 100, p_category: category.slice(0, 60), p_description: description.slice(0, 200),
    p_payee: String(form.get("payee") ?? "").trim().slice(0, 120) || null, p_on: onDate, p_receipt: path
  });
  if (error) {
    if (path) await svc.storage.from("expense-receipts").remove([path]);
    return jsonError(error.message);
  }
  return NextResponse.json({ expense_id: data }, { status: 201 });
}
