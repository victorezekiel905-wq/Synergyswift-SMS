/**
 * Google Classroom and Microsoft Teams / OneNote: the sign-in addresses and
 * scopes, the state that protects the sign-in round trip, what homework
 * looks like when sent across, and matching marks back to students by email.
 * Pure and unit tested.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type Provider = "google" | "microsoft";

export const PROVIDERS: Record<Provider, { label: string; authUrl: (tenant: string) => string; tokenUrl: (tenant: string) => string; scopes: string[] }> = {
  google: {
    label: "Google Classroom",
    authUrl: () => "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: () => "https://oauth2.googleapis.com/token",
    scopes: ["openid", "email", "https://www.googleapis.com/auth/classroom.courses.readonly", "https://www.googleapis.com/auth/classroom.coursework.students",
      "https://www.googleapis.com/auth/classroom.rosters.readonly", "https://www.googleapis.com/auth/classroom.profile.emails"]
  },
  microsoft: {
    label: "Microsoft Teams and OneNote",
    authUrl: t => `https://login.microsoftonline.com/${t}/oauth2/v2.0/authorize`,
    tokenUrl: t => `https://login.microsoftonline.com/${t}/oauth2/v2.0/token`,
    scopes: ["openid", "email", "offline_access", "User.Read", "EduAssignments.ReadWriteBasic", "EduRoster.ReadBasic", "Notes.ReadWrite", "User.ReadBasic.All"]
  }
};

/** The address that asks the teacher to allow access. */
export function authorizeUrl(p: Provider, o: { clientId: string; redirectUri: string; state: string; msTenant?: string; loginHint?: string | null }): string {
  const u = new URL(PROVIDERS[p].authUrl(o.msTenant ?? "common"));
  u.searchParams.set("client_id", o.clientId);
  u.searchParams.set("redirect_uri", o.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", PROVIDERS[p].scopes.join(" "));
  u.searchParams.set("state", o.state);
  if (p === "google") { u.searchParams.set("access_type", "offline"); u.searchParams.set("prompt", "consent"); u.searchParams.set("include_granted_scopes", "true"); }
  else u.searchParams.set("response_mode", "query");
  if (o.loginHint) u.searchParams.set("login_hint", o.loginHint);
  return u.toString();
}

/** A signed state naming the person and provider, valid for 10 minutes. */
export function makeState(secret: string, userId: string, provider: Provider, nowMs = Date.now()): string {
  const body = `${userId}.${provider}.${nowMs}.${randomBytes(8).toString("hex")}`;
  return `${Buffer.from(body).toString("base64url")}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}
export function readState(secret: string, state: string, nowMs = Date.now()): { userId: string; provider: Provider } | null {
  const [b, sig] = state.split(".");
  if (!b || !sig) return null;
  const body = Buffer.from(b, "base64url").toString();
  const want = createHmac("sha256", secret).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const [userId, provider, at] = body.split(".");
  if (!["google", "microsoft"].includes(provider) || nowMs - Number(at) > 10 * 60_000 || Number(at) > nowMs + 60_000) return null;
  return { userId, provider: provider as Provider };
}

export type Homework = { title: string; instructions: string | null; due_at: string; max_score: number | null; attachment_url?: string | null; link: string };

/** A Classroom assignment (courseWork) for a piece of homework; due date and time in UTC as Classroom expects. */
export function googleCourseWork(h: Homework) {
  const d = new Date(h.due_at);
  return {
    title: h.title.slice(0, 300),
    description: [h.instructions ?? "", `Also in the school system: ${h.link}`].filter(Boolean).join("\n\n").slice(0, 30000),
    workType: "ASSIGNMENT", state: "PUBLISHED",
    ...(h.max_score ? { maxPoints: h.max_score } : {}),
    dueDate: { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() },
    dueTime: { hours: d.getUTCHours(), minutes: d.getUTCMinutes() },
    materials: [{ link: { url: h.link, title: "Open in the school system" } }, ...(h.attachment_url && /^https:\/\//.test(h.attachment_url) ? [{ link: { url: h.attachment_url } }] : [])]
  };
}

/** A Teams assignment for a piece of homework (published after creation). */
export function teamsAssignment(h: Homework) {
  const esc = (s: string) => s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
  return {
    displayName: h.title.slice(0, 255),
    instructions: { contentType: "html", content: `${esc(h.instructions ?? "").replace(/\n/g, "<br>")}<p><a href="${esc(h.link)}">Open in the school system</a></p>` },
    dueDateTime: new Date(h.due_at).toISOString(),
    allowLateSubmissions: true,
    assignTo: { "@odata.type": "#microsoft.graph.educationAssignmentClassRecipient" },
    ...(h.max_score ? { grading: { "@odata.type": "#microsoft.graph.educationAssignmentPointsGradeType", maxPoints: h.max_score } } : {})
  };
}

/** A OneNote page (XHTML) from a lesson note. */
export function oneNotePage(n: { topic: string; content: string; subject?: string | null; class_name?: string | null; week?: number | null }) {
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  const meta = [n.subject, n.class_name, n.week ? `Week ${n.week}` : null].filter(Boolean).join(" · ");
  return `<!DOCTYPE html><html><head><title>${esc(n.topic)}</title><meta name="created" content="${new Date().toISOString()}" /></head><body>`
    + (meta ? `<p><i>${esc(meta)}</i></p>` : "")
    + n.content.split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, "<br/>")}</p>`).join("") + "</body></html>";
}

/** Marks from the other system matched to students by email, scaled to the homework's maximum. Unmatched emails are reported. */
export function matchGrades(grades: { email: string | null; points: number | null; max: number | null }[], students: { id: string; email: string | null }[], homeworkMax: number | null) {
  const byEmail = new Map(students.filter(s => s.email).map(s => [s.email!.trim().toLowerCase(), s.id]));
  const matched: { student_id: string; score: number }[] = [], unmatched: string[] = [];
  for (const g of grades) {
    if (g.points === null || g.points === undefined || !Number.isFinite(g.points)) continue;
    const id = g.email ? byEmail.get(g.email.trim().toLowerCase()) : undefined;
    if (!id) { if (g.email) unmatched.push(g.email); continue; }
    const score = homeworkMax && g.max && g.max > 0 && g.max !== homeworkMax ? Math.round((g.points / g.max) * homeworkMax * 100) / 100 : g.points;
    matched.push({ student_id: id, score });
  }
  return { matched, unmatched };
}
