import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/messaging/providers";

/**
 * The platform's error log (migration 11100). Crashes are grouped into kinds by where they happened
 * and their message with numbers and ids taken out, so "student 4f1c… not found" and "student 9a2e…
 * not found" count as one kind. The first time a kind appears (or again after a quiet day) the
 * platform admins get an email. Never throws: logging must not cause a second failure.
 */
export function normalise(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\b\d+(\.\d+)?\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/**
 * A short, stable id for a kind of error. Plain JavaScript (two 53-bit hashes), not node:crypto: Next.js
 * also builds instrumentation for its edge runtime, where node: modules do not exist.
 */
export function fingerprint(source: string, location: string, message: string): string {
  const s = `${source}|${location}|${normalise(message)}`;
  const h = (seed: number) => {
    let a = 0xdeadbeef ^ seed, b = 0x41c6ce57 ^ seed;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677); }
    a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
    b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
    return (4294967296 * (2097151 & b) + (a >>> 0)).toString(16).padStart(14, "0");
  };
  return `${h(1)}${h(2)}`;
}

// The same kind is written at most once every 10 seconds by each server, so a crash loop cannot
// flood the database (the count is then a lower bound, which is fine for spotting problems).
const recent = new Map<string, number>();

export async function logError(source: "server" | "browser", message: string, location: string | null, detail?: string | null): Promise<void> {
  try {
    const msg = String(message || "Unknown error").slice(0, 500);
    const loc = String(location ?? "").slice(0, 200);
    const fp = fingerprint(source, loc, msg);
    const now = Date.now();
    if ((recent.get(fp) ?? 0) > now - 10_000) return;
    recent.set(fp, now);
    if (recent.size > 1000) for (const [k, at] of recent) if (at < now - 60_000) recent.delete(k);

    const svc = createServiceClient();
    const { data: alert, error } = await svc.rpc("record_error", { p_fingerprint: fp, p_source: source, p_message: msg, p_location: loc, p_detail: detail ? String(detail).slice(0, 2000) : null });
    if (error || alert !== true) return;
    const { data: team } = await svc.from("platform_admins").select("email").not("email", "is", null);
    const text = `A new kind of error appeared on Synergy Swift.\n\nWhere: ${loc || "unknown"} (${source})\nWhat: ${msg}\n\n${detail ? String(detail).slice(0, 1200) + "\n\n" : ""}See every error, how often and when, in the platform console (Centre → Performance).`;
    for (const t of team ?? []) {
      await sendEmail({ to: (t as { email: string }).email, subject: `Synergy Swift error: ${msg.slice(0, 80)}`, text }).catch(() => null);
    }
  } catch {
    /* never let logging fail the request */
  }
}
