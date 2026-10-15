import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

const COLS = "chronic_absence_pct,school_weekdays,lesson_absence_alerts,student_start_time,staff_start_time";

export async function GET() {
  const ctx = await requireCtx(ROLES.staff, "attendance");
  if (ctx instanceof NextResponse) return ctx;
  const { data } = await createServiceClient().from("tenant_settings").select(COLS).eq("tenant_id", ctx.tenant.id).maybeSingle();
  return NextResponse.json({ chronic_absence_pct: 90, school_weekdays: [1, 2, 3, 4, 5], lesson_absence_alerts: true, student_start_time: "07:45", staff_start_time: "08:00", ...(data ?? {}) });
}

const time = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/);
const Body = z.object({ chronic_absence_pct: z.number().int().min(50).max(100), school_weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  lesson_absence_alerts: z.boolean(), student_start_time: time, staff_start_time: time });

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin, "attendance");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const { error } = await createServiceClient().from("tenant_settings").upsert({ tenant_id: ctx.tenant.id, ...b, school_weekdays: [...new Set(b.school_weekdays)].sort() }, { onConflict: "tenant_id" });
  return error ? jsonError(error.message) : NextResponse.json({ ok: true });
}
