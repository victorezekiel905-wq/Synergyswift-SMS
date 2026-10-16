import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { localParts } from "@/lib/attendance";
import { expiringDocuments } from "@/lib/boarding";

export const dynamic = "force-dynamic";

/** Vehicles and drivers, with documents expiring in the next 30 days (or already expired). */
export async function GET() {
  const ctx = await requireCtx(ROLES.staff, "transport");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const [{ data: vehicles }, { data: drivers }, { data: routes }, { data: staff }] = await Promise.all([
    ctx.sb.from("vehicles").select("*").eq("tenant_id", tid).order("reg_no"),
    ctx.sb.from("drivers").select("*").eq("tenant_id", tid).order("full_name"),
    ctx.sb.from("transport_routes").select("id,name,vehicle_id,driver_id").eq("tenant_id", tid),
    ctx.sb.from("staff").select("id,full_name").eq("tenant_id", tid).neq("status", "exited").order("full_name")
  ]);
  const today = localParts(new Date(), ctx.tenant.timezone).date;
  return NextResponse.json({ vehicles: vehicles ?? [], drivers: drivers ?? [], routes: routes ?? [], staff: staff ?? [], can_edit: hasAny(ctx, ROLES.transport),
    expiring: expiringDocuments(today, 30, vehicles ?? [], drivers ?? []) });
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal("")).transform(v => v || null);
const opt = (n: number) => z.string().trim().max(n).nullish().transform(v => v || null);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_vehicle"), id: z.string().uuid().optional(), reg_no: z.string().trim().min(2).max(20).transform(s => s.toUpperCase()), make_model: opt(80),
    seats: z.number().int().min(1).max(200).nullish(), insurance_expires: date, roadworthy_expires: date, licence_expires: date, last_service_on: date, next_service_on: date,
    odometer_km: z.number().int().min(0).max(5_000_000).nullish(), status: z.enum(["active", "repair", "retired"]).default("active"), notes: opt(500) }),
  z.object({ action: z.literal("save_driver"), id: z.string().uuid().optional(), full_name: z.string().trim().min(2).max(120), phone: opt(30), staff_id: z.string().uuid().nullish(),
    licence_no: opt(40), licence_class: opt(20), licence_expires: date, medical_expires: date, background_check_on: date, active: z.boolean().default(true) }),
  z.object({ action: z.literal("link"), route_id: z.string().uuid(), vehicle_id: z.string().uuid().nullable(), driver_id: z.string().uuid().nullable() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.transport, "transport");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id, sb = ctx.sb;
  switch (b.action) {
    case "save_vehicle": {
      const { action: _a, id, ...row } = b;
      const { error } = id ? await sb.from("vehicles").update(row).eq("tenant_id", tid).eq("id", id) : await sb.from("vehicles").insert({ ...row, tenant_id: tid });
      return error ? jsonError(error.message.includes("duplicate") ? "a vehicle with that registration exists" : error.message) : NextResponse.json({ ok: true });
    }
    case "save_driver": {
      const { action: _a, id, ...row } = b;
      const { error } = id ? await sb.from("drivers").update({ ...row, staff_id: row.staff_id ?? null }).eq("tenant_id", tid).eq("id", id) : await sb.from("drivers").insert({ ...row, staff_id: row.staff_id ?? null, tenant_id: tid });
      return error ? jsonError(error.message) : NextResponse.json({ ok: true });
    }
    case "link": {
      // Keep the route's display fields in step so parents and older screens see the same bus and driver.
      const [{ data: v }, { data: d }] = await Promise.all([
        b.vehicle_id ? sb.from("vehicles").select("reg_no,make_model,seats").eq("tenant_id", tid).eq("id", b.vehicle_id).maybeSingle() : Promise.resolve({ data: null }),
        b.driver_id ? sb.from("drivers").select("full_name,phone").eq("tenant_id", tid).eq("id", b.driver_id).maybeSingle() : Promise.resolve({ data: null })
      ]);
      const patch: Record<string, unknown> = { vehicle_id: b.vehicle_id, driver_id: b.driver_id };
      if (v) Object.assign(patch, { vehicle: [v.reg_no, v.make_model].filter(Boolean).join(" "), ...(v.seats ? { capacity: v.seats } : {}) });
      if (d) Object.assign(patch, { driver_name: d.full_name, driver_phone: d.phone });
      const { error } = await sb.from("transport_routes").update(patch).eq("tenant_id", tid).eq("id", b.route_id);
      return error ? jsonError(error.message) : NextResponse.json({ ok: true });
    }
  }
}
