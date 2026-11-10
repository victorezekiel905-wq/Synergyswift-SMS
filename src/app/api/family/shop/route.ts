import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJson, jsonError, sessionIdentity } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { identifyGuardian, guardianHasChild } from "@/lib/guardian";
import { financeSettings } from "@/lib/fees";
import { appUrl } from "@/lib/school";
import { studentShop, makeBuyCode, sendCodeToTeacher, ShopError } from "@/lib/tuck-shop-server";

export const dynamic = "force-dynamic";

/** A parent's view of each child's tuck shop: buys left, the live code, spending by category and day, what happened. */
export async function GET(req: NextRequest) {
  const svc = createServiceClient();
  const who = await identifyGuardian(svc, new URL(req.url).searchParams.get("token"), sessionIdentity);
  if ("error" in who) return jsonError(who.error, who.status);
  try {
    const { data: kids } = await svc.from("student_guardians").select("student_id,students(first_name,last_name,status)").eq("tenant_id", who.tenantId).eq("guardian_id", who.guardianId);
    const active = (kids ?? []).filter((k: any) => k.students?.status === "active");
    const { currency } = await financeSettings(svc, who.tenantId);
    const children = await Promise.all(active.map(async (k: any) => ({ student_id: k.student_id, name: `${k.students.first_name} ${k.students.last_name}`, ...(await studentShop(svc, who.tenantId, k.student_id)) })));
    return NextResponse.json({ currency, timezone: who.timezone, children }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return jsonError((e as Error).message, e instanceof ShopError ? e.status : 400); }
}

const Body = z.object({ token: z.string().optional(), student_id: z.string().uuid(), send_to_teacher: z.boolean().default(false) });

/** A parent makes their child's buy code, and can send it to the class teacher to hand over. */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("choose your child");
  const b = parsed.data;
  const svc = createServiceClient();
  const who = await identifyGuardian(svc, b.token, sessionIdentity);
  if ("error" in who) return jsonError(who.error, who.status);
  if (!(await guardianHasChild(svc, who.tenantId, who.guardianId, b.student_id))) return jsonError("you are not linked to this student", 403);
  try {
    const { data: s } = await svc.from("students").select("first_name").eq("id", b.student_id).maybeSingle();
    const r = await makeBuyCode(svc, { tenantId: who.tenantId, studentId: b.student_id, by: (await svc.from("guardians").select("user_id").eq("id", who.guardianId).maybeSingle()).data?.user_id ?? null,
      as: "parent", timeZone: who.timezone, name: s?.first_name });
    if (!r.ok) return NextResponse.json({ error: r.error, status: r.status }, { status: 409 });
    let sent: { to: string } | null = null;
    if (b.send_to_teacher) {
      sent = await sendCodeToTeacher(svc, { tenantId: who.tenantId, guardianId: who.guardianId, guardianName: who.name ?? "Parent", studentId: b.student_id,
        code: r.code, expires: r.expires, timeZone: who.timezone, baseUrl: appUrl(req) });
    }
    return NextResponse.json({ ...r, sent });
  } catch (e) { return jsonError((e as Error).message, e instanceof ShopError ? e.status : 400); }
}
