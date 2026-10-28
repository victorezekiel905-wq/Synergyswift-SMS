/**
 * Canva Connect for "Open in Canva" (slides). Each teacher connects their own
 * Canva account (OAuth 2.0 authorization code with PKCE); the server stores
 * the tokens encrypted and imports a PowerPoint deck into the teacher's Canva,
 * returning the link that opens it in the Canva editor.
 *
 * Needs CANVA_CLIENT_ID and CANVA_CLIENT_SECRET from a Canva Connect
 * integration (canva.dev → Your integrations) with the scope
 * design:content:write and the redirect URL <APP_URL>/api/canva/callback.
 */
import { createHash, createCipheriv, createDecipheriv, randomBytes } from "crypto";

const API = "https://api.canva.com/rest/v1";
export const CANVA_SCOPES = "design:content:write design:meta:read";
export const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export const canvaConfigured = () => Boolean(process.env.CANVA_CLIENT_ID?.trim() && process.env.CANVA_CLIENT_SECRET?.trim());
const basic = () => "Basic " + Buffer.from(`${process.env.CANVA_CLIENT_ID!.trim()}:${process.env.CANVA_CLIENT_SECRET!.trim()}`).toString("base64");

// ---------------- PKCE and token sealing ----------------

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export function pkcePair() {
  const verifier = b64url(randomBytes(48));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()), state: b64url(randomBytes(24)) };
}

const sealKey = () => createHash("sha256").update(`canva-token:${process.env.CANVA_TOKEN_KEY?.trim() || process.env.CANVA_CLIENT_SECRET!.trim()}`).digest();
export function seal(text: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", sealKey(), iv);
  const enc = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return `v1.${b64url(iv)}.${b64url(c.getAuthTag())}.${b64url(enc)}`;
}
export function unseal(sealed: string): string {
  const [v, iv, tag, enc] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !enc) throw new Error("bad token");
  const from = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  const d = createDecipheriv("aes-256-gcm", sealKey(), from(iv));
  d.setAuthTag(from(tag));
  return Buffer.concat([d.update(from(enc)), d.final()]).toString("utf8");
}

export function authorizeUrl(p: { challenge: string; state: string; redirectUri: string }) {
  const q = new URLSearchParams({ code_challenge: p.challenge, code_challenge_method: "s256", scope: CANVA_SCOPES, response_type: "code",
    client_id: process.env.CANVA_CLIENT_ID!.trim(), state: p.state, redirect_uri: p.redirectUri });
  return `https://www.canva.com/api/oauth/authorize?${q.toString().replace(/\+/g, "%20")}`;
}

type TokenReply = { access_token: string; refresh_token: string; expires_in: number; scope?: string; error?: string; error_description?: string };

async function tokenRequest(form: Record<string, string>): Promise<TokenReply> {
  const res = await fetch(`${API}/oauth/token`, {
    method: "POST", headers: { Authorization: basic(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(), signal: AbortSignal.timeout(15_000)
  });
  const data = (await res.json().catch(() => ({}))) as TokenReply;
  if (!res.ok || !data.access_token) throw new Error(data.error_description || data.error || `Canva sign-in failed (${res.status})`);
  return data;
}

async function save(svc: any, userId: string, tenantId: string | null, t: TokenReply) {
  await svc.from("canva_connections").upsert({
    user_id: userId, tenant_id: tenantId, access_token: seal(t.access_token), refresh_token: seal(t.refresh_token),
    expires_at: new Date(Date.now() + Math.max(60, t.expires_in - 60) * 1000).toISOString(), scope: t.scope ?? null, updated_at: new Date().toISOString()
  }, { onConflict: "user_id" });
}

export async function finishConnect(svc: any, p: { code: string; verifier: string; redirectUri: string; userId: string; tenantId: string | null }) {
  const t = await tokenRequest({ grant_type: "authorization_code", code: p.code, code_verifier: p.verifier, redirect_uri: p.redirectUri });
  await save(svc, p.userId, p.tenantId, t);
}

/** A current access token for the teacher, refreshed (and the new single-use refresh token kept) when needed. Null when not connected. */
export async function accessToken(svc: any, userId: string): Promise<string | null> {
  const { data } = await svc.from("canva_connections").select("*").eq("user_id", userId).maybeSingle();
  if (!data) return null;
  if (Date.parse(data.expires_at) > Date.now()) return unseal(data.access_token);
  try {
    const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: unseal(data.refresh_token) });
    await save(svc, userId, data.tenant_id, t);
    return t.access_token;
  } catch {
    // The refresh token was used or revoked: the teacher connects again.
    await svc.from("canva_connections").delete().eq("user_id", userId);
    return null;
  }
}

type ImportJob = { id: string; status: "in_progress" | "success" | "failed"; result?: { designs?: { id: string; title?: string; urls?: { edit_url?: string; view_url?: string } }[] }; error?: { code: string; message: string } };

/** Imports a PowerPoint into the teacher's Canva and waits (up to ~50 s) for the design's edit link. */
export async function importDeck(token: string, title: string, pptx: Uint8Array): Promise<{ editUrl: string; designId: string }> {
  const meta = JSON.stringify({ title_base64: Buffer.from(title.slice(0, 50) || "Lesson slides", "utf8").toString("base64"), mime_type: PPTX });
  const res = await fetch(`${API}/imports`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream", "Import-Metadata": meta },
    body: new Blob([pptx as BlobPart], { type: "application/octet-stream" }), signal: AbortSignal.timeout(60_000)
  });
  const first = (await res.json().catch(() => ({}))) as { job?: ImportJob; message?: string };
  if (res.status === 401 || res.status === 403) throw new CanvaAuthError("Canva needs you to connect again.");
  if (!res.ok || !first.job) throw new Error(first.message || `Canva didn't accept the file (${res.status})`);
  let job = first.job;
  for (let i = 0; i < 25 && job.status === "in_progress"; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const r = await fetch(`${API}/imports/${encodeURIComponent(job.id)}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    const d = (await r.json().catch(() => ({}))) as { job?: ImportJob };
    if (d.job) job = d.job;
  }
  if (job.status === "failed") throw new Error(job.error?.message ?? "Canva couldn't import the slides.");
  const design = job.result?.designs?.[0];
  if (job.status !== "success" || !design?.urls?.edit_url) throw new Error("Canva is still importing. Look in your Canva account in a minute.");
  return { editUrl: design.urls.edit_url, designId: design.id };
}
export class CanvaAuthError extends Error {}
