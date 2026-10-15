import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { jsonError } from "@/lib/auth";
import { submitClaim } from "@/lib/fees-plus";
import { readUpload } from "@/lib/files";

export const dynamic = "force-dynamic";

const PROOF = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** A parent reports a bank transfer (amount, date, bank reference and optionally a screenshot or PDF of the receipt). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{32,128}$/i.test(token)) return jsonError("not found", 404);
  const form = await req.formData().catch(() => null);
  if (!form) return jsonError("invalid form");
  const amount = Number(form.get("amount")), paidOn = String(form.get("paid_on") ?? ""), ref = String(form.get("reference") ?? "").trim();
  if (!(amount > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(paidOn) || ref.length < 3) return jsonError("enter the amount, the date you paid and the bank reference");
  if (paidOn > new Date(Date.now() + 86400_000).toISOString().slice(0, 10)) return jsonError("that date is in the future");
  let proof = null;
  const file = form.get("proof");
  if (file instanceof File && file.size > 0) {
    const r = await readUpload(file, PROOF, 5);
    if (!r.ok) return jsonError(r.error, r.status);
    proof = { buf: r.buf, ext: r.ext, type: r.type };
  }
  try {
    const r = await submitClaim(createServiceClient(), { payToken: token, amount: Math.round(amount * 100) / 100, paidOn, bankReference: ref.slice(0, 80),
      payerName: String(form.get("payer_name") ?? "").trim().slice(0, 120) || null, proof });
    return NextResponse.json({ ok: true, ...r }, { status: 201 });
  } catch (e) {
    return jsonError((e as Error).message);
  }
}
