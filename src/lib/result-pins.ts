/**
 * Result-checker PINs (phase 14l). Pure rules, unit tested; hashing and storage are in result-pins-server.ts.
 */

/** Digits only, so "1234-5678 9012" and "123456789012" are the same PIN. */
export const normalizePin = (pin: string) => pin.replace(/[^0-9]/g, "");
export const formatPin = (pin: string) => normalizePin(pin).replace(/(\d{4})(?=\d)/g, "$1-");
export const serialFor = (prefix: string, n: number) => `${prefix}-${String(n).padStart(6, "0")}`;

/** A short prefix for serial numbers from the school's name: "Greenfield College" → "GC". */
export function serialPrefix(name: string): string {
  const words = name.toUpperCase().replace(/[^A-Z ]/g, " ").split(/\s+/).filter(w => w && !["THE", "OF", "AND", "SCHOOL", "SCHOOLS"].includes(w));
  const p = words.map(w => w[0]).join("").slice(0, 4);
  return p.length >= 2 ? p : (words[0] ?? "SS").slice(0, 3) || "SS";
}

export type PinRow = { status: string; uses: number; student_id: string | null };
export type BatchRow = { max_uses: number; expires_on: string | null; term_id: string | null };

/** May this PIN show this student's result today? */
export function pinDecision(pin: PinRow | null, batch: BatchRow | null, studentId: string, today: string): { ok: true } | { ok: false; error: string } {
  if (!pin || !batch) return { ok: false, error: "That PIN is not correct. Check the numbers on your card." };
  if (pin.status !== "active") return { ok: false, error: "That PIN has been cancelled by the school." };
  if (batch.expires_on && today > batch.expires_on) return { ok: false, error: "That PIN has expired." };
  if (pin.student_id && pin.student_id !== studentId) return { ok: false, error: "That PIN has already been used for another student." };
  if (pin.uses >= batch.max_uses) return { ok: false, error: `That PIN has been used ${batch.max_uses} times, the most allowed.` };
  return { ok: true };
}

/** Throttling: at most this many tries in 15 minutes from one address, and for one student. */
export const TRIES = { perAddress: 20, perStudent: 10, windowMin: 15 };
