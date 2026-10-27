import { NextRequest, NextResponse } from "next/server";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { beginRequest } from "@/lib/request-actor";
import { readJson, jsonError } from "@/lib/auth";
import { checkPassword, passwordRulesText, passwordDaysLeft, tokenClaims, type PasswordPolicy } from "@/lib/security";

/**
 * Password changes go through the server so the school's password rules
 * apply and the password clock restarts. Works while a password has expired
 * (the rest of the app is locked until then).
 */
async function who() {
  const store = beginRequest();
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  store.actor = `user:${user.id}`;
  const { data: { session } } = await sb.auth.getSession();
  const svc = createServiceClient();
  const { data: profile } = await svc.from("users").select("id,tenant_id,full_name,role,password_changed_at").eq("id", user.id).maybeSingle();
  const { data: s } = profile ? await svc.from("tenant_settings")
    .select("password_min_length,password_require_mixed_case,password_require_number,password_require_symbol,password_max_age_days,password_policy_scope")
    .eq("tenant_id", profile.tenant_id).maybeSingle() : { data: null };
  const staff = profile ? !["student", "parent", "alumni"].includes(profile.role) : false;
  const policy: Partial<PasswordPolicy> = s ? {
    min_length: s.password_min_length, require_mixed_case: s.password_require_mixed_case, require_number: s.password_require_number,
    require_symbol: s.password_require_symbol, max_age_days: staff || s.password_policy_scope === "all" ? s.password_max_age_days : 0
  } : {};
  return { user, session, svc, profile, policy };
}

export async function GET() {
  const w = await who();
  if (!w) return jsonError("unauthenticated", 401);
  const methods = (tokenClaims(w.session?.access_token).amr ?? []).map(a => a.method);
  return NextResponse.json({
    rules: passwordRulesText(w.policy), policy: w.policy,
    days_left: passwordDaysLeft(w.profile?.password_changed_at ?? null, w.policy.max_age_days ?? 0),
    needs_current: methods.includes("password")
  });
}

export async function POST(req: NextRequest) {
  const w = await who();
  if (!w) return jsonError("unauthenticated", 401);
  const b = await readJson<{ password?: string; current_password?: string; sign_out_others?: boolean }>(req);
  const pw = String(b.password ?? "");
  const problems = checkPassword(pw, w.policy, { email: w.user.email, name: w.profile?.full_name });
  if (problems.length) return jsonError(`Please ${problems.join(", ")}.`);
  // Someone who signed in with a password must prove they know it. Invitation,
  // reset, phone-code and single-sign-on sessions set a password without one.
  const methods = (tokenClaims(w.session?.access_token).amr ?? []).map(a => a.method);
  if (methods.includes("password")) {
    if (!b.current_password) return jsonError("enter your current password");
    if (b.current_password === pw) return jsonError("choose a password different from your current one");
    const plain = createPlainClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: check, error } = await plain.auth.signInWithPassword({ email: w.user.email!, password: b.current_password });
    if (error) return jsonError("your current password is not right", 403);
    if (check.session) await plain.auth.signOut();     // the check's own session is not kept
  }
  const { error } = await w.svc.auth.admin.updateUserById(w.user.id, { password: pw });
  if (error) return jsonError(error.message);
  if (w.profile) {
    await w.svc.from("users").update({ password_changed_at: new Date().toISOString(), must_change_password: false }).eq("id", w.user.id);
    await w.svc.from("audit_logs").insert({ tenant_id: w.profile.tenant_id, actor_id: w.user.id, action: "account.password_changed" });
  }
  if (b.sign_out_others) {
    const sb = await createClient();
    await sb.rpc("end_my_sessions", { p_session: null, p_others: true });
  }
  return NextResponse.json({ ok: true });
}
