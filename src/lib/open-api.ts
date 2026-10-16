/**
 * The open API's rules: API keys and scopes, paging, signed webhooks with
 * retries, a small GraphQL reader (queries with fields, arguments and
 * variables) and RSS for the school website. Pure and unit tested.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SCOPES = [
  { id: "students:read", label: "Students: names, classes, admission numbers" },
  { id: "classes:read", label: "Classes and subjects" },
  { id: "staff:read", label: "Staff directory" },
  { id: "attendance:read", label: "Attendance" },
  { id: "results:read", label: "Published results" },
  { id: "fees:read", label: "Invoices and balances" },
  { id: "payments:read", label: "Payments received" },
  { id: "applications:read", label: "Admissions applications" },
  { id: "applications:write", label: "Send in applications (e.g. from the school website)" },
  { id: "events:read", label: "Events shown on the website" },
  { id: "news:read", label: "News posts" }
] as const;
export type Scope = (typeof SCOPES)[number]["id"];

export const EVENTS = ["student.created", "student.updated", "application.created", "application.status_changed", "payment.received", "invoice.created", "result.published", "news.published"] as const;

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
/** A new API key (shown once), its recognisable prefix and the hash that is stored. */
export function newKey(): { key: string; prefix: string; hash: string } {
  const bytes = randomBytes(32);
  let body = "";
  for (const b of bytes) body += B62[b % 62];
  const key = `ssk_${body}`;
  return { key, prefix: key.slice(0, 12), hash: hashKey(key) };
}
export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

/** The key from "Authorization: Bearer …" (or X-Api-Key). */
export function keyFrom(headers: { get(name: string): string | null }): string | null {
  const auth = headers.get("authorization");
  const m = auth?.match(/^Bearer\s+(ssk_[0-9A-Za-z]{20,})$/);
  if (m) return m[1];
  const x = headers.get("x-api-key");
  return x && /^ssk_[0-9A-Za-z]{20,}$/.test(x) ? x : null;
}
export const hasScope = (scopes: string[], need: string) => scopes.includes(need);

/** limit (1–200, default 50) and offset from the query string. */
export function paging(p: URLSearchParams): { limit: number; offset: number } {
  const limit = Math.min(200, Math.max(1, Number.parseInt(p.get("limit") ?? "50", 10) || 50));
  const offset = Math.max(0, Number.parseInt(p.get("offset") ?? "0", 10) || 0);
  return { limit, offset };
}

// ---------------- webhooks ----------------

/** "t=<unix seconds>,v1=<hex HMAC-SHA256 of '<t>.<body>'>", sent as X-Webhook-Signature. */
export function signPayload(secret: string, body: string, nowSec = Math.floor(Date.now() / 1000)): string {
  return `t=${nowSec},v1=${createHmac("sha256", secret).update(`${nowSec}.${body}`).digest("hex")}`;
}
/** For receivers (and tests): checks the signature and that it is recent (5 minutes by default). */
export function verifySignature(secret: string, header: string, body: string, nowSec = Math.floor(Date.now() / 1000), toleranceSec = 300): boolean {
  const parts = Object.fromEntries(header.split(",").map(p => p.split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1 || Math.abs(nowSec - t) > toleranceSec) return false;
  const want = createHmac("sha256", secret).update(`${t}.${body}`).digest();
  const got = Buffer.from(parts.v1, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}
/** Minutes to wait before the next try; null when it is time to give up (after 8 tries, about a day). */
export function retryIn(attempts: number): number | null {
  const steps = [1, 5, 15, 60, 180, 360, 720];
  return attempts >= 8 ? null : steps[Math.max(0, Math.min(steps.length - 1, attempts - 1))];
}
export const MAX_FAILURES = 20;

// ---------------- GraphQL (queries only) ----------------

export type Value = string | number | boolean | null | Value[];
export type Field = { name: string; alias: string; args: Record<string, Value>; fields: Field[] };

/**
 * Reads a GraphQL query: one operation of fields, with aliases, arguments
 * (strings, numbers, booleans, null, lists, enums and $variables) and nested
 * selections. Fragments, directives and mutations are not supported.
 */
export function parseGraphQL(src: string, variables: Record<string, unknown> = {}): Field[] {
  const tokens = tokenize(src);
  let i = 0;
  const peek = () => tokens[i], next = () => tokens[i++];
  const expect = (v: string) => { const t = next(); if (t !== v) throw new Error(`expected "${v}" but found "${t ?? "end"}"`); };
  if (peek() === "mutation" || peek() === "subscription") throw new Error("only queries are supported");
  if (peek() === "query") {
    next();
    if (peek() && /^[A-Za-z_]/.test(peek()!) ) next(); // operation name
    if (peek() === "(") { // variable definitions: skipped, values come from `variables`
      let depth = 0;
      do { const t = next(); if (t === "(") depth++; if (t === ")") depth--; if (t === undefined) throw new Error("unclosed variable list"); } while (depth > 0);
    }
  }
  const selection = (): Field[] => {
    expect("{");
    const out: Field[] = [];
    while (peek() !== "}") {
      if (peek() === undefined) throw new Error("unclosed {");
      if (peek() === "..." || peek()?.startsWith("@")) throw new Error("fragments and directives are not supported");
      let name = next()!;
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`unexpected "${name}"`);
      let alias = name;
      if (peek() === ":") { next(); alias = name; name = next()!; }
      const args: Record<string, Value> = {};
      if (peek() === "(") {
        next();
        while (peek() !== ")") {
          const k = next()!; expect(":");
          args[k] = value();
          if (peek() === ",") next();
        }
        next();
      }
      out.push({ name, alias, args, fields: peek() === "{" ? selection() : [] });
      if (peek() === ",") next();
    }
    next();
    return out;
  };
  const value = (): Value => {
    const t = next();
    if (t === undefined) throw new Error("missing value");
    if (t === "[") { const arr: Value[] = []; while (peek() !== "]") { arr.push(value()); if (peek() === ",") next(); if (peek() === undefined) throw new Error("unclosed ["); } next(); return arr; }
    if (t.startsWith("$")) { const v = variables[t.slice(1)]; if (v === undefined) throw new Error(`variable ${t} was not given`); return v as Value; }
    if (t.startsWith('"')) return JSON.parse(t);
    if (t === "true" || t === "false") return t === "true";
    if (t === "null") return null;
    if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(t)) return Number(t);
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) return t; // enum
    throw new Error(`unexpected value "${t}"`);
  };
  const fields = selection();
  if (i < tokens.length) throw new Error("only one operation is supported");
  return fields;
}

function tokenize(src: string): string[] {
  const out: string[] = [];
  const re = /\s+|,|#[^\n]*|("(?:[^"\\]|\\.)*")|(\.\.\.)|([{}():[\]!=])|(\$?[A-Za-z_][A-Za-z0-9_]*)|(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)|(@[A-Za-z_]+)|(.)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[0] === ",") { out.push(","); continue; }
    const tok = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[6];
    if (m[7] !== undefined) throw new Error(`unexpected character "${m[7]}"`);
    if (tok !== undefined) out.push(tok);
  }
  return out;
}

/** Keeps only the asked-for fields (recursively), under their aliases. */
export function project(data: unknown, fields: Field[]): unknown {
  if (!fields.length || data === null || data === undefined) return data ?? null;
  if (Array.isArray(data)) return data.map(d => project(d, fields));
  if (typeof data !== "object") return data;
  const o = data as Record<string, unknown>;
  return Object.fromEntries(fields.map(f => [f.alias, f.name === "__typename" ? "Object" : project(o[f.name] ?? null, f.fields)]));
}

// ---------------- RSS ----------------

const x = (s: string) => s.replace(/[<>&'"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]!));
export function rss(channel: { title: string; link: string; description: string }, items: { title: string; link: string; summary: string | null; published_at: string; guid: string }[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${x(channel.title)}</title><link>${x(channel.link)}</link><description>${x(channel.description)}</description>${
    items.map(i => `<item><title>${x(i.title)}</title><link>${x(i.link)}</link><guid isPermaLink="false">${x(i.guid)}</guid><pubDate>${new Date(i.published_at).toUTCString()}</pubDate>${i.summary ? `<description>${x(i.summary)}</description>` : ""}</item>`).join("")
  }</channel></rss>`;
}

/** A web-safe slug from a title. */
export function slugify(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "post";
}

/**
 * Webhook addresses must be public https sites: not this machine or a private
 * network (so a key holder cannot make the server call internal services).
 */
export function safeWebhookUrl(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return "not a valid address"; }
  if (u.protocol !== "https:") return "use an https:// address";
  if (u.username || u.password) return "leave passwords out of the address";
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".") && !h.includes(":")) return "use a public address";
  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224) return "use a public address";
  }
  if (h.includes(":") && (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80") || h === "::")) return "use a public address";
  return null;
}
