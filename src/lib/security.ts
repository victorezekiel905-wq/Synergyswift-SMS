/**
 * Sign-in and access rules. Pure functions only (no I/O), unit tested.
 */

// ---------------- passwords ----------------

export type PasswordPolicy = { min_length: number; require_mixed_case: boolean; require_number: boolean; require_symbol: boolean; max_age_days: number };
export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = { min_length: 8, require_mixed_case: false, require_number: true, require_symbol: false, max_age_days: 0 };

// The most used passwords, plus ones common in schools. Matched after lower-casing.
const COMMON = new Set([
  "password", "password1", "password12", "password123", "passw0rd", "p@ssw0rd", "p@ssword", "12345678", "123456789", "1234567890", "11111111",
  "00000000", "87654321", "12341234", "qwerty123", "qwertyuiop", "qwerty12", "1q2w3e4r", "1qaz2wsx", "abc12345", "abcd1234", "iloveyou",
  "welcome1", "welcome123", "letmein1", "admin123", "administrator", "changeme", "sunshine", "princess", "football", "baseball",
  "monkey123", "dragon123", "trustno1", "superman", "master123", "school123", "school2024", "school2025", "school2026", "teacher1",
  "teacher123", "student1", "student123", "nigeria1", "nigeria123", "lagos123", "abuja123", "jesus123", "god12345", "blessing",
  "blessed1", "favour123", "princess1", "chelsea1", "arsenal1", "manutd123", "liverpool", "barcelona", "computer", "internet"
]);

/** Problems with a proposed password, in plain words; empty when it is acceptable. */
export function checkPassword(pw: string, policy: Partial<PasswordPolicy> = {}, about: { email?: string | null; name?: string | null } = {}): string[] {
  const p = { ...DEFAULT_PASSWORD_POLICY, ...policy };
  const out: string[] = [];
  if (pw.length < p.min_length) out.push(`use at least ${p.min_length} characters`);
  if (pw.length > 128) out.push("use at most 128 characters");
  if (p.require_mixed_case && !(/[a-z]/.test(pw) && /[A-Z]/.test(pw))) out.push("mix capital and small letters");
  if (p.require_number && !/\d/.test(pw)) out.push("include a number");
  if (p.require_symbol && !/[^A-Za-z0-9]/.test(pw)) out.push("include a symbol such as ! or #");
  const low = pw.toLowerCase();
  if (COMMON.has(low) || /^(.)\1+$/.test(pw) || /^(0123456789|123456789|abcdefgh)/.test(low)) out.push("choose something less common");
  const local = (about.email ?? "").split("@")[0].toLowerCase();
  if (local.length >= 4 && low.includes(local)) out.push("do not include your email address");
  const names = (about.name ?? "").toLowerCase().split(/\s+/).filter(n => n.length >= 4 && !/^(mrs?|miss|dr)\.?$/.test(n));
  if (names.some(n => low.includes(n))) out.push("do not include your name");
  return out;
}

export function passwordRulesText(policy: Partial<PasswordPolicy> = {}): string {
  const p = { ...DEFAULT_PASSWORD_POLICY, ...policy };
  const parts = [`at least ${p.min_length} characters`];
  if (p.require_mixed_case) parts.push("capital and small letters");
  if (p.require_number) parts.push("a number");
  if (p.require_symbol) parts.push("a symbol");
  return `Use ${parts.join(", ").replace(/, ([^,]*)$/, " and $1")}.`;
}

/** Days until a password must be changed (negative when overdue); null when it never expires. */
export function passwordDaysLeft(changedAt: string | null, maxAgeDays: number, now = new Date()): number | null {
  if (!maxAgeDays) return null;
  const since = changedAt ? new Date(changedAt).getTime() : 0;
  return Math.floor((since + maxAgeDays * 86400_000 - now.getTime()) / 86400_000);
}

// ---------------- staff access restrictions ----------------

export type AccessMode = "off" | "ip" | "device" | "ip_or_device";
export type DeviceStatus = "approved" | "pending" | "revoked" | null;
export type AccessDecision = { ok: true } | { ok: false; reason: "network" | "device" | "network_or_device"; device: DeviceStatus };

export function restrictionApplies(mode: AccessMode, scope: "all_staff" | "except_admins", roles: string[]): boolean {
  if (mode === "off") return false;
  if (!roles.some(r => !["student", "parent", "alumni"].includes(r))) return false;          // families, students, alumni
  if (scope === "except_admins" && roles.some(r => ["school_admin", "principal", "platform_admin"].includes(r))) return false;
  return true;
}

/** Whether a staff request may proceed under the school's network and device rule. */
export function decideAccess(mode: AccessMode, ipOk: boolean, device: DeviceStatus): AccessDecision {
  const deviceOk = device === "approved";
  if (mode === "off") return { ok: true };
  if (mode === "ip") return ipOk ? { ok: true } : { ok: false, reason: "network", device };
  if (mode === "device") return deviceOk ? { ok: true } : { ok: false, reason: "device", device };
  return ipOk || deviceOk ? { ok: true } : { ok: false, reason: "network_or_device", device };
}

export function accessMessage(d: AccessDecision): string {
  if (d.ok) return "";
  const dev = d.device === "revoked" ? "This device has been blocked by your school." : d.device === "pending" ? "This device is waiting for approval by your school admin." : "This device is not approved yet.";
  if (d.reason === "network") return "Staff pages can only be opened from the school's network.";
  if (d.reason === "device") return dev;
  return `Staff pages can only be opened from the school's network or an approved device. ${dev}`;
}

// ---------------- sessions ----------------

/** Claims from a Supabase access token (not verified here; the caller has verified the user). */
export function tokenClaims(token: string | null | undefined): { session_id?: string; amr?: { method: string }[]; aal?: string } {
  if (!token) return {};
  try {
    const part = token.split(".")[1];
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json);
  } catch { return {}; }
}

export function signedInWithSso(claims: { amr?: { method: string }[] }): boolean {
  return (claims.amr ?? []).some(a => a.method === "oauth" || a.method === "sso/saml");
}

/** "Chrome on Windows", "Safari on iPhone" … from a user-agent string. */
export function deviceLabel(ua: string | null | undefined): string {
  const s = ua ?? "";
  if (!s) return "Unknown device";
  const browser = /Edg\//.test(s) ? "Edge" : /OPR\/|Opera/.test(s) ? "Opera" : /SamsungBrowser/.test(s) ? "Samsung Internet" : /Chrome\//.test(s) ? "Chrome"
    : /Firefox\//.test(s) ? "Firefox" : /Safari\//.test(s) ? "Safari" : "Browser";
  const os = /iPhone/.test(s) ? "iPhone" : /iPad/.test(s) ? "iPad" : /Android/.test(s) ? "Android" : /Windows/.test(s) ? "Windows"
    : /Mac OS X|Macintosh/.test(s) ? "Mac" : /CrOS/.test(s) ? "Chromebook" : /Linux/.test(s) ? "Linux" : "unknown system";
  return `${browser} on ${os}`;
}

/** Email domains for single sign-on: lower-case, no @, deduplicated, valid hostnames only. */
export function cleanDomains(list: string[]): string[] {
  return [...new Set(list.map(d => d.trim().toLowerCase().replace(/^@/, "")).filter(d => /^(?=.{3,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/.test(d)))];
}

export function emailDomain(email: string | null | undefined): string {
  return String(email ?? "").split("@")[1]?.trim().toLowerCase() ?? "";
}
