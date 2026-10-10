/**
 * Report-card signatures. When a card is published the server signs the
 * figures that matter (who, which term, every subject total and grade, the
 * average and position) with a secret key. The public card page re-checks
 * the signature, so a card whose figures were changed after publishing shows
 * a warning, and the QR code on a printed card leads to the genuine record.
 *
 * Key: REPORT_SIGNING_KEY, or (if unset) a key derived from the service-role
 * key so signing works out of the box.
 */
import { createHmac, createHash, timingSafeEqual } from "crypto";

type SignableCard = {
  id: string; tenant_id: string; student_id: string; term_id: string; kind?: string | null;
  total: number | string | null; average: number | string | null; position: number | null; published_at: string | null;
  data: { subjects?: { subject_id: string; total: number | null; grade: string | null }[] } | null;
};

function key(): Buffer | null {
  if (process.env.REPORT_SIGNING_KEY) return Buffer.from(process.env.REPORT_SIGNING_KEY);
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return svc ? createHash("sha256").update(`report-sign:${svc}`).digest() : null;
}

/** Canonical text of the signed fields (numbers normalised so 70 and "70.0" agree). */
export function canonicalCard(c: SignableCard): string {
  const n = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));
  const subjects = [...(c.data?.subjects ?? [])]
    .map(s => [s.subject_id, n(s.total), s.grade ?? null])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return JSON.stringify([c.id, c.tenant_id, c.student_id, c.term_id, c.kind ?? "term", n(c.total), n(c.average), c.position ?? null, c.published_at, subjects]);
}

export function signCard(c: SignableCard): string | null {
  const k = key();
  return k ? createHmac("sha256", k).update(canonicalCard(c)).digest("base64url") : null;
}

export type Verification = "valid" | "changed" | "unsigned";

export function verifyCard(c: SignableCard & { signature: string | null }): Verification {
  if (!c.signature) return "unsigned";
  const expected = signCard(c);
  if (!expected) return "unsigned";
  const a = Buffer.from(expected), b = Buffer.from(c.signature);
  return a.length === b.length && timingSafeEqual(a, b) ? "valid" : "changed";
}

/** Signs (or re-signs) published cards by id. Uses the caller's client; admins may update cards. */
export async function signPublishedCards(sb: any, tenantId: string, ids: string[]) {
  if (!ids.length || !key()) return 0;
  const { data } = await sb.from("report_cards").select("id,tenant_id,student_id,term_id,kind,total,average,position,published_at,data,status")
    .eq("tenant_id", tenantId).in("id", ids).eq("status", "published");
  let n = 0;
  for (const c of data ?? []) {
    const signature = signCard(c);
    if (!signature) continue;
    const { error } = await sb.from("report_cards").update({ signature, signed_at: new Date().toISOString() }).eq("id", c.id);
    if (!error) n++;
  }
  return n;
}
