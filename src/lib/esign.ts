/**
 * E-signature rules: the fingerprint of what is being signed, checks on a
 * signature, progress of a request, the text of a staff contract, and the
 * audit trail printed on the signed copy. Pure and unit tested.
 */
import { createHash } from "node:crypto";

/** SHA-256 of exactly what the signer sees: title, text, and the attached document's own fingerprint. */
export function contentHash(title: string, body: string, documentFingerprint: string | null = null): string {
  return createHash("sha256").update(JSON.stringify([title.trim(), body, documentFingerprint ?? ""])).digest("hex");
}
/** Fingerprint of an attached file's bytes. */
export const fileFingerprint = (bytes: Uint8Array | Buffer) => createHash("sha256").update(bytes).digest("hex");

export const CONSENT_TEXT = "I agree to sign this electronically. My typed name (and drawing, if I add one) is my signature and has the same effect as signing on paper.";

export type SignInput = { agree?: unknown; typed_name?: unknown; signature_png?: unknown };

/** Problems with a signature (null when it may be recorded). */
export function checkSignature(i: SignInput): string | null {
  if (i.agree !== true) return "tick the box to agree to sign electronically";
  const name = typeof i.typed_name === "string" ? i.typed_name.trim() : "";
  if (name.length < 2 || name.length > 160) return "type your full name";
  if (i.signature_png !== undefined && i.signature_png !== null && i.signature_png !== "") {
    if (typeof i.signature_png !== "string" || !i.signature_png.startsWith("data:image/png;base64,iVBORw0KGgo")) return "the drawn signature is not a PNG image";
    if (i.signature_png.length > 400_000) return "the drawn signature is too large";
  }
  return null;
}

export type SignerRow = { id: string; status: string; student_id: string | null; name: string; signed_at?: string | null };

/** How far a request has got: signers by state, and (for parents' forms) children covered. */
export function progress(signers: SignerRow[], rule: "all" | "any_per_child") {
  const count = (s: string) => signers.filter(x => x.status === s).length;
  const children = new Map<string, boolean>();
  for (const s of signers) if (s.student_id) children.set(s.student_id, (children.get(s.student_id) ?? false) || s.status === "signed");
  const childrenDone = [...children.values()].filter(Boolean).length;
  const waiting = signers.filter(s => s.status === "pending" || s.status === "viewed");
  return {
    total: rule === "any_per_child" && children.size ? children.size : signers.filter(s => s.status !== "not_needed").length,
    done: rule === "any_per_child" && children.size ? childrenDone : count("signed"),
    signed: count("signed"), declined: count("declined"), viewed: count("viewed"), pending: count("pending"), not_needed: count("not_needed"),
    waiting: waiting.map(s => s.name)
  };
}

/** The text of a staff contract to be signed, from its HR record. */
export function contractText(c: { kind: string; position: string | null; starts_on: string; ends_on: string | null; probation_ends_on: string | null; notice_days: number | null; salary_note: string | null; notes: string | null },
  staffName: string, school: string): string {
  const kind = c.kind.replace(/_/g, " ");
  return [
    `This ${kind} contract is between ${school} ("the school") and ${staffName}.`,
    c.position ? `Position: ${c.position}.` : null,
    `Start date: ${c.starts_on}.${c.ends_on ? ` End date: ${c.ends_on}.` : ""}`,
    c.probation_ends_on ? `Probation ends: ${c.probation_ends_on}.` : null,
    c.notice_days !== null ? `Notice period: ${c.notice_days} days.` : null,
    c.salary_note ? `Pay: ${c.salary_note}.` : null,
    c.notes ? `\n${c.notes}` : null,
    `\nBy signing, ${staffName} accepts these terms and the school's staff policies in force from time to time.`
  ].filter(Boolean).join("\n");
}

/** Lines for the audit trail on a signed copy. */
export function auditTrail(r: { title: string; content_hash: string; created_at: string; completed_at: string | null; status: string },
  signers: (SignerRow & { typed_name?: string | null; viewed_at?: string | null; ip?: string | null; user_agent?: string | null; signed_hash?: string | null; decline_reason?: string | null })[]) {
  const lines = [`Document: ${r.title}`, `Fingerprint (SHA-256): ${r.content_hash}`, `Sent: ${r.created_at}`];
  for (const s of signers) {
    if (s.status === "not_needed") { lines.push(`${s.name}: not needed (another parent signed)`); continue; }
    const parts = [`${s.name}: ${s.status}`];
    if (s.viewed_at) parts.push(`opened ${s.viewed_at}`);
    if (s.signed_at) parts.push(`signed ${s.signed_at} as "${s.typed_name ?? ""}"`);
    if (s.ip) parts.push(`from ${s.ip}`);
    if (s.signed_hash) parts.push(s.signed_hash === r.content_hash ? "fingerprint matches" : "FINGERPRINT DOES NOT MATCH");
    if (s.decline_reason) parts.push(`reason: ${s.decline_reason}`);
    lines.push(parts.join(", "));
  }
  lines.push(r.completed_at ? `Completed: ${r.completed_at}` : `Status: ${r.status}`);
  return lines;
}
