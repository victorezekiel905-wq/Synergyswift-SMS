import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { createPinBatch } from "@/lib/result-pins-server";
import { appUrl } from "@/lib/school";

export const dynamic = "force-dynamic";
const WHO = ["school_admin", "principal", "platform_admin", "bursar", "exam_officer"];

/** Result-checker PIN batches with how much they are used (phase 14l). ?serial= looks one card up. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(WHO, "results");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const serial = new URL(req.url).searchParams.get("serial");
  const { data: slugRow } = await ctx.sb.from("tenants").select("slug").eq("id", tid).maybeSingle();
  const checker = slugRow?.slug ? `${appUrl(req)}/results/check/${slugRow.slug}` : null;
  if (serial) {
    const { data } = await ctx.sb.from("result_pins").select("serial,uses,status,first_used_at,last_used_at,students(first_name,last_name,admission_no),result_pin_batches(name,max_uses)")
      .eq("tenant_id", tid).ilike("serial", serial.trim()).maybeSingle();
    return NextResponse.json({ pin: data ?? null, checker });
  }
  const { data: batches, error } = await ctx.sb.from("result_pin_batches").select("id,name,max_uses,price,pins,expires_on,created_at,terms(name)").eq("tenant_id", tid).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ batches: [], checker, ready: false });
  const ids = (batches ?? []).map((b: any) => b.id);
  const { data: used } = ids.length ? await ctx.sb.from("result_pins").select("batch_id,uses,status").in("batch_id", ids).gt("uses", 0).limit(50000) : { data: [] };
  return NextResponse.json({ ready: true, checker, batches: (batches ?? []).map((b: any) => {
    const u = (used ?? []).filter((p: any) => p.batch_id === b.id);
    return { ...b, term: b.terms?.name ?? null, terms: undefined, used_pins: u.length, checks: u.reduce((t: number, p: any) => t + p.uses, 0) };
  }) });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), name: z.string().trim().min(2).max(80), term_id: z.string().uuid().nullish(), max_uses: z.number().int().min(1).max(50),
    price: z.number().min(0).max(1e7), count: z.number().int().min(1).max(5000), expires_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish() }),
  z.object({ action: z.literal("void"), serial: z.string().trim().min(3).max(40) })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(WHO, "results");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const svc = createServiceClient();
  const tid = ctx.tenant.id;
  if (b.action === "void") {
    const { data, error } = await svc.from("result_pins").update({ status: "void" }).eq("tenant_id", tid).ilike("serial", b.serial).select("id");
    if (error) return jsonError(error.message);
    if (!data?.length) return jsonError("no card has that serial number", 404);
    await svc.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "results.pin_voided", meta: { serial: b.serial } });
    return NextResponse.json({ ok: true });
  }
  try {
    const r = await createPinBatch(svc, { tenantId: tid, schoolName: ctx.tenant.name, name: b.name, termId: b.term_id ?? null, maxUses: b.max_uses, price: b.price, count: b.count, expiresOn: b.expires_on ?? null, actor: ctx.userId });
    await svc.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "results.pins_created", meta: { batch_id: r.batchId, count: b.count } });
    return NextResponse.json(r);
  } catch (e) {
    return jsonError((e as Error).message);
  }
}
