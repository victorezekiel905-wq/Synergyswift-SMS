import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { clientIp } from "@/lib/net";
import { codeInfo, codeTriesExceeded, recordCodeTry, signUpWithCode, policyFor } from "@/lib/sign-up-codes-server";
import { passwordsMatch } from "@/lib/sign-up-codes";
import { passwordRulesText } from "@/lib/security";

export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("check"), code: z.string().trim().min(4).max(20) }),
  z.object({ action: z.literal("claim"), code: z.string().trim().min(4).max(20), email: z.string().trim().max(254), full_name: z.string().trim().max(120).nullish(),
    password: z.string().max(128), password2: z.string().max(128) })
]);

const KIND_WORDS = { staff: "staff", student: "student", guardian: "parent", parent_link: "parent" } as const;

/**
 * Making an account with a sign-up code (no sign-in needed).
 *   check: what the code is for (school, first name, role) so the person knows it's theirs.
 *   claim: email + password (typed twice) → the account, with the role the school chose.
 * Wrong codes are counted per address and per code.
 */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("Type the code from your school.");
  const b = parsed.data;
  const svc = createServiceClient();
  const ip = clientIp(req.headers) ?? "unknown";
  if (await codeTriesExceeded(svc, ip, b.code)) return jsonError("Too many tries. Wait 15 minutes, then check the code with your school.", 429);

  const info = await codeInfo(svc, b.code).catch(() => null);
  if (!info) {
    await recordCodeTry(svc, ip, b.code).catch(() => {});
    return jsonError("That code is not right, or it has been used. Check it, or ask the school for a new one.", 404);
  }
  if (b.action === "check") {
    return NextResponse.json({
      kind: info.kind, as: KIND_WORDS[info.kind], school: info.school, name: info.name, child: info.childName, role: info.role,
      rules: passwordRulesText(await policyFor(svc, info.tenantId)), needs_name: info.kind === "parent_link"
    });
  }
  const mismatch = passwordsMatch(b.password, b.password2);
  if (mismatch) return jsonError(mismatch);
  if (info.kind === "parent_link" && !b.full_name?.trim()) return jsonError("Type your full name.");
  const r = await signUpWithCode(svc, { code: b.code, email: b.email, password: b.password, fullName: b.full_name ?? null });
  if (!r.ok) return jsonError(r.error, r.status);
  return NextResponse.json(r);
}
