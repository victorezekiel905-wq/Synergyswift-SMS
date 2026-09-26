import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJson, jsonError, sessionIdentity } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { identifyGuardian } from "@/lib/guardian";
import { guardianInbox, postMessage, startFromGuardian, teachersOfStudent, MessagingError } from "@/lib/conversations";
import { appUrl, studentName } from "@/lib/school";

export const dynamic = "force-dynamic";

/** Parent side of messaging, for the signed-in portal and the private link (?token=). */
export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const svc = createServiceClient();
  const who = await identifyGuardian(svc, u.searchParams.get("token"), sessionIdentity);
  if ("error" in who) return jsonError(who.error, who.status);
  const inbox = await guardianInbox(svc, who.tenantId, who.guardianId, u.searchParams.get("c"));
  // Who the parent can write to, per child.
  const { data: kids } = await svc.from("student_guardians").select("students(id,first_name,last_name,other_names,status)").eq("tenant_id", who.tenantId).eq("guardian_id", who.guardianId);
  const children = await Promise.all((kids ?? []).filter((k: any) => k.students?.status === "active").map(async (k: any) => ({
    id: k.students.id, name: studentName(k.students), teachers: await teachersOfStudent(svc, who.tenantId, k.students.id)
  })));
  return NextResponse.json({ ...inbox, children }, { headers: { "Cache-Control": "no-store" } });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), token: z.string().optional(), student_id: z.string().uuid(), staff_user_id: z.string().uuid().nullable(),
    subject: z.string().trim().min(2).max(160), body: z.string().trim().min(1).max(4000) }),
  z.object({ action: z.literal("reply"), token: z.string().optional(), conversation_id: z.string().uuid(), body: z.string().trim().min(1).max(4000) })
]);

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const svc = createServiceClient();
  const who = await identifyGuardian(svc, b.token, sessionIdentity);
  if ("error" in who) return jsonError(who.error, who.status);
  try {
    if (b.action === "start") {
      const r = await startFromGuardian(svc, { tenantId: who.tenantId, guardianId: who.guardianId, guardianName: who.name, studentId: b.student_id,
        staffUserId: b.staff_user_id, subject: b.subject, body: b.body, baseUrl: appUrl(req) });
      return NextResponse.json(r, { status: 201 });
    }
    return NextResponse.json(await postMessage(svc, { tenantId: who.tenantId, conversationId: b.conversation_id,
      sender: { kind: "guardian", guardianId: who.guardianId, name: who.name }, body: b.body, baseUrl: appUrl(req) }));
  } catch (e) {
    if (e instanceof MessagingError) return jsonError(e.message, e.status);
    return jsonError((e as Error).message);
  }
}
