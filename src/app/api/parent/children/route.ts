import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, readJson, jsonError } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { clientIp } from "@/lib/net";
import { codeTriesExceeded, recordCodeTry, joinSchoolWithChildCode } from "@/lib/sign-up-codes-server";
import { cleanCode, isCodeShape } from "@/lib/sign-up-codes";

export const dynamic = "force-dynamic";

const Body = z.object({ code: z.string().trim().min(4).max(20) });

/**
 * A signed-in parent adds a child with the child's code from the school (migration 9600).
 * A parent who signed up on their own has no school yet: their first child's code joins
 * them to that child's school. Either way a parent only ever reaches children they added
 * with a code (or that the school linked to them).
 */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("Type your child's code.");
  const svc = createServiceClient();
  const ip = clientIp(req.headers) ?? "unknown";

  // Signed up on their own, no school yet?
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return jsonError("unauthenticated", 401);
  const { data: profile } = await svc.from("users").select("id").eq("id", user.id).maybeSingle();
  if (!profile) {
    if ((user.user_metadata as { signup_as?: string } | null)?.signup_as !== "parent" || !user.email) return jsonError("Only parents add children with a child's code.", 403);
    if (await codeTriesExceeded(svc, ip, parsed.data.code)) return jsonError("Too many tries. Wait 15 minutes, then check the code with the school.", 429);
    const r = await joinSchoolWithChildCode(svc, { code: parsed.data.code, userId: user.id, email: user.email, fullName: String(user.user_metadata?.full_name ?? "").trim() || null });
    if (!r.ok) {
      if (r.miss) await recordCodeTry(svc, ip, parsed.data.code).catch(() => {});
      return jsonError(r.error, r.status);
    }
    return NextResponse.json({ ok: true, already: false, name: r.childName, student_id: r.studentId, school: r.school, joined: true });
  }

  const ctx = await requireCtx(["parent"]);
  if (ctx instanceof NextResponse) return ctx;
  if (await codeTriesExceeded(svc, ip, parsed.data.code)) return jsonError("Too many tries. Wait 15 minutes, then check the code with the school.", 429);
  if (!isCodeShape(parsed.data.code)) {
    await recordCodeTry(svc, ip, parsed.data.code).catch(() => {});
    return jsonError("A child's code has 8 letters and numbers, like ABCD-EFGH.");
  }
  const { data, error } = await svc.rpc("link_child_with_code", { p_code: cleanCode(parsed.data.code), p_user: ctx.userId });
  if (error) {
    await recordCodeTry(svc, ip, parsed.data.code).catch(() => {});
    return jsonError(error.message.includes("does not exist") ? "Adding children needs the database update (migration 20260101009600)." : error.message);
  }
  return NextResponse.json({ ok: true, already: Boolean(data?.already), name: data?.name ?? null, student_id: data?.student_id ?? null });
}
