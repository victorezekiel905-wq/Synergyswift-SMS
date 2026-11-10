/**
 * Sign-up codes (migration 9600): the two ways into Synergy Swift for the people a school adds.
 *  1. A personal code: the person types it with their email and a password of their own.
 *  2. A one-time password the school sends: the person signs in with their email and it,
 *     then chooses a new password (twice) before anything else.
 * Students also have a parent code: parents sign up with it, or add a child with it later.
 * Pure helpers, safe in the browser.
 */

export type CodeKind = "staff" | "student" | "guardian" | "parent_link";

export const KIND_LABEL: Record<CodeKind, string> = {
  staff: "Staff", student: "Student", guardian: "Parent", parent_link: "Parent code (child)"
};

/** As people type it: capitals, letters and numbers only (dashes and spaces dropped). */
export function cleanCode(input: string): string {
  return String(input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** A code is 8 characters from the 32 without look-alikes (no 0, O, 1, I). */
export function isCodeShape(input: string): boolean {
  return /^[A-HJ-NP-Z2-9]{8}$/.test(cleanCode(input));
}

/** ABCD-EFGH: easier to read out and copy. */
export function formatCode(code: string | null | undefined): string {
  const c = cleanCode(code ?? "");
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

/** Where each kind of account lands after signing up. */
export function homeFor(role: string): string {
  return role === "parent" ? "/parent" : role === "student" ? "/student" : "/dashboard";
}

/** The new password and its retype: both filled, and the same. Returns a problem or null. */
export function passwordsMatch(pw: string, again: string): string | null {
  if (!pw) return "Enter a new password.";
  if (!again) return "Type the new password again.";
  return pw === again ? null : "The two passwords are not the same. Type them again.";
}
