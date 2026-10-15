/**
 * Content packages: SCORM 1.2 / 2004, xAPI (Tin Can), H5P and plain HTML.
 * Pure helpers (unit tested): reading manifests, safe zip paths, launch
 * tokens, SCORM status and time, xAPI outcomes, and the SCORM runtime that
 * is placed in each package page.
 *
 * Packages are served from /pkg/<token>/… with a sandbox policy, so their
 * scripts run in an isolated origin and never see the school's session. The
 * SCORM runtime answers the package from values loaded with the page and
 * sends changes to the player page, which saves them.
 */
import { createHmac, timingSafeEqual } from "crypto";

export type PackageKind = "scorm12" | "scorm2004" | "xapi" | "h5p" | "html";
export const KIND_LABEL: Record<PackageKind, string> = { scorm12: "SCORM 1.2", scorm2004: "SCORM 2004", xapi: "xAPI (Tin Can)", h5p: "H5P", html: "Web page" };

// ---------------- zip paths ----------------

/** A safe relative path inside a package, or null for anything to skip or refuse. */
export function safeZipPath(name: string): string | null {
  const p = name.replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (!p || p.endsWith("/") || p.startsWith("/") || /^[a-z]:/i.test(p)) return null;
  const parts = p.split("/");
  if (parts.some(x => x === ".." || x === "." || x === "")) return null;
  if (parts[0] === "__MACOSX" || parts.some(x => x === ".DS_Store" || x === "Thumbs.db")) return null;
  if (/[\u0000-\u001f]/.test(p) || p.length > 400) return null;
  return p;
}

/** If every file sits inside one top folder (a zipped folder), that folder's name plus "/". */
export function commonRoot(paths: string[]): string {
  if (!paths.length) return "";
  const first = paths[0].split("/")[0];
  return paths.every(p => p.includes("/") && p.split("/")[0] === first) ? `${first}/` : "";
}

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8", json: "application/json; charset=utf-8", xml: "application/xml; charset=utf-8", xsd: "application/xml; charset=utf-8",
  txt: "text/plain; charset=utf-8", vtt: "text/vtt; charset=utf-8", csv: "text/csv; charset=utf-8",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp", ico: "image/x-icon", bmp: "image/bmp",
  mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", weba: "audio/webm",
  mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", ogv: "video/ogg",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", eot: "application/vnd.ms-fontobject",
  pdf: "application/pdf", wasm: "application/wasm", swf: "application/octet-stream"
};
export function mimeFor(path: string): string {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}
export const isHtml = (path: string) => /\.html?$/i.test(path);

// ---------------- manifests ----------------

const decode = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").trim();
const attr = (tag: string, name: string) => {
  const m = tag.match(new RegExp(`(?:^|\\s)(?:[\\w-]+:)?${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  return m ? decode(m[2] ?? m[3] ?? "") : null;
};
const el = (name: string) => `<(?:[\\w-]+:)?${name}\\b`;
const close = (name: string) => `</(?:[\\w-]+:)?${name}\\s*>`;
/** Every element with this local name: its opening tag and inner text. */
function elements(xml: string, name: string): { tag: string; inner: string }[] {
  const re = new RegExp(`(${el(name)}[^>]*?)(?:/>|>([\\s\\S]*?)${close(name)})`, "gi");
  const out: { tag: string; inner: string }[] = [];
  for (const m of xml.matchAll(re)) out.push({ tag: m[1], inner: m[2] ?? "" });
  return out;
}
const firstText = (xml: string, name: string) => { const e = elements(xml, name)[0]; return e ? decode(e.inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")) : null; };
const joinPath = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join("").replace(/\/{2,}/g, "/").replace(/^\.\//, "");

export type DetectedPackage = { kind: PackageKind; launch: string; title: string | null; mastery: number | null; meta: Record<string, unknown> };

/** SCORM 1.2 or 2004 from imsmanifest.xml. */
export function readScormManifest(xml: string): DetectedPackage | null {
  if (!new RegExp(el("manifest"), "i").test(xml)) return null;
  const schemaVersion = firstText(xml, "schemaversion") ?? "";
  const is2004 = /2004|CAM\s*1\.3|1\.3/i.test(schemaVersion) || /adlcp_v1p3|imsss|adlseq/i.test(xml);
  const orgs = elements(xml, "organizations")[0];
  const defaultOrg = orgs ? attr(orgs.tag, "default") : null;
  const orgList = elements(orgs?.inner ?? xml, "organization");
  const org = orgList.find(o => attr(o.tag, "identifier") === defaultOrg) ?? orgList[0];
  const resourcesEl = elements(xml, "resources")[0];
  const resBase = resourcesEl ? attr(resourcesEl.tag, "base") : null;
  const resources = elements(resourcesEl?.inner ?? xml, "resource");
  const items = org ? elements(org.inner, "item") : [];
  // The first item that points at a resource with a launch file.
  let launch: string | null = null, mastery: number | null = null;
  for (const it of items) {
    const ref = attr(it.tag, "identifierref");
    if (!ref) continue;
    const res = resources.find(r => attr(r.tag, "identifier") === ref);
    const href = res ? attr(res.tag, "href") : null;
    if (!href) continue;
    const params = attr(it.tag, "parameters");
    launch = joinPath(resBase, res ? attr(res.tag, "base") : null, href) + (params ? (params.startsWith("?") || params.startsWith("#") ? params : `?${params}`) : "");
    const ms = firstText(it.inner, "masteryscore");
    if (ms && Number.isFinite(Number(ms))) mastery = Number(ms);
    const min = firstText(it.inner, "minNormalizedMeasure");
    if (mastery === null && min && Number.isFinite(Number(min))) mastery = Math.round(Number(min) * 100);
    break;
  }
  if (!launch) {
    const res = resources.find(r => attr(r.tag, "href"));
    if (res) launch = joinPath(resBase, attr(res.tag, "base"), attr(res.tag, "href"));
  }
  if (!launch) return null;
  const title = (org ? firstText(org.inner.replace(new RegExp(`${el("item")}[\\s\\S]*`, "i"), ""), "title") : null) ?? firstText(xml, "title");
  return { kind: is2004 ? "scorm2004" : "scorm12", launch, title, mastery, meta: { identifier: attr(xml.match(new RegExp(`${el("manifest")}[^>]*`, "i"))?.[0] ?? "", "identifier"), schema_version: schemaVersion || null, items: items.length } };
}

/** xAPI package from tincan.xml. */
export function readTincan(xml: string): DetectedPackage | null {
  const acts = elements(xml, "activity");
  const act = acts.find(a => /launch/i.test(a.inner)) ?? acts[0];
  if (!act) return null;
  const launch = firstText(act.inner, "launch");
  const id = attr(act.tag, "id");
  if (!launch || !id) return null;
  return { kind: "xapi", launch: launch.replace(/^\.\//, ""), title: firstText(act.inner, "name"), mastery: null, meta: { activity_id: id, activity_type: attr(act.tag, "type") } };
}

/** H5P package from h5p.json. */
export function readH5pJson(json: string): DetectedPackage | null {
  try {
    const j = JSON.parse(json.replace(/^﻿/, ""));
    if (!j || typeof j !== "object" || !j.mainLibrary) return null;
    return { kind: "h5p", launch: "__h5p", title: typeof j.title === "string" ? j.title : null, mastery: null,
      meta: { main_library: j.mainLibrary, libraries: Array.isArray(j.preloadedDependencies) ? j.preloadedDependencies.length : 0 } };
  } catch { return null; }
}

/**
 * Works out what a package is from its file list and a reader for small text
 * files (paths relative to the package root).
 */
export async function detectPackage(paths: string[], read: (p: string) => Promise<string | null>): Promise<DetectedPackage | { error: string }> {
  const has = new Set(paths);
  if (has.has("imsmanifest.xml")) {
    const r = readScormManifest((await read("imsmanifest.xml")) ?? "");
    if (!r) return { error: "the SCORM manifest (imsmanifest.xml) has no launch page" };
    return has.has(r.launch.split(/[?#]/)[0]) ? r : { error: `the SCORM launch page ${r.launch} is missing from the package` };
  }
  if (has.has("tincan.xml")) {
    const r = readTincan((await read("tincan.xml")) ?? "");
    if (!r) return { error: "tincan.xml has no activity with a launch page" };
    return has.has(r.launch.split(/[?#]/)[0]) ? r : { error: `the xAPI launch page ${r.launch} is missing from the package` };
  }
  if (has.has("h5p.json")) {
    const r = readH5pJson((await read("h5p.json")) ?? "");
    if (!r) return { error: "h5p.json could not be read" };
    if (!has.has("content/content.json")) return { error: "this H5P file has no content/content.json" };
    return r;
  }
  const index = ["index.html", "index.htm", "story.html", "start.html"].find(p => has.has(p)) ?? paths.filter(isHtml).sort((a, b) => a.split("/").length - b.split("/").length)[0];
  if (index) return { kind: "html", launch: index, title: null, mastery: null, meta: {} };
  return { error: "no SCORM manifest, tincan.xml, h5p.json or HTML page was found in the file" };
}

// ---------------- launch tokens ----------------

export type ContentToken = { t: string; p: string; u: string; a: string | null; k: PackageKind; e: number };
const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function signToken(payload: ContentToken, key: Buffer): string {
  const body = b64u(JSON.stringify(payload));
  return `${body}.${createHmac("sha256", key).update(body).digest().subarray(0, 18).toString("base64url")}`;
}
/** With allowExpired, an expired but genuine token is accepted (progress saved offline, sent later by the same signed-in user). */
export function verifyToken(token: string, key: Buffer, now = Date.now(), allowExpired = false): ContentToken | null {
  const [body, sig] = token.split(".");
  if (!body || !sig || token.length > 600) return null;
  const want = createHmac("sha256", key).update(body).digest().subarray(0, 18);
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as ContentToken;
    return p && typeof p.e === "number" && (allowExpired || p.e * 1000 > now) ? p : null;
  } catch { return null; }
}

// ---------------- SCORM ----------------

/** "0000:12:30.5" (SCORM 1.2) to seconds. */
export function scorm12Seconds(t: string | null | undefined): number {
  const m = String(t ?? "").match(/^(\d{1,4}):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
  return m ? Math.round(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) : 0;
}
/** ISO 8601 duration "PT1H2M3.5S" (SCORM 2004, xAPI) to seconds. */
export function isoSeconds(t: string | null | undefined): number {
  const m = String(t ?? "").match(/^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  if (!m) return 0;
  const n = (i: number) => Number(m[i] ?? 0);
  return Math.round(n(1) * 31536000 + n(2) * 2592000 + n(3) * 604800 + n(4) * 86400 + n(5) * 3600 + n(6) * 60 + n(7));
}
export function secondsTo12(s: number): string {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return `${String(h).padStart(4, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
export function secondsToIso(s: number): string {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return `PT${h}H${m}M${sec}S`;
}

export type AttemptStatus = "not_attempted" | "incomplete" | "completed" | "passed" | "failed";
const RANK: Record<AttemptStatus, number> = { not_attempted: 0, incomplete: 1, failed: 2, completed: 3, passed: 4 };
/** Never go backwards: a passed package stays passed if a later visit says "incomplete". */
export function bestStatus(a: AttemptStatus, b: AttemptStatus): AttemptStatus {
  return RANK[b] > RANK[a] ? b : a;
}

const pct = (raw: string | undefined, min: string | undefined, max: string | undefined): number | null => {
  const r = Number(raw);
  if (raw === undefined || raw === "" || !Number.isFinite(r)) return null;
  const lo = min !== undefined && min !== "" && Number.isFinite(Number(min)) ? Number(min) : 0;
  const hi = max !== undefined && max !== "" && Number.isFinite(Number(max)) ? Number(max) : 100;
  if (hi <= lo) return null;
  return Math.max(0, Math.min(100, Math.round(((r - lo) / (hi - lo)) * 1000) / 10));
};

/** Status, score (0–100) and this session's seconds from SCORM values. */
export function scormOutcome(kind: "scorm12" | "scorm2004", v: Record<string, string>, mastery: number | null = null): { status: AttemptStatus; score: number | null; seconds: number } {
  if (kind === "scorm12") {
    const s = (v["cmi.core.lesson_status"] ?? "").toLowerCase();
    let score = pct(v["cmi.core.score.raw"], v["cmi.core.score.min"], v["cmi.core.score.max"]);
    if (score === null && v["cmi.core.score.raw"] && !v["cmi.core.score.max"]) score = pct(v["cmi.core.score.raw"], "0", "100");
    let status: AttemptStatus = s === "passed" ? "passed" : s === "failed" ? "failed" : s === "completed" ? "completed"
      : s === "incomplete" || s === "browsed" ? "incomplete" : "not_attempted";
    // With a mastery score the LMS decides pass or fail from the score (SCORM 1.2 rule).
    if (mastery !== null && score !== null && (status === "completed" || status === "incomplete" || status === "passed" || status === "failed")) status = score >= mastery ? "passed" : "failed";
    return { status, score, seconds: scorm12Seconds(v["cmi.core.session_time"]) };
  }
  const c = (v["cmi.completion_status"] ?? "").toLowerCase(), ok = (v["cmi.success_status"] ?? "").toLowerCase();
  const scaled = Number(v["cmi.score.scaled"]);
  let score = v["cmi.score.scaled"] !== undefined && v["cmi.score.scaled"] !== "" && Number.isFinite(scaled) ? Math.max(0, Math.min(100, Math.round(scaled * 1000) / 10)) : null;
  if (score === null) score = pct(v["cmi.score.raw"], v["cmi.score.min"], v["cmi.score.max"]);
  const status: AttemptStatus = ok === "passed" ? "passed" : ok === "failed" ? "failed" : c === "completed" ? "completed" : c === "incomplete" ? "incomplete" : "not_attempted";
  return { status, score, seconds: isoSeconds(v["cmi.session_time"]) };
}

// Values that describe one session and are not kept between visits.
const SESSION_ONLY = /^cmi\.(core\.)?(session_time|exit)$|^adl\.nav\./;
/** The values to keep from what a package sent, within size limits. */
export function keepValues(prev: Record<string, string>, incoming: Record<string, unknown>): Record<string, string> {
  const out = { ...prev };
  for (const [k, raw] of Object.entries(incoming).slice(0, 2000)) {
    if (!/^cmi\.[\w.]{1,200}$/.test(k) || SESSION_ONLY.test(k)) continue;
    const val = String(raw ?? "");
    out[k] = val.slice(0, k.endsWith("suspend_data") ? 64000 : 4000);
  }
  const size = JSON.stringify(out).length;
  if (size > 400_000) throw new Error("this package is trying to save too much data");
  return out;
}

/** Values the package reads when it starts. */
export function initialValues(kind: "scorm12" | "scorm2004", a: { values: Record<string, string>; status: AttemptStatus; seconds: number; learnerId: string; learnerName: string; mastery: number | null; review?: boolean }): Record<string, string> {
  const started = a.status !== "not_attempted";
  if (kind === "scorm12") {
    return {
      ...a.values,
      "cmi.core.student_id": a.learnerId, "cmi.core.student_name": a.learnerName,
      "cmi.core.lesson_status": a.values["cmi.core.lesson_status"] || (started ? "incomplete" : "not attempted"),
      "cmi.core.entry": started ? "resume" : "ab-initio", "cmi.core.credit": a.review ? "no-credit" : "credit", "cmi.core.lesson_mode": a.review ? "browse" : "normal",
      "cmi.core.total_time": secondsTo12(a.seconds), ...(a.mastery !== null ? { "cmi.student_data.mastery_score": String(a.mastery) } : {}),
      "cmi.launch_data": a.values["cmi.launch_data"] ?? ""
    };
  }
  return {
    ...a.values,
    "cmi.learner_id": a.learnerId, "cmi.learner_name": a.learnerName,
    "cmi.completion_status": a.values["cmi.completion_status"] || (started ? "incomplete" : "not attempted"),
    "cmi.success_status": a.values["cmi.success_status"] || "unknown",
    "cmi.entry": started ? "resume" : "ab-initio", "cmi.credit": a.review ? "no-credit" : "credit", "cmi.mode": a.review ? "browse" : "normal",
    "cmi.total_time": secondsToIso(a.seconds), ...(a.mastery !== null ? { "cmi.scaled_passing_score": String(a.mastery / 100) } : {})
  };
}

/**
 * The SCORM runtime placed at the top of each package page. It answers
 * GetValue from the loaded values and sends changes to the top window
 * (the player) on Commit and Finish/Terminate, tagged with `nonce`.
 */
export function scormRuntime(kind: "scorm12" | "scorm2004", values: Record<string, string>, nonce: string): string {
  const data = JSON.stringify({ v: values, n: nonce, k: kind }).replace(/</g, "\\u003c").split(String.fromCharCode(0x2028)).join("\\u2028").split(String.fromCharCode(0x2029)).join("\\u2029");
  return `<script>(function(){var D=${data},V=D.v,C={},E="0",up=false,done=false;
function cnt(p){var n=0,re=new RegExp("^"+p.replace(/\\./g,"\\\\.")+"\\\\.(\\\\d+)\\\\.");for(var k in V){var m=k.match(re);if(m&&+m[1]+1>n)n=+m[1]+1;}return String(n);}
function get(k){E="0";if(/\\._count$/.test(k))return cnt(k.slice(0,-7));if(k==="cmi._version")return "1.0";if(k in V)return String(V[k]);return "";}
function set(k,v){if(done){E=D.k==="scorm12"?"101":"133";return "false";}if(!/^cmi\\./.test(k)){E=D.k==="scorm12"?"201":"351";return "false";}V[k]=String(v);C[k]=String(v);E="0";return "true";}
function send(fin){try{window.top.postMessage({type:"ecf-scorm",n:D.n,values:C,finish:!!fin},"*");}catch(e){}C={};}
function init(){up=true;E="0";return "true";}
function fin(){if(!up)return "false";send(true);done=true;return "true";}
function commit(){send(false);return "true";}
function err(){return E;}function str(c){return c==="0"?"No error":"Error "+c;}function diag(c){return str(c);}
if(D.k==="scorm12"){window.API={LMSInitialize:init,LMSFinish:fin,LMSGetValue:get,LMSSetValue:set,LMSCommit:commit,LMSGetLastError:err,LMSGetErrorString:str,LMSGetDiagnostic:diag};}
else{window.API_1484_11={Initialize:init,Terminate:fin,GetValue:get,SetValue:set,Commit:commit,GetLastError:err,GetErrorString:str,GetDiagnostic:diag};}
window.addEventListener("pagehide",function(){if(up&&!done)send(false);});})();</script>`;
}

/** Puts a script right after <head> (or at the start when there is none). */
export function injectIntoHtml(html: string, script: string): string {
  const m = html.match(/<head\b[^>]*>/i);
  if (m && m.index !== undefined) return html.slice(0, m.index + m[0].length) + script + html.slice(m.index + m[0].length);
  const h = html.match(/<html\b[^>]*>/i);
  if (h && h.index !== undefined) return html.slice(0, h.index + h[0].length) + script + html.slice(h.index + h[0].length);
  return script + html;
}

// ---------------- xAPI ----------------

const VERB = "http://adlnet.gov/expapi/verbs/";
/** What one xAPI statement says about progress. */
export function xapiOutcome(st: { verb?: { id?: string }; result?: { score?: { scaled?: number; raw?: number; min?: number; max?: number }; success?: boolean; completion?: boolean } } | null | undefined):
  { status: AttemptStatus | null; score: number | null } {
  const verb = String(st?.verb?.id ?? "");
  const r = st?.result;
  let score: number | null = null;
  if (r?.score) {
    if (typeof r.score.scaled === "number" && Number.isFinite(r.score.scaled)) score = Math.max(0, Math.min(100, Math.round(r.score.scaled * 1000) / 10));
    else if (typeof r.score.raw === "number") score = pct(String(r.score.raw), r.score.min !== undefined ? String(r.score.min) : undefined, r.score.max !== undefined ? String(r.score.max) : undefined);
  }
  let status: AttemptStatus | null = null;
  if (verb === `${VERB}passed` || (r?.success === true && verb === `${VERB}completed`)) status = "passed";
  else if (verb === `${VERB}failed` || (r?.success === false && verb === `${VERB}completed`)) status = "failed";
  else if (verb === `${VERB}completed` || r?.completion === true) status = "completed";
  else if (["attempted", "initialized", "experienced", "progressed", "answered", "interacted", "launched", "resumed"].some(v => verb === `${VERB}${v}` || verb.endsWith(`/${v}`))) status = "incomplete";
  return { status, score };
}
