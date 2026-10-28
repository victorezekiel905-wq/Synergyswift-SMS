/**
 * One-time school codes (migration 7900). Only the platform owner makes
 * them; a prospect uses one to set up their school, and it is used up at
 * that moment. A code lasts 20 minutes from when it is made, so it is made
 * while the school is ready to start. Codes are 12 characters from an alphabet without look-alikes
 * (no 0/O, 1/I/L), shown as SSC-XXXX-XXXX-XXXX, and stored only as a hash.
 */
import { createHash, randomInt } from "crypto";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
/** How long a new code works for. */
export const SCHOOL_CODE_TTL_MIN = 20;

export function newSchoolCode(): string {
  const chars = Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `SSC-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
}

/** What the person typed, tidied: case, spaces, dashes and the SSC prefix don't matter. */
export function normalizeSchoolCode(input: string): string {
  const s = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s.startsWith("SSC") && s.length === 15 ? s.slice(3) : s;
}

export const isSchoolCodeShape = (input: string) => new RegExp(`^[${ALPHABET}]{12}$`).test(normalizeSchoolCode(input));

export function hashSchoolCode(input: string): string {
  return createHash("sha256").update(`school-code:${normalizeSchoolCode(input)}`).digest("hex");
}

export type CodeRow = { used_at: string | null; revoked_at: string | null; expires_at: string };
export function codeStatus(c: CodeRow, now = Date.now()): "used" | "revoked" | "expired" | "open" {
  if (c.used_at) return "used";
  if (c.revoked_at) return "revoked";
  if (Date.parse(c.expires_at) <= now) return "expired";
  return "open";
}
