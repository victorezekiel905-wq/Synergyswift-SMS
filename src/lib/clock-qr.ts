/**
 * The clock-in code shown on a screen at the school entrance (phase 14i-1).
 * Staff scan it with their phone to sign in or out, with no clocking machine.
 * The code changes every 30 seconds and is signed for one school (and campus),
 * so a photo of it stops working within about a minute and a half. The school's
 * id is not in the code: the server checks it against the signed-in person's school.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const CLOCK_WINDOW_S = 30;
const MAX_AGE_WINDOWS = 2;

export function clockKey(): Buffer {
  if (process.env.CLOCK_QR_KEY) return Buffer.from(process.env.CLOCK_QR_KEY);
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!svc) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  return createHash("sha256").update(`clock-qr:${svc}`).digest();
}

const windowOf = (now: number) => Math.floor(now / 1000 / CLOCK_WINDOW_S);
const sign = (key: Buffer, tenantId: string, w: number, campus: string) =>
  createHmac("sha256", key).update(`${tenantId}|${w}|${campus}`).digest().subarray(0, 12).toString("base64url");

export function clockToken(tenantId: string, campus: string | null, key: Buffer, now = Date.now()): string {
  const w = windowOf(now);
  return `${w.toString(36)}.${campus ? Buffer.from(campus).toString("base64url") : ""}.${sign(key, tenantId, w, campus ?? "")}`;
}

/** The campus of a genuine, fresh code for this school, or null when the code is not valid. */
export function readClockToken(token: string, tenantId: string, key: Buffer, now = Date.now()): { campus: string | null } | null {
  if (typeof token !== "string" || token.length > 200) return null;
  const [w36, c, s] = token.split(".");
  if (!w36 || c === undefined || !s) return null;
  const w = parseInt(w36, 36);
  const cur = windowOf(now);
  if (!Number.isFinite(w) || w > cur || cur - w > MAX_AGE_WINDOWS) return null;
  const campus = c ? Buffer.from(c, "base64url").toString("utf8") : "";
  const want = Buffer.from(sign(key, tenantId, w, campus));
  const got = Buffer.from(s);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return { campus: campus || null };
}
