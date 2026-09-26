import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";

/** Staff: own slots (or everyone's for admins) with bookings. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "meetings");
  if (ctx instanceof NextResponse) return ctx;
  const all = new URL(req.url).searchParams.get("all") === "1" && hasAny(ctx, ROLES.admin);
  let q = ctx.sb.from("consultation_slots").select("*,guardians(full_name,phone,email),students(first_name,last_name,other_names,class_groups(name)),users!consultation_slots_staff_user_id_fkey(full_name)")
    .eq("tenant_id", ctx.tenant.id).gte("starts_at", new Date(Date.now() - 86400_000).toISOString()).order("starts_at").limit(500);
  if (!all) q = q.eq("staff_user_id", ctx.userId);
  const { data, error } = await q;
  return error ? jsonError(error.message) : NextResponse.json(data ?? []);
}

const Body = z.discriminatedUnion("action", [
  // Publish a run of slots, e.g. 16:00–18:00 in 10-minute blocks.
  z.object({ action: z.literal("create_slots"), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), from: z.string().regex(/^\d{2}:\d{2}$/), to: z.string().regex(/^\d{2}:\d{2}$/),
    minutes: z.number().int().min(5).max(120), location: z.string().trim().max(200).nullish(), tz_offset_minutes: z.number().int().min(-840).max(840) }),
  z.object({ action: z.literal("delete_slot"), id: z.string().uuid() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "meetings");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  if (b.action === "delete_slot") {
    const { error } = await ctx.sb.from("consultation_slots").delete().eq("tenant_id", ctx.tenant.id).eq("id", b.id).eq("staff_user_id", ctx.userId).is("guardian_id", null);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  // Times are entered in the teacher's browser time; the offset converts them to UTC.
  const toUtc = (hhmm: string) => new Date(Date.parse(`${b.date}T${hhmm}:00Z`) + b.tz_offset_minutes * 60_000);
  const start = toUtc(b.from), end = toUtc(b.to);
  if (end <= start) return jsonError("end time must be after start time");
  const rows = [];
  for (let t = start.getTime(); t + b.minutes * 60_000 <= end.getTime(); t += b.minutes * 60_000) {
    rows.push({ tenant_id: ctx.tenant.id, staff_user_id: ctx.userId, starts_at: new Date(t).toISOString(), ends_at: new Date(t + b.minutes * 60_000).toISOString(), location: b.location ?? null });
  }
  if (!rows.length || rows.length > 60) return jsonError("choose a range that makes between 1 and 60 slots");
  const { error } = await ctx.sb.from("consultation_slots").insert(rows);
  return error ? jsonError(error.message) : NextResponse.json({ created: rows.length }, { status: 201 });
}
