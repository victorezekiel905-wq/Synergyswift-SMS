/**
 * LTI 1.3 platform rules: signed tokens (RS256), the launch claims sent to a
 * tool, checks on the tool's sign-in request and its token request, roles,
 * and scores sent back (Assignment and Grade Services). Pure and unit tested.
 */
import { createSign, createVerify, createPublicKey, generateKeyPairSync, randomUUID, type KeyObject, type JsonWebKey } from "node:crypto";

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const unb64 = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

export function signJwt(payload: Record<string, unknown>, privatePem: string, kid: string): string {
  const head = b64(JSON.stringify({ alg: "RS256", typ: "JWT", kid }));
  const body = b64(JSON.stringify(payload));
  const s = createSign("RSA-SHA256"); s.update(`${head}.${body}`);
  return `${head}.${body}.${b64(s.sign(privatePem))}`;
}

export function decodeJwt(token: string): { header: Record<string, any>; payload: Record<string, any> } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try { return { header: JSON.parse(unb64(parts[0]).toString()), payload: JSON.parse(unb64(parts[1]).toString()) }; } catch { return null; }
}

/** Checks an RS256 token's signature and times (with a minute's leeway), and optionally its issuer and audience. */
export function verifyJwt(token: string, key: KeyObject | string | JsonWebKey, opts: { iss?: string; aud?: string; nowSec?: number } = {}): Record<string, any> | string {
  const d = decodeJwt(token);
  if (!d) return "malformed token";
  if (d.header.alg !== "RS256") return "token must be signed with RS256";
  const [h, p, s] = token.split(".");
  let pub: KeyObject;
  try { pub = typeof key === "object" && "type" in key && (key as KeyObject).type ? (key as KeyObject) : createPublicKey(typeof key === "string" ? key : { key: key as JsonWebKey, format: "jwk" }); }
  catch { return "unreadable key"; }
  const v = createVerify("RSA-SHA256"); v.update(`${h}.${p}`);
  if (!v.verify(pub, unb64(s))) return "bad signature";
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  if (typeof d.payload.exp !== "number" || d.payload.exp < now - 60) return "token expired";
  if (typeof d.payload.iat === "number" && d.payload.iat > now + 60) return "token issued in the future";
  if (opts.iss && d.payload.iss !== opts.iss) return "wrong issuer";
  if (opts.aud) {
    const aud = Array.isArray(d.payload.aud) ? d.payload.aud : [d.payload.aud];
    if (!aud.includes(opts.aud)) return "wrong audience";
  }
  return d.payload;
}

/** A new RSA key for signing launches: its id, private key (PEM) and public key (JWK). */
export function newPlatformKey(): { kid: string; private_pem: string; public_jwk: JsonWebKey } {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = randomUUID();
  return { kid, private_pem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), public_jwk: { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" } };
}

// ---------------- claims ----------------

const C = "https://purl.imsglobal.org/spec/lti/claim/";
const V = "http://purl.imsglobal.org/vocab/lis/v2/";
export const AGS = {
  claim: "https://purl.imsglobal.org/spec/lti-ags/claim/endpoint",
  lineitem: "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem.readonly",
  score: "https://purl.imsglobal.org/spec/lti-ags/scope/score",
  result: "https://purl.imsglobal.org/spec/lti-ags/scope/result.readonly"
};

/** LTI role URIs for the school's roles. */
export function ltiRoles(roles: Iterable<string>): string[] {
  const r = new Set(roles), out = new Set<string>();
  if (r.has("student")) out.add(`${V}membership#Learner`).add(`${V}institution/person#Student`);
  if (r.has("teacher")) out.add(`${V}membership#Instructor`).add(`${V}institution/person#Faculty`);
  if (["school_admin", "principal", "platform_admin", "it_admin"].some(x => r.has(x))) out.add(`${V}institution/person#Administrator`).add(`${V}membership#Instructor`);
  if (!out.size) out.add(`${V}institution/person#Staff`);
  return [...out];
}

export type LaunchInput = {
  issuer: string; clientId: string; deploymentId: string; nonce: string; nowSec: number;
  user: { id: string; name?: string | null; given?: string | null; family?: string | null; email?: string | null; roles: string[] };
  link: { id: string; title: string; targetLinkUri: string; custom: Record<string, string> };
  context?: { id: string; label: string; title: string } | null;
  platform: { guid: string; name: string };
  returnUrl: string; locale?: string;
  ags?: { lineitem: string; lineitems: string } | null;
};

/** The signed claims of a resource-link launch. Name and email only when the school chose to share them. */
export function launchClaims(i: LaunchInput): Record<string, unknown> {
  return {
    iss: i.issuer, aud: i.clientId, sub: i.user.id, iat: i.nowSec, exp: i.nowSec + 300, nonce: i.nonce, azp: i.clientId,
    ...(i.user.name ? { name: i.user.name, given_name: i.user.given ?? undefined, family_name: i.user.family ?? undefined } : {}),
    ...(i.user.email ? { email: i.user.email } : {}),
    locale: i.locale ?? "en",
    [`${C}message_type`]: "LtiResourceLinkRequest",
    [`${C}version`]: "1.3.0",
    [`${C}deployment_id`]: i.deploymentId,
    [`${C}target_link_uri`]: i.link.targetLinkUri,
    [`${C}resource_link`]: { id: i.link.id, title: i.link.title },
    [`${C}roles`]: ltiRoles(i.user.roles),
    ...(i.context ? { [`${C}context`]: { id: i.context.id, label: i.context.label, title: i.context.title, type: ["http://purl.imsglobal.org/vocab/lis/v2/course#CourseOffering"] } } : {}),
    [`${C}tool_platform`]: { guid: i.platform.guid, name: i.platform.name, product_family_code: "educlass-fusion", version: "1" },
    [`${C}launch_presentation`]: { document_target: "window", return_url: i.returnUrl, locale: i.locale ?? "en" },
    [`${C}custom`]: i.link.custom,
    ...(i.ags ? { [AGS.claim]: { scope: [AGS.lineitem, AGS.score, AGS.result], lineitem: i.ags.lineitem, lineitems: i.ags.lineitems } } : {})
  };
}

export type AuthRequest = { scope?: string | null; response_type?: string | null; response_mode?: string | null; prompt?: string | null; client_id?: string | null; redirect_uri?: string | null; login_hint?: string | null; nonce?: string | null };

/** Problems with a tool's OpenID Connect sign-in request (null when it may go ahead). */
export function checkAuthRequest(p: AuthRequest, tool: { client_id: string; redirect_uris: string[]; target_link_uri: string }, launch: { created_at: string; used_at: string | null } | null, nowMs: number): string | null {
  if (p.scope !== "openid") return "scope must be openid";
  if (p.response_type !== "id_token") return "response_type must be id_token";
  if (p.response_mode !== "form_post") return "response_mode must be form_post";
  if (p.prompt && p.prompt !== "none") return "prompt must be none";
  if (!p.nonce) return "nonce is required";
  if (p.client_id !== tool.client_id) return "unknown client_id";
  const allowed = tool.redirect_uris.length ? tool.redirect_uris : [tool.target_link_uri];
  if (!p.redirect_uri || !allowed.includes(p.redirect_uri)) return "redirect_uri is not registered for this tool";
  if (!launch) return "unknown or expired launch";
  if (launch.used_at) return "this launch was already used";
  if (nowMs - new Date(launch.created_at).getTime() > 5 * 60_000) return "the launch expired; open the tool again";
  return null;
}

/** Problems with a tool's signed request for an access token (client credentials). */
export function checkClientAssertion(claims: Record<string, any>, clientId: string, tokenUrl: string): string | null {
  if (claims.iss !== clientId || claims.sub !== clientId) return "iss and sub must be the tool's client_id";
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(tokenUrl)) return "aud must be the token endpoint";
  if (!claims.jti) return "jti is required";
  return null;
}

export type Score = { userId: string; scoreGiven: number | null; scoreMaximum: number | null; activityProgress: string; gradingProgress: string; comment: string | null; timestamp: string };
const ACTIVITY = ["Initialized", "Started", "InProgress", "Submitted", "Completed"];
const GRADING = ["FullyGraded", "Pending", "PendingManual", "Failed", "NotReady"];

/** Reads a score sent back by a tool. */
export function parseScore(b: any): Score | string {
  if (!b || typeof b !== "object") return "send a JSON score";
  if (typeof b.userId !== "string" || !b.userId) return "userId is required";
  if (!ACTIVITY.includes(b.activityProgress)) return "activityProgress is not valid";
  if (!GRADING.includes(b.gradingProgress)) return "gradingProgress is not valid";
  if (typeof b.timestamp !== "string" || Number.isNaN(Date.parse(b.timestamp))) return "timestamp is required";
  const given = b.scoreGiven === undefined || b.scoreGiven === null ? null : Number(b.scoreGiven);
  const max = b.scoreMaximum === undefined || b.scoreMaximum === null ? null : Number(b.scoreMaximum);
  if (given !== null && (!Number.isFinite(given) || given < 0)) return "scoreGiven must be a number of 0 or more";
  if (given !== null && (max === null || !Number.isFinite(max) || max <= 0)) return "scoreMaximum is required with scoreGiven";
  return { userId: b.userId, scoreGiven: given, scoreMaximum: max, activityProgress: b.activityProgress, gradingProgress: b.gradingProgress, comment: typeof b.comment === "string" ? b.comment.slice(0, 2000) : null, timestamp: b.timestamp };
}

/** The homework mark for a tool's score: scaled to the homework's maximum (or kept as a percentage). */
export function homeworkMark(s: Score, homeworkMax: number | null): number | null {
  if (s.scoreGiven === null || !s.scoreMaximum || s.gradingProgress !== "FullyGraded") return null;
  const share = Math.min(1, s.scoreGiven / s.scoreMaximum);
  return Math.round(share * (homeworkMax && homeworkMax > 0 ? homeworkMax : 100) * 100) / 100;
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
/** A page that posts a form at once (how LTI hands the browser between platform and tool). */
export function autoPostPage(action: string, fields: Record<string, string>, title = "Opening…"): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>`
    + `<body style="font-family:system-ui,sans-serif;text-align:center;padding:40px"><form id="f" method="post" action="${esc(action)}">`
    + Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join("")
    + `<p>${esc(title)}</p><noscript><button type="submit">Continue</button></noscript></form><script>document.getElementById("f").submit()</script></body></html>`;
}
