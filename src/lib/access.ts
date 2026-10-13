/**
 * Network and device rules for staff. When a school restricts staff access,
 * every request is checked here; a request that passes leaves a short-lived
 * access grant for its session, which the database requires before it shows
 * that session any of the school's data (see session_block()).
 */
import { cookies, headers } from "next/headers";
import { createServiceClient } from "./supabase/service";
import { clientIp, ipAllowed } from "./net";
import { sha256hex } from "./crypto";
import { decideAccess, restrictionApplies, accessMessage, deviceLabel, tokenClaims, type AccessMode, type DeviceStatus } from "./security";

export const DEVICE_COOKIE = "ecf_dev";
const GRANT_MINUTES = 20;

type Rules = { mode: AccessMode; scope: "all_staff" | "except_admins"; allow: string[]; at: number };
const ruleCache = new Map<string, Rules>();
const grantCache = new Map<string, number>();   // `${user}:${session}` → expiry (ms)
const userCache = new Map<string, { tenant_id: string; roles: string[]; active: boolean; at: number }>();

async function rulesFor(svc: any, tenantId: string): Promise<Rules> {
  const hit = ruleCache.get(tenantId);
  if (hit && Date.now() - hit.at < 30_000) return hit;
  const { data } = await svc.from("tenant_settings").select("staff_access_mode,staff_access_roles,staff_ip_allowlist").eq("tenant_id", tenantId).maybeSingle();
  const r: Rules = { mode: (data?.staff_access_mode ?? "off") as AccessMode, scope: data?.staff_access_roles ?? "except_admins", allow: data?.staff_ip_allowlist ?? [], at: Date.now() };
  ruleCache.set(tenantId, r);
  return r;
}

/** Forget cached rules after an admin changes them. */
export function clearAccessCache(tenantId: string) {
  ruleCache.delete(tenantId);
  grantCache.clear();
  userCache.clear();
}

export function deviceHash(tenantId: string, cookie: string) {
  return sha256hex(`${tenantId}:${cookie}`);
}

export type AccessResult = { ok: true } | { ok: false; message: string; reason: string; device: DeviceStatus };

/**
 * Checks the current request for a signed-in user. Returns ok for anyone the
 * rules do not cover. `accessToken` is the session's token (for its id).
 */
export async function checkAccess(userId: string, accessToken: string | null): Promise<AccessResult> {
  const svc = createServiceClient();
  let u = userCache.get(userId);
  if (!u || Date.now() - u.at > 30_000) {
    const { data } = await svc.from("users").select("tenant_id,role,extra_roles,active").eq("id", userId).maybeSingle();
    if (!data) return { ok: true };                 // other checks report accounts that are not set up
    u = { tenant_id: data.tenant_id, roles: [data.role, ...(data.extra_roles ?? [])], active: data.active, at: Date.now() };
    userCache.set(userId, u);
  }
  if (!u.active) return { ok: true };               // reported as deactivated elsewhere
  const rules = await rulesFor(svc, u.tenant_id);
  if (!restrictionApplies(rules.mode, rules.scope, u.roles)) return { ok: true };
  const session = tokenClaims(accessToken).session_id;
  if (!session) return { ok: false, message: "Please sign in again.", reason: "session", device: null };
  const key = `${userId}:${session}`;
  if ((grantCache.get(key) ?? 0) - Date.now() > 10 * 60_000) return { ok: true };

  const [h, c] = await Promise.all([headers(), cookies()]);
  const ip = clientIp(h);
  const devCookie = c.get(DEVICE_COOKIE)?.value ?? null;
  const ipOk = rules.allow.length > 0 && ipAllowed(ip, rules.allow);
  let device: DeviceStatus = null;
  const needsDevice = rules.mode === "device" || (rules.mode === "ip_or_device" && !ipOk);
  if (needsDevice && devCookie && /^[0-9a-f]{32,64}$/.test(devCookie)) {
    const hash = deviceHash(u.tenant_id, devCookie);
    const { data: d } = await svc.from("staff_devices").select("id,status").eq("user_id", userId).eq("device_hash", hash).maybeSingle();
    if (d) {
      device = d.status;
      await svc.from("staff_devices").update({ last_seen_at: new Date().toISOString(), last_ip: ip }).eq("id", d.id);
    } else {
      // First visit from this device: ask the school to approve it.
      const ua = h.get("user-agent");
      await svc.from("staff_devices").insert({ tenant_id: u.tenant_id, user_id: userId, device_hash: hash, label: deviceLabel(ua), user_agent: ua?.slice(0, 300) ?? null, last_ip: ip });
      device = "pending";
    }
  }
  const decision = decideAccess(rules.mode, ipOk, device);
  if (!decision.ok) {
    await svc.from("access_grants").delete().eq("user_id", userId).eq("session_id", session);
    grantCache.delete(key);
    return { ok: false, message: accessMessage(decision), reason: decision.reason, device };
  }
  const expires = Date.now() + GRANT_MINUTES * 60_000;
  await svc.from("access_grants").upsert({ user_id: userId, session_id: session, tenant_id: u.tenant_id, ip, expires_at: new Date(expires).toISOString() }, { onConflict: "user_id,session_id" });
  grantCache.set(key, expires);
  return { ok: true };
}
