import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { clientIp } from "@/lib/net";
import { codeTriesExceeded, recordCodeTry } from "@/lib/sign-up-codes-server";
import { cleanCode, isCodeShape } from "@/lib/sign-up-codes";

export const dynamic = "force-dynamic";

const Body = z.object({ code: z.string().trim().min(4).max(20) });

/** A signed-in parent adds a child with the child's parent code from the school (migration 9600). */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(["parent"]);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("Type your child's parent code.");
  const svc = createServiceClient();
  const ip = clientIp(req.headers) ?? "unknown";
  if (await codeTriesExceeded(svc, ip, parsed.data.code)) return jsonError("Too many tries. Wait 15 minutes, then check the code with the school.", 429);
  if (!isCodeShape(parsed.data.code)) {
    await recordCodeTry(svc, ip, parsed.data.code).catch(() => {});
    return jsonError("A parent code has 8 letters and numbers, like ABCD-EFGH.");
  }
  const { data, error } = await svc.rpc("link_child_with_code", { p_code: cleanCode(parsed.data.code), p_user: ctx.userId });
  if (error) {
    await recordCodeTry(svc, ip, parsed.data.code).catch(() => {});
    return jsonError(error.message.includes("does not exist") ? "Adding children needs the database update (migration 20260101009600)." : error.message);
  }
  return NextResponse.json({ ok: true, already: Boolean(data?.already), name: data?.name ?? null, student_id: data?.student_id ?? null });
}
