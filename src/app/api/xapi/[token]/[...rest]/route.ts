import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { readToken, saveAttempt } from "@/lib/content-server";
import { xapiOutcome, isoSeconds, type ContentToken } from "@/lib/content";
import { appUrl } from "@/lib/school";

export const dynamic = "force-dynamic";

/**
 * A small Learning Record Store for xAPI (Tin Can) packages: statements and
 * the State API, for one learner and one package, keyed by the signed token
 * in the path. Packages call it from their sandboxed origin, so it answers
 * cross-origin requests.
 */
const CORS = {
  "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Experience-API-Version, If-Match, If-None-Match", "Access-Control-Expose-Headers": "X-Experience-API-Version, ETag",
  "X-Experience-API-Version": "1.0.3"
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });
const empty = (status = 204) => new Response(null, { status, headers: CORS });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ token: string; rest: string[] }> };
async function open(p: Params) {
  const { token, rest } = await p.params;
  return { t: readToken(token), path: (rest ?? []).join("/").replace(/\/+$/, "") };
}

export async function OPTIONS() { return empty(204); }

export async function GET(req: NextRequest, p: Params) {
  const { t, path } = await open(p);
  if (!t) return json({ error: "expired" }, 401);
  if (path === "about") return json({ version: ["1.0.3", "1.0.0"] });
  const q = new URL(req.url).searchParams;
  const svc = createServiceClient();
  if (path === "statements") {
    const id = q.get("statementId") ?? q.get("voidedStatementId");
    if (id) {
      if (!UUID.test(id)) return json({ error: "bad id" }, 400);
      const { data } = await svc.from("xapi_statements").select("statement").eq("id", id).eq("user_id", t.u).maybeSingle();
      return data ? json(data.statement) : json({ error: "not found" }, 404);
    }
    let s = svc.from("xapi_statements").select("statement").eq("user_id", t.u).eq("package_id", t.p).eq("voided", false).order("stored_at", { ascending: false })
      .limit(Math.min(100, Math.max(1, Number(q.get("limit")) || 50)));
    if (q.get("verb")) s = s.eq("verb", q.get("verb"));
    if (q.get("activity")) s = s.eq("object_id", q.get("activity"));
    if (q.get("since")) s = s.gt("stored_at", q.get("since"));
    const { data } = await s;
    return json({ statements: (data ?? []).map((r: any) => r.statement), more: "" });
  }
  if (path === "activities/state") {
    const activity = q.get("activityId"), state = q.get("stateId"), reg = q.get("registration") ?? "";
    if (!activity) return json({ error: "activityId required" }, 400);
    if (state) {
      const { data } = await svc.from("xapi_state").select("doc,content_type").eq("user_id", t.u).eq("activity_id", activity).eq("state_id", state).eq("registration", reg).maybeSingle();
      return data ? new Response(data.doc ?? "", { headers: { ...CORS, "Content-Type": data.content_type ?? "application/octet-stream" } }) : empty(404);
    }
    const { data } = await svc.from("xapi_state").select("state_id").eq("user_id", t.u).eq("activity_id", activity).eq("registration", reg);
    return json((data ?? []).map((r: any) => r.state_id));
  }
  if (path === "activities/profile" || path === "agents/profile") return q.get("profileId") ? empty(404) : json([]);
  return json({ error: "not supported" }, 404);
}

export async function PUT(req: NextRequest, p: Params) { return write(req, p, "PUT"); }
export async function POST(req: NextRequest, p: Params) { return write(req, p, "POST"); }

async function write(req: NextRequest, p: Params, method: "PUT" | "POST") {
  const { t, path } = await open(p);
  if (!t) return json({ error: "expired" }, 401);
  const q = new URL(req.url).searchParams;
  const svc = createServiceClient();
  const text = await req.text();
  if (text.length > 1_000_000) return json({ error: "too large" }, 413);
  if (path === "statements") {
    let body: unknown;
    try { body = JSON.parse(text); } catch { return json({ error: "invalid JSON" }, 400); }
    const list = (Array.isArray(body) ? body : [body]).slice(0, 50) as Record<string, any>[];
    if (method === "PUT") {
      const id = q.get("statementId");
      if (!id || !UUID.test(id) || list.length !== 1) return json({ error: "statementId required" }, 400);
      list[0].id = id;
    }
    const ids = await storeStatements(svc, t, list, appUrl(req));
    if (ids === null) return json({ error: "invalid statement" }, 400);
    return method === "PUT" ? empty(204) : json(ids);
  }
  if (path === "activities/state") {
    const activity = q.get("activityId"), state = q.get("stateId"), reg = q.get("registration") ?? "";
    if (!activity || !state) return json({ error: "activityId and stateId required" }, 400);
    let doc = text;
    const type = (req.headers.get("content-type") ?? "application/octet-stream").split(";")[0];
    if (method === "POST" && type === "application/json") {
      // POST merges JSON documents.
      const { data: cur } = await svc.from("xapi_state").select("doc").eq("user_id", t.u).eq("activity_id", activity).eq("state_id", state).eq("registration", reg).maybeSingle();
      try { doc = JSON.stringify({ ...(cur?.doc ? JSON.parse(cur.doc) : {}), ...JSON.parse(text) }); } catch { return json({ error: "invalid JSON" }, 400); }
    }
    await svc.from("xapi_state").upsert({ tenant_id: t.t, user_id: t.u, activity_id: activity.slice(0, 500), state_id: state.slice(0, 200), registration: reg.slice(0, 64),
      content_type: type, doc, updated_at: new Date().toISOString() }, { onConflict: "user_id,activity_id,state_id,registration" });
    return empty(204);
  }
  return json({ error: "not supported" }, 404);
}

export async function DELETE(req: NextRequest, p: Params) {
  const { t, path } = await open(p);
  if (!t) return json({ error: "expired" }, 401);
  if (path !== "activities/state") return json({ error: "not supported" }, 404);
  const q = new URL(req.url).searchParams;
  const activity = q.get("activityId");
  if (!activity) return json({ error: "activityId required" }, 400);
  let d = createServiceClient().from("xapi_state").delete().eq("user_id", t.u).eq("activity_id", activity).eq("registration", q.get("registration") ?? "");
  if (q.get("stateId")) d = d.eq("state_id", q.get("stateId"));
  await d;
  return empty(204);
}

/** Stores statements as this learner (whatever actor the package sent) and updates their progress. */
async function storeStatements(svc: any, t: ContentToken, list: Record<string, any>[], base: string): Promise<string[] | null> {
  const now = new Date().toISOString();
  const rows = [];
  for (const s of list) {
    if (!s || typeof s !== "object" || !s.verb?.id || !s.object) return null;
    const id = typeof s.id === "string" && UUID.test(s.id) ? s.id : randomUUID();
    const statement = { ...s, id, actor: { objectType: "Agent", account: { homePage: base, name: t.u }, name: s.actor?.name }, stored: now, timestamp: s.timestamp ?? now };
    rows.push({ id, tenant_id: t.t, package_id: t.p, user_id: t.u, verb: String(s.verb.id).slice(0, 300), object_id: String(s.object.id ?? "").slice(0, 500) || null,
      result: s.result ?? null, statement, timestamp: Date.parse(statement.timestamp) ? statement.timestamp : now });
  }
  const { error } = await svc.from("xapi_statements").upsert(rows, { onConflict: "id", ignoreDuplicates: true });
  if (error) return null;
  // Voiding statements.
  for (const s of list) if (s.verb.id === "http://adlnet.gov/expapi/verbs/voided" && UUID.test(String(s.object?.id ?? ""))) await svc.from("xapi_statements").update({ voided: true }).eq("id", s.object.id).eq("user_id", t.u);
  if (t.a) {
    for (const s of list) {
      const out = xapiOutcome(s);
      if (out.status) await saveAttempt(svc, { tenantId: t.t, attemptId: t.a, packageId: t.p, status: out.status, score: out.score,
        seconds: ["completed", "passed", "failed"].includes(out.status) ? isoSeconds(s.result?.duration) : 0 });
    }
  }
  return rows.map(r => r.id);
}
