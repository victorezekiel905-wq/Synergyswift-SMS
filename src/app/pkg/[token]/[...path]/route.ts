import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { readToken, readPackageFile, saveAttempt } from "@/lib/content-server";
import { safeZipPath, mimeFor, isHtml, initialValues, scormRuntime, injectIntoHtml, xapiOutcome, type ContentToken } from "@/lib/content";
import { tokenNonce } from "@/lib/content-server";

export const dynamic = "force-dynamic";

/**
 * Serves package files. Every response carries a sandbox policy: package
 * scripts run in an isolated origin with no access to the school's pages,
 * cookies or session. The signed token in the path is the only key.
 */
const SANDBOX = "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-presentation allow-pointer-lock";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const H5P_CDN = "https://cdn.jsdelivr.net/npm/h5p-standalone@3.8.2/dist";

const headers = (type: string, extra: Record<string, string> = {}) => ({
  "Content-Type": type, "Content-Security-Policy": SANDBOX, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", ...CORS, ...extra
});
const notFound = (msg = "Not found") => new Response(msg, { status: 404, headers: headers("text/plain; charset=utf-8") });

type Params = { params: Promise<{ token: string; path: string[] }> };

async function open(p: Params) {
  const { token, path } = await p.params;
  const t = readToken(token);
  return { t, token, rel: (path ?? []).map(s => decodeURIComponent(s)).join("/") };
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...CORS, "Access-Control-Max-Age": "86400" } });
}

export async function GET(_req: NextRequest, p: Params) {
  const { t, token, rel } = await open(p);
  if (!t) return new Response("This link has expired. Close it and open the content again.", { status: 403, headers: headers("text/plain; charset=utf-8") });
  const svc = createServiceClient();

  if (rel === "__h5p" && t.k === "h5p") return h5pPage(svc, t, token);
  if (rel === "__h5p_state") {
    const att = t.a ? (await svc.from("content_attempts").select("data").eq("id", t.a).maybeSingle()).data : null;
    return Response.json({ success: true, data: att?.data?.h5p_state ?? false }, { headers: CORS });
  }

  const path = safeZipPath(rel);
  if (!path) return notFound();
  const file = await readPackageFile(svc, t.t, t.p, path);
  if (!file) return notFound();
  const type = mimeFor(path);
  if (isHtml(path) && (t.k === "scorm12" || t.k === "scorm2004")) {
    const values = await scormStart(svc, t);
    const html = injectIntoHtml(file.toString("utf8"), scormRuntime(t.k, values, tokenNonce(token)));
    return new Response(html, { headers: headers(type, { "Cache-Control": "no-store" }) });
  }
  return new Response(new Uint8Array(file), { headers: headers(type, { "Cache-Control": isHtml(path) ? "no-store" : "private, max-age=3600" }) });
}

/** H5P saves its state (form post) and reports results (xAPI statement). */
export async function POST(req: NextRequest, p: Params) {
  const { t, rel } = await open(p);
  if (!t) return Response.json({ success: false, message: "expired" }, { status: 403, headers: CORS });
  if (!t.a) return Response.json({ success: true }, { headers: CORS });   // staff preview: nothing is saved
  const svc = createServiceClient();
  const { data: att } = await svc.from("content_attempts").select("id,data").eq("id", t.a).eq("user_id", t.u).maybeSingle();
  if (!att) return Response.json({ success: false }, { status: 404, headers: CORS });
  if (rel === "__h5p_state") {
    const form = await req.formData().catch(() => null);
    const data = String(form?.get("data") ?? "");
    if (data.length > 200_000) return Response.json({ success: false, message: "too large" }, { status: 413, headers: CORS });
    await saveAttempt(svc, { tenantId: t.t, attemptId: att.id, packageId: t.p, status: null, score: null, seconds: 0, data: { ...(att.data ?? {}), h5p_state: data || null } });
    return Response.json({ success: true }, { headers: CORS });
  }
  if (rel === "__h5p_xapi") {
    const body = await req.json().catch(() => null);
    const out = xapiOutcome(body?.statement);
    const seconds = Math.min(4 * 3600, Math.max(0, Number(body?.seconds ?? 0) || 0));
    if (out.status) await saveAttempt(svc, { tenantId: t.t, attemptId: att.id, packageId: t.p, status: out.status, score: out.score, seconds });
    return Response.json({ success: true }, { headers: CORS });
  }
  return Response.json({ success: false }, { status: 404, headers: CORS });
}

async function scormStart(svc: any, t: ContentToken): Promise<Record<string, string>> {
  const kind = t.k as "scorm12" | "scorm2004";
  const [{ data: pkg }, { data: user }, att] = await Promise.all([
    svc.from("content_packages").select("mastery_score").eq("id", t.p).maybeSingle(),
    svc.from("users").select("full_name").eq("id", t.u).maybeSingle(),
    t.a ? svc.from("content_attempts").select("status,time_seconds,data").eq("id", t.a).maybeSingle().then((r: any) => r.data) : Promise.resolve(null)
  ]);
  const full = String(user?.full_name ?? "Learner").trim();
  const parts = full.split(/\s+/);
  const name = kind === "scorm12" && parts.length > 1 ? `${parts.slice(-1)[0]}, ${parts.slice(0, -1).join(" ")}` : full;
  const values = Object.fromEntries(Object.entries(att?.data ?? {}).filter(([k, v]) => k.startsWith("cmi.") && typeof v === "string")) as Record<string, string>;
  return initialValues(kind, { values, status: att?.status ?? "not_attempted", seconds: att?.time_seconds ?? 0, learnerId: t.u, learnerName: name,
    mastery: pkg?.mastery_score ?? null, review: !t.a });
}

async function h5pPage(svc: any, t: ContentToken, token: string) {
  const [{ data: user }, att] = await Promise.all([
    svc.from("users").select("full_name").eq("id", t.u).maybeSingle(),
    t.a ? svc.from("content_attempts").select("data").eq("id", t.a).maybeSingle().then((r: any) => r.data) : Promise.resolve(null)
  ]);
  const cfg = {
    name: String(user?.full_name ?? "Learner"), mail: `${t.u}@learners.invalid`, state: typeof att?.data?.h5p_state === "string" ? att.data.h5p_state : null,
    save: Boolean(t.a), n: tokenNonce(token)
  };
  const data = JSON.stringify(cfg).replace(/</g, "\\u003c");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="${H5P_CDN}/styles/h5p.css"><style>body{margin:0;font-family:system-ui,sans-serif}#msg{padding:24px;color:#475569}</style></head>
<body><div id="h5p"></div><p id="msg">Loading…</p>
<script src="${H5P_CDN}/main.bundle.js" charset="UTF-8"></script>
<script>(function(){var D=${data},t0=Date.now();
function post(path,body,form){try{fetch(path,form?{method:"POST",body:body}:{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});}catch(e){}}
var opts={id:"c",h5pJsonPath:".",frameJs:"${H5P_CDN}/frame.bundle.js",frameCss:"${H5P_CDN}/styles/h5p.css",fullScreen:true,frame:false,icon:false,
  user:{name:D.name,mail:D.mail},saveFreq:D.save?15:false,postUserStatistics:false};
if(D.save){opts.ajax={contentUserDataUrl:"./__h5p_state"};if(D.state)opts.contentUserData=[{dataType:"state",previousState:D.state,subContentId:"*"}];}
if(typeof H5PStandalone==="undefined"){document.getElementById("msg").textContent="This activity needs an internet connection to load.";return;}
new H5PStandalone.H5P(document.getElementById("h5p"),opts).then(function(){document.getElementById("msg").remove();
  if(!D.save)return;
  H5P.externalDispatcher.on("xAPI",function(e){var s=e&&e.data&&e.data.statement;if(!s||!s.verb)return;
    var top=!(s.context&&s.context.contextActivities&&s.context.contextActivities.parent);
    if(top&&/(completed|passed|failed|answered)$/.test(s.verb.id||""))post("./__h5p_xapi",{statement:{verb:s.verb,result:s.result},seconds:Math.round((Date.now()-t0)/1000)});t0=Date.now();});
}).catch(function(){document.getElementById("msg").textContent="This activity could not be loaded.";});})();</script></body></html>`;
  return new Response(html, { headers: headers("text/html; charset=utf-8", { "Cache-Control": "no-store" }) });
}
