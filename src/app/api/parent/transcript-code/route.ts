import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { clientIp } from "@/lib/net";
import { codeTriesExceeded, recordCodeTry } from "@/lib/sign-up-codes-server";
import { isCodeShape, cleanCode } from "@/lib/sign-up-codes";
import { parentHasTranscript, transcriptNeedsUpdate } from "@/lib/onboarding-codes-server";

export const dynamic = "force-dynamic";

/** Whether this parent has opened this child's transcript (?student=). */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(["parent"]);
  if (ctx instanceof NextResponse) return ctx;
  const sid = new URL(req.url).searchParams.get("student") ?? "";
  // RLS: only the parent's own children are found.
  const { data: child } = await ctx.sb.from("students").select("id").eq("tenant_id", ctx.tenant.id).eq("id", sid).maybeSingle();
  if (!child) return jsonError("not found", 404);
  return NextResponse.json({ unlocked: await parentHasTranscript(createServiceClient(), { tenantId: ctx.tenant.id, studentId: child.id, userId: ctx.userId }) });
}

const Body = z.object({ code: z.string().trim().min(4).max(20) });

/** A parent types the transcript code the school gave them for a child (migration 10100). */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(["parent"]);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("Type the transcript code from the school.");
  const svc = createServiceClient();
  const ip = clientIp(req.headers) ?? "unknown";
  // Wrong guesses are slowed down, the same as sign-up codes.
  if (await codeTriesExceeded(svc, ip, parsed.data.code)) return jsonError("Too many tries. Wait 15 minutes, then check the code with the school.", 429);
  if (!isCodeShape(parsed.data.code)) {
    await recordCodeTry(svc, ip, parsed.data.code).catch(() => {});
    return jsonError("A transcript code has 8 letters and numbers, like ABCD-EFGH.");
  }
  const { data, error } = await svc.rpc("unlock_transcript", { p_code: cleanCode(parsed.data.code), p_user: ctx.userId });
  if (error) {
    await recordCodeTry(svc, ip, parsed.data.code).catch(() => {});
    return jsonError(transcriptNeedsUpdate(error.message) ? "Transcript codes need the database update (migration 20260101010100)." : error.message);
  }
  return NextResponse.json({ ok: true, student_id: data?.student_id ?? null, name: data?.name ?? null, already: Boolean(data?.already) });
}
