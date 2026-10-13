/**
 * Sign in with a code sent by SMS. The server finds the one account that
 * owns the number, sends a 6-digit code through the school's SMS provider,
 * and on a correct code opens a normal session for that account.
 */
import { timingSafeEqual } from "crypto";
import { normalizePhone } from "./messaging/providers";
import { sha256hex, randomDigits } from "./crypto";

export const CODE_TTL_MIN = 10;
export const MAX_ATTEMPTS = 5;

/** The ways a number may have been typed into the school's records. */
export function phoneVariants(raw: string, cc = process.env.DEFAULT_COUNTRY_CODE ?? "234"): string[] {
  const d = normalizePhone(raw, cc);
  if (!d) return [];
  const out = new Set([d, `+${d}`]);
  if (d.startsWith(cc)) { out.add(`0${d.slice(cc.length)}`); out.add(d.slice(cc.length)); }
  return [...out];
}

export function newCode() { return randomDigits(6); }
export function codeHash(userId: string, phone: string, code: string) { return sha256hex(`${userId}:${phone}:${code.trim()}`); }
export function sameHash(a: string, b: string) {
  const x = Buffer.from(a, "hex"), y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Every active account (staff, parent, student) whose record carries this number. */
export async function accountsForPhone(svc: any, raw: string): Promise<string[]> {
  const v = phoneVariants(raw);
  if (!v.length) return [];
  const [u, s, g] = await Promise.all([
    svc.from("users").select("id").in("phone", v).eq("active", true),
    svc.from("staff").select("user_id").in("phone", v).not("user_id", "is", null),
    svc.from("guardians").select("user_id").or(`phone.in.(${v.map(x => `"${x}"`).join(",")}),whatsapp_phone.in.(${v.map(x => `"${x}"`).join(",")})`).not("user_id", "is", null)
  ]);
  const ids = [...new Set([...(u.data ?? []).map((r: any) => r.id), ...(s.data ?? []).map((r: any) => r.user_id), ...(g.data ?? []).map((r: any) => r.user_id)])];
  if (!ids.length) return [];
  // Only accounts of active schools that allow phone sign-in, and not alumni.
  const { data: users } = await svc.from("users").select("id,tenant_id,role,active,tenants(status)").in("id", ids);
  const ok = (users ?? []).filter((x: any) => x.active && x.role !== "alumni" && x.tenants?.status === "active");
  if (!ok.length) return [];
  const { data: settings } = await svc.from("tenant_settings").select("tenant_id,allow_phone_login").in("tenant_id", [...new Set(ok.map((x: any) => x.tenant_id))]);
  const off = new Set((settings ?? []).filter((x: any) => x.allow_phone_login === false).map((x: any) => x.tenant_id));
  return ok.filter((x: any) => !off.has(x.tenant_id)).map((x: any) => x.id);
}
