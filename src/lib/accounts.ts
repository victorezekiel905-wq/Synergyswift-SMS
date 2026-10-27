/**
 * Accounts that set themselves up: student usernames (no email needed),
 * starting passwords, and the "student key" message parents receive.
 * Pure functions, unit tested; the server side is accounts-server.ts.
 */
import { randomInt } from "crypto";

export { STUDENT_LOGIN_DOMAIN, loginEmailFor, signInEmail, isUsernameEmail } from "./login-name";

const clean = (s: string) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "");

/**
 * A username a parent can type for their child: admission number + school
 * code ("gc2026014.greenfield"). Falls back to the first name when there is
 * no admission number. `taken` adds a number until it is free.
 */
export function usernameFor(s: { admission_no: string | null; first_name: string; last_name: string }, schoolCode: string, taken: (u: string) => boolean = () => false): string {
  const school = clean(schoolCode).slice(0, 20) || "school";
  const who = clean(s.admission_no ?? "") || `${clean(s.first_name).slice(0, 10)}${clean(s.last_name).slice(0, 1)}`;
  const base = `${who || "student"}.${school}`;
  if (!taken(base)) return base;
  for (let i = 2; i < 1000; i++) if (!taken(`${base}${i}`)) return `${base}${i}`;
  throw new Error("could not find a free username");
}

const WORDS = ["mango", "river", "tiger", "lemon", "cloud", "eagle", "piano", "coral", "maple", "zebra", "orbit", "candle", "rocket", "planet", "garden", "silver", "falcon", "harbor", "violet", "cobalt"];

/** Easy to read out and type, hard to guess: word-word-1234 (about 32 bits). */
export function startingPassword(): string {
  const w = () => WORDS[randomInt(WORDS.length)];
  return `${w()}-${w()}-${String(randomInt(10000)).padStart(4, "0")}`;
}

export type Brand = { schoolName: string };
export type Rendered = { subject: string; text: string; html: string; wa: { template: string | null; params: string[]; text: string } };

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** The message parents get with their child's sign-in details. */
export function studentKeyMessage(b: Brand, p: { guardianName: string; studentName: string; username: string; password: string; link: string }): Rendered {
  const lines = [`Username: ${p.username}`, `Starting password: ${p.password}`];
  return {
    subject: `${p.studentName}'s ${b.schoolName} sign-in`,
    text: `Dear ${p.guardianName},\n\n${p.studentName} now has a ${b.schoolName} account for lessons, homework, exams and results.\n\n${lines.join("\n")}\nSign in at: ${p.link}\n\nThe password must be changed the first time. Please keep these details private.`,
    html: `<p>Dear ${esc(p.guardianName)},</p><p><b>${esc(p.studentName)}</b> now has a ${esc(b.schoolName)} account for lessons, homework, exams and results.</p>`
      + `<p style="font-family:monospace;background:#f1f5f9;padding:12px;border-radius:6px">Username: ${esc(p.username)}<br>Starting password: ${esc(p.password)}</p>`
      + `<p><a href="${esc(p.link)}">Sign in</a>. The password must be changed the first time. Please keep these details private.</p>`,
    wa: { template: null, params: [], text: `*${b.schoolName}*\n${p.studentName}'s sign-in\n${lines.join("\n")}\n${p.link}\nChange the password the first time. Keep this private.` }
  };
}

export { pointTotals, makeGroups, storyPhotoAllowed } from "./classroom";
