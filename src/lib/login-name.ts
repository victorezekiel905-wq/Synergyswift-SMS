/** Username sign-in, safe for the browser: a username becomes its hidden email. */
export const STUDENT_LOGIN_DOMAIN = (process.env.NEXT_PUBLIC_STUDENT_LOGIN_DOMAIN || "students.synergyswift.invalid").toLowerCase();

export const loginEmailFor = (username: string) => `${username.trim().toLowerCase()}@${STUDENT_LOGIN_DOMAIN}`;

/** What the sign-in box should look up: an email as typed, or a username turned into its hidden email. */
export function signInEmail(input: string): string {
  const v = String(input ?? "").trim().toLowerCase();
  return v.includes("@") ? v : loginEmailFor(v);
}

/** True for the hidden emails behind usernames (never shown or emailed). */
export const isUsernameEmail = (email: string | null | undefined) => Boolean(email && email.toLowerCase().endsWith(`@${STUDENT_LOGIN_DOMAIN}`));
