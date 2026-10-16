/**
 * Google Classroom and Microsoft Teams / OneNote on the server: signing in,
 * keeping tokens fresh, and the calls to each service. Rules in classroom-sync.ts.
 *
 * Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (a Google Cloud OAuth client with
 * the Classroom API on) and/or MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET
 * (an Entra ID app; MICROSOFT_TENANT defaults to "common").
 */
import { PROVIDERS, type Provider, type Homework, googleCourseWork, teamsAssignment } from "./classroom-sync";

const env = (k: string) => { const v = process.env[k]; return v && !v.includes("replace") ? v : undefined; };

export function providerConfig(p: Provider) {
  const id = env(p === "google" ? "GOOGLE_CLIENT_ID" : "MICROSOFT_CLIENT_ID"), secret = env(p === "google" ? "GOOGLE_CLIENT_SECRET" : "MICROSOFT_CLIENT_SECRET");
  return id && secret ? { clientId: id, clientSecret: secret, msTenant: env("MICROSOFT_TENANT") ?? "common" } : null;
}
export const stateSecret = () => env("OAUTH_STATE_SECRET") ?? env("SUPABASE_SERVICE_ROLE_KEY") ?? env("CRON_SECRET") ?? "";

type Tokens = { access_token: string; refresh_token?: string; expires_in?: number; scope?: string; id_token?: string };

async function tokenRequest(p: Provider, body: Record<string, string>): Promise<Tokens> {
  const cfg = providerConfig(p)!;
  const r = await fetch(PROVIDERS[p].tokenUrl(cfg.msTenant), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...body }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`${PROVIDERS[p].label} sign-in failed: ${j.error_description ?? j.error ?? r.status}`);
  return j;
}

/** Finishes the sign-in: swaps the code for tokens and keeps them for this teacher. */
export async function connect(svc: any, tenantId: string, userId: string, p: Provider, code: string, redirectUri: string) {
  const t = await tokenRequest(p, { grant_type: "authorization_code", code, redirect_uri: redirectUri, ...(p === "microsoft" ? { scope: PROVIDERS.microsoft.scopes.join(" ") } : {}) });
  let email: string | null = null;
  try { const c = JSON.parse(Buffer.from((t.id_token ?? "").split(".")[1] ?? "", "base64url").toString()); email = c.email ?? c.preferred_username ?? null; } catch { /* no id token */ }
  const { data: old } = await svc.from("oauth_connections").select("refresh_token").eq("user_id", userId).eq("provider", p).maybeSingle();
  const { error } = await svc.from("oauth_connections").upsert({
    tenant_id: tenantId, user_id: userId, provider: p, account_email: email, access_token: t.access_token, refresh_token: t.refresh_token ?? old?.refresh_token ?? null,
    expires_at: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(), scopes: t.scope ?? null, updated_at: new Date().toISOString()
  }, { onConflict: "user_id,provider" });
  if (error) throw new Error(error.message);
  return email;
}

async function accessToken(svc: any, userId: string, p: Provider): Promise<string> {
  const { data: c } = await svc.from("oauth_connections").select("id,access_token,refresh_token,expires_at").eq("user_id", userId).eq("provider", p).maybeSingle();
  if (!c) throw new Error(`Connect your ${PROVIDERS[p].label} account first.`);
  if (c.expires_at && new Date(c.expires_at).getTime() - Date.now() > 120_000) return c.access_token;
  if (!c.refresh_token) throw new Error(`Your ${PROVIDERS[p].label} sign-in has expired; connect again.`);
  const t = await tokenRequest(p, { grant_type: "refresh_token", refresh_token: c.refresh_token, ...(p === "microsoft" ? { scope: PROVIDERS.microsoft.scopes.join(" ") } : {}) });
  await svc.from("oauth_connections").update({ access_token: t.access_token, refresh_token: t.refresh_token ?? c.refresh_token,
    expires_at: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(), updated_at: new Date().toISOString() }).eq("id", c.id);
  return t.access_token;
}

async function call(svc: any, userId: string, p: Provider, url: string, init: RequestInit = {}): Promise<any> {
  const tok = await accessToken(svc, userId, p);
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${tok}`, ...(init.body && typeof init.body === "string" && !(init.headers as any)?.["Content-Type"] ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) }, signal: AbortSignal.timeout(15000) });
  if (r.status === 204) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${PROVIDERS[p].label}: ${j?.error?.message ?? j?.error_description ?? `HTTP ${r.status}`}`);
  return j;
}

// ---------------- Google Classroom ----------------
const GC = "https://classroom.googleapis.com/v1";

export async function googleCourses(svc: any, userId: string) {
  const j = await call(svc, userId, "google", `${GC}/courses?teacherId=me&courseStates=ACTIVE&pageSize=100`);
  return (j.courses ?? []).map((c: any) => ({ id: c.id, name: [c.name, c.section].filter(Boolean).join(" · "), url: c.alternateLink ?? null }));
}
export async function googlePush(svc: any, userId: string, courseId: string, h: Homework) {
  const j = await call(svc, userId, "google", `${GC}/courses/${encodeURIComponent(courseId)}/courseWork`, { method: "POST", body: JSON.stringify(googleCourseWork(h)) });
  return { id: j.id as string, url: (j.alternateLink ?? null) as string | null };
}
export async function googleGrades(svc: any, userId: string, courseId: string, workId: string) {
  const base = `${GC}/courses/${encodeURIComponent(courseId)}`;
  const work = await call(svc, userId, "google", `${base}/courseWork/${encodeURIComponent(workId)}`);
  const emails = new Map<string, string>();
  let page = "";
  do {
    const j = await call(svc, userId, "google", `${base}/students?pageSize=100${page ? `&pageToken=${page}` : ""}`);
    for (const s of j.students ?? []) emails.set(s.userId, s.profile?.emailAddress ?? null);
    page = j.nextPageToken ?? "";
  } while (page);
  const out: { email: string | null; points: number | null; max: number | null }[] = [];
  page = "";
  do {
    const j = await call(svc, userId, "google", `${base}/courseWork/${encodeURIComponent(workId)}/studentSubmissions?pageSize=100${page ? `&pageToken=${page}` : ""}`);
    for (const s of j.studentSubmissions ?? []) out.push({ email: emails.get(s.userId) ?? null, points: s.assignedGrade ?? null, max: work.maxPoints ?? null });
    page = j.nextPageToken ?? "";
  } while (page);
  return out;
}

// ---------------- Microsoft Teams and OneNote ----------------
const G = "https://graph.microsoft.com/v1.0";

export async function teamsClasses(svc: any, userId: string) {
  const j = await call(svc, userId, "microsoft", `${G}/education/me/classes?$select=id,displayName,description`);
  return (j.value ?? []).map((c: any) => ({ id: c.id, name: c.displayName, url: null }));
}
export async function teamsPush(svc: any, userId: string, classId: string, h: Homework) {
  const a = await call(svc, userId, "microsoft", `${G}/education/classes/${encodeURIComponent(classId)}/assignments`, { method: "POST", body: JSON.stringify(teamsAssignment(h)) });
  await call(svc, userId, "microsoft", `${G}/education/classes/${encodeURIComponent(classId)}/assignments/${encodeURIComponent(a.id)}/publish`, { method: "POST" });
  return { id: a.id as string, url: (a.webUrl ?? null) as string | null };
}
export async function teamsGrades(svc: any, userId: string, classId: string, assignmentId: string) {
  const base = `${G}/education/classes/${encodeURIComponent(classId)}/assignments/${encodeURIComponent(assignmentId)}`;
  const a = await call(svc, userId, "microsoft", base);
  const subs = await call(svc, userId, "microsoft", `${base}/submissions?$expand=outcomes`);
  const out: { email: string | null; points: number | null; max: number | null }[] = [];
  for (const s of (subs.value ?? []).slice(0, 300)) {
    const uid = s.recipient?.userId ?? s.submittedBy?.user?.id;
    const pts = (s.outcomes ?? []).find((o: any) => o["@odata.type"] === "#microsoft.graph.educationPointsOutcome")?.points?.points ?? null;
    if (pts === null || !uid) continue;
    const u = await call(svc, userId, "microsoft", `${G}/users/${encodeURIComponent(uid)}?$select=mail,userPrincipalName`).catch(() => null);
    out.push({ email: u?.mail ?? u?.userPrincipalName ?? null, points: pts, max: a.grading?.maxPoints ?? null });
  }
  return out;
}
export async function oneNoteSend(svc: any, userId: string, html: string): Promise<string | null> {
  const j = await call(svc, userId, "microsoft", `${G}/me/onenote/pages`, { method: "POST", body: html, headers: { "Content-Type": "text/html" } });
  return j?.links?.oneNoteWebUrl?.href ?? null;
}
