/**
 * LTI 1.3 on the server: the platform signing key, the tools' keys, access
 * tokens for grade services and recording scores. Rules live in lti.ts.
 */
import { createPublicKey, type KeyObject } from "node:crypto";
import { newPlatformKey, signJwt, verifyJwt, decodeJwt, homeworkMark, type Score } from "./lti";
import { safeWebhookUrl } from "./open-api";

/** The active signing key, made on first use. */
export async function platformKey(svc: any): Promise<{ kid: string; private_pem: string; public_jwk: any }> {
  const { data } = await svc.from("lti_platform_keys").select("kid,private_pem,public_jwk").eq("active", true).order("created_at", { ascending: false }).limit(1);
  if (data?.[0]) return data[0];
  const k = newPlatformKey();
  await svc.from("lti_platform_keys").insert(k);
  const { data: again } = await svc.from("lti_platform_keys").select("kid,private_pem,public_jwk").eq("active", true).order("created_at", { ascending: true }).limit(1);
  return again?.[0] ?? k;
}

const jwksCache = new Map<string, { at: number; keys: any[] }>();
/** The tool's public key for a token it signed: its stored key, or the matching key from its JWKS address. */
export async function toolKey(tool: { jwks_url: string | null; public_key_pem: string | null }, token: string): Promise<KeyObject | string> {
  if (tool.public_key_pem) return tool.public_key_pem;
  if (!tool.jwks_url) throw new Error("the tool has no key set up");
  if (safeWebhookUrl(tool.jwks_url)) throw new Error("the tool's key address must be a public https site");
  const kid = decodeJwt(token)?.header.kid;
  let hit = jwksCache.get(tool.jwks_url);
  if (!hit || Date.now() - hit.at > 10 * 60_000 || (kid && !hit.keys.some(k => k.kid === kid))) {
    const r = await fetch(tool.jwks_url, { signal: AbortSignal.timeout(5000), redirect: "error" });
    if (!r.ok) throw new Error(`could not fetch the tool's keys (${r.status})`);
    const j = await r.json();
    hit = { at: Date.now(), keys: Array.isArray(j?.keys) ? j.keys : [] };
    jwksCache.set(tool.jwks_url, hit);
  }
  const jwk = hit.keys.find(k => (kid ? k.kid === kid : true) && k.kty === "RSA");
  if (!jwk) throw new Error("no matching key in the tool's JWKS");
  return createPublicKey({ key: jwk, format: "jwk" });
}

export const agsAudience = (base: string) => `${base}/api/lti/ags`;

/** A one-hour access token for a tool's grade-service calls. */
export async function issueAccessToken(svc: any, base: string, toolId: string, scope: string) {
  const k = await platformKey(svc);
  const now = Math.floor(Date.now() / 1000);
  return signJwt({ iss: base, aud: agsAudience(base), sub: toolId, scope, iat: now, exp: now + 3600 }, k.private_pem, k.kid);
}

/** The tool behind a grade-service request, if its token is ours, current, and has the scope. */
export async function toolFromAccessToken(svc: any, base: string, authHeader: string | null, scope: string): Promise<{ toolId: string } | string> {
  const tok = authHeader?.match(/^Bearer\s+(\S+)$/)?.[1];
  if (!tok) return "missing access token";
  const kid = decodeJwt(tok)?.header.kid;
  const { data: k } = await svc.from("lti_platform_keys").select("public_jwk").eq("kid", kid ?? "").maybeSingle();
  if (!k) return "unknown token key";
  const claims = verifyJwt(tok, k.public_jwk, { iss: base, aud: agsAudience(base) });
  if (typeof claims === "string") return claims;
  if (!String(claims.scope ?? "").split(" ").includes(scope)) return "token lacks the scope";
  return { toolId: claims.sub };
}

/**
 * Keeps a tool's score for a student, and when the tool is tied to homework
 * and the score is final, marks the homework, unless a teacher has already
 * marked it themselves.
 */
export async function recordScore(svc: any, link: { id: string; tenant_id: string; homework_id: string | null }, s: Score) {
  const { data: u } = await svc.from("users").select("id").eq("id", s.userId).eq("tenant_id", link.tenant_id).maybeSingle();
  if (!u) return "unknown userId";
  await svc.from("lti_scores").upsert({
    tenant_id: link.tenant_id, link_id: link.id, user_id: s.userId, score_given: s.scoreGiven, score_maximum: s.scoreMaximum,
    activity_progress: s.activityProgress, grading_progress: s.gradingProgress, comment: s.comment, tool_timestamp: s.timestamp, received_at: new Date().toISOString()
  }, { onConflict: "link_id,user_id" });
  if (!link.homework_id) return null;
  const [{ data: hw }, { data: st }] = await Promise.all([
    svc.from("homework").select("id,max_score,due_at").eq("id", link.homework_id).maybeSingle(),
    svc.from("students").select("id").eq("tenant_id", link.tenant_id).eq("user_id", s.userId).maybeSingle()
  ]);
  const mark = hw ? homeworkMark(s, hw.max_score === null ? null : Number(hw.max_score)) : null;
  if (!hw || !st || mark === null) return null;
  const { data: existing } = await svc.from("homework_submissions").select("id,marked_by").eq("homework_id", hw.id).eq("student_id", st.id).maybeSingle();
  if (existing?.marked_by) return null; // a teacher's mark stands
  const row = { score: mark, marked_at: new Date().toISOString(), feedback: s.comment ?? "Marked by the learning tool." };
  if (existing) await svc.from("homework_submissions").update(row).eq("id", existing.id);
  else await svc.from("homework_submissions").insert({ ...row, homework_id: hw.id, tenant_id: link.tenant_id, student_id: st.id, body: "Completed in the learning tool.", late: new Date(s.timestamp) > new Date(hw.due_at) });
  return null;
}
