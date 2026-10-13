import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { clientIp, ipAllowed, isValidIpRule } from "@/lib/net";
import { clearAccessCache, deviceHash, DEVICE_COOKIE } from "@/lib/access";
import { cleanDomains, decideAccess, deviceLabel, restrictionApplies, signedInWithSso, tokenClaims, type AccessMode, type DeviceStatus } from "@/lib/security";
import { smsConfigured } from "@/lib/messaging/providers";

export const dynamic = "force-dynamic";

const COLS = "require_mfa,password_min_length,password_require_mixed_case,password_require_number,password_require_symbol,password_max_age_days,password_policy_scope," +
  "session_idle_minutes,session_max_hours,staff_access_mode,staff_access_roles,staff_ip_allowlist,sso_policy,sso_domains,sso_auto_join,allow_phone_login,audit_retention_days";

/** The school's sign-in and access rules, staff devices, and what this request looks like to them. Admins only. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin);
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  const [{ data: s }, { data: devices }, { data: staff }] = await Promise.all([
    svc.from("tenant_settings").select(COLS).eq("tenant_id", tid).maybeSingle(),
    ctx.sb.from("staff_devices").select("id,user_id,label,last_ip,status,last_seen_at,created_at,approved_at,users:user_id(full_name,role)").eq("tenant_id", tid).order("last_seen_at", { ascending: false }).limit(500),
    svc.from("users").select("id,full_name,role").eq("tenant_id", tid).eq("active", true).not("role", "in", "(student,parent,alumni)").order("full_name")
  ]);
  const ip = clientIp(req.headers);
  const dev = (await cookies()).get(DEVICE_COOKIE)?.value ?? null;
  const mine = dev ? (await svc.from("staff_devices").select("status").eq("user_id", ctx.userId).eq("device_hash", deviceHash(tid, dev)).maybeSingle()).data : null;
  const { data: { session } } = await ctx.sb.auth.getSession();
  return NextResponse.json({
    settings: s ?? {}, devices: devices ?? [], staff: staff ?? [],
    here: { ip, ip_allowed: ipAllowed(ip, s?.staff_ip_allowlist ?? []) && (s?.staff_ip_allowlist ?? []).length > 0, device_status: mine?.status ?? null, sso_session: signedInWithSso(tokenClaims(session?.access_token)) },
    available: { sms: smsConfigured(), sso: (process.env.NEXT_PUBLIC_SSO_PROVIDERS ?? "").split(",").map(x => x.trim()).filter(Boolean) }
  });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("password"), min_length: z.number().int().min(8).max(64), require_mixed_case: z.boolean(), require_number: z.boolean(), require_symbol: z.boolean(),
    max_age_days: z.number().int().min(0).max(730), scope: z.enum(["staff", "all"]) }),
  z.object({ action: z.literal("sessions"), idle_minutes: z.number().int().refine(n => n === 0 || (n >= 5 && n <= 720), "between 5 and 720 minutes, or 0 for never"),
    max_hours: z.number().int().refine(n => n === 0 || (n >= 1 && n <= 720), "between 1 and 720 hours, or 0 for no limit") }),
  z.object({ action: z.literal("mfa"), require_mfa: z.enum(["off", "admins", "staff"]) }),
  z.object({ action: z.literal("sso"), policy: z.enum(["optional", "required_staff"]), domains: z.array(z.string().max(253)).max(20), auto_join: z.boolean() }),
  z.object({ action: z.literal("phone"), allow: z.boolean() }),
  z.object({ action: z.literal("access"), mode: z.enum(["off", "ip", "device", "ip_or_device"]), roles: z.enum(["all_staff", "except_admins"]), ip_allowlist: z.array(z.string().max(64)).max(100) }),
  z.object({ action: z.literal("device"), id: z.string().uuid(), status: z.enum(["approved", "revoked", "delete"]) }),
  z.object({ action: z.literal("sign_out_user"), user_id: z.string().uuid() }),
  z.object({ action: z.literal("retention"), days: z.number().int().min(30).max(3650) })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  const save = async (row: Record<string, unknown>, what: string) => {
    const { error } = await ctx.sb.from("tenant_settings").upsert({ tenant_id: tid, ...row, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" });
    if (error) return jsonError(error.message);
    await ctx.sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: `security.${what}`, meta: row });
    clearAccessCache(tid);
    return NextResponse.json({ ok: true });
  };
  const { data: { session } } = await ctx.sb.auth.getSession();
  const claims = tokenClaims(session?.access_token);

  switch (b.action) {
    case "password":
      return save({ password_min_length: b.min_length, password_require_mixed_case: b.require_mixed_case, password_require_number: b.require_number,
        password_require_symbol: b.require_symbol, password_max_age_days: b.max_age_days, password_policy_scope: b.scope }, "password_rules");
    case "sessions":
      return save({ session_idle_minutes: b.idle_minutes, session_max_hours: b.max_hours }, "session_rules");
    case "mfa":
      // Turning it on from a session without a second factor would lock this admin out at once.
      if (b.require_mfa !== "off" && claims.aal !== "aal2") return jsonError("Set up two-factor sign-in on your own account first (Account security), then turn this on.", 409);
      return save({ require_mfa: b.require_mfa }, "mfa");
    case "sso": {
      const domains = cleanDomains(b.domains);
      if (b.policy === "required_staff") {
        if (!(process.env.NEXT_PUBLIC_SSO_PROVIDERS ?? "").trim()) return jsonError("Google or Microsoft sign-in is not set up on this server yet.", 409);
        if (!signedInWithSso(claims)) return jsonError("Sign in with your school Google or Microsoft account first, then require it, so you are not locked out.", 409);
      }
      if (b.auto_join && !domains.length) return jsonError("add your school's email domain (for example myschool.edu.ng) to let staff join with it");
      return save({ sso_policy: b.policy, sso_domains: domains, sso_auto_join: b.auto_join }, "sso");
    }
    case "phone":
      return save({ allow_phone_login: b.allow }, "phone_login");
    case "access": {
      const rules = b.ip_allowlist.map(r => r.trim()).filter(Boolean);
      const bad = rules.filter(r => !isValidIpRule(r));
      if (bad.length) return jsonError(`not a valid address or range: ${bad.join(", ")}`);
      if ((b.mode === "ip") && !rules.length) return jsonError("add at least one school network address");
      // Do not let an admin lock themselves out: their own request must pass the new rule.
      if (restrictionApplies(b.mode as AccessMode, b.roles, [...ctx.roles])) {
        const ip = clientIp(req.headers);
        const ipOk = rules.length > 0 && ipAllowed(ip, rules);
        let device: DeviceStatus = null;
        const cookie = (await cookies()).get(DEVICE_COOKIE)?.value;
        if (b.mode !== "ip" && cookie) {
          // The admin's current device is approved as part of switching the rule on.
          const hash = deviceHash(tid, cookie);
          await svc.from("staff_devices").upsert({ tenant_id: tid, user_id: ctx.userId, device_hash: hash, label: deviceLabel(req.headers.get("user-agent")), last_ip: ip,
            status: "approved", approved_by: ctx.userId, approved_at: new Date().toISOString() }, { onConflict: "user_id,device_hash" });
          device = "approved";
        }
        if (!decideAccess(b.mode as AccessMode, ipOk, device).ok) return jsonError(`This would lock you out: your address (${ip ?? "unknown"}) is not on the list.`, 409);
      }
      return save({ staff_access_mode: b.mode, staff_access_roles: b.roles, staff_ip_allowlist: rules }, "access_rules");
    }
    case "device": {
      const q = b.status === "delete"
        ? ctx.sb.from("staff_devices").delete().eq("tenant_id", tid).eq("id", b.id)
        : ctx.sb.from("staff_devices").update({ status: b.status, approved_by: ctx.userId, approved_at: new Date().toISOString() }).eq("tenant_id", tid).eq("id", b.id);
      const { error } = await q;
      if (error) return jsonError(error.message);
      if (b.status !== "approved") {
        const { data: d } = await svc.from("staff_devices").select("user_id").eq("id", b.id).maybeSingle();
        if (d) await svc.from("access_grants").delete().eq("user_id", d.user_id);
      }
      clearAccessCache(tid);
      return NextResponse.json({ ok: true });
    }
    case "sign_out_user": {
      if (b.user_id === ctx.userId) return jsonError("use Account security to sign out your own devices");
      const { data, error } = await ctx.sb.rpc("end_user_sessions", { p_user: b.user_id });
      if (error) return jsonError(error.message);
      await ctx.sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "security.user_signed_out", target: b.user_id });
      clearAccessCache(tid);
      return NextResponse.json({ ok: true, ended: data });
    }
    case "retention":
      return save({ audit_retention_days: b.days }, "retention");
  }
}
