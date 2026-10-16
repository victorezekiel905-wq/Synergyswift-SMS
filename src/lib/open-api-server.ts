/**
 * The open API behind /api/v1: who a key belongs to, what each resource
 * returns, applications sent in from a school website, webhook delivery and
 * the public website feeds. Rules live in open-api.ts.
 */
import { NextResponse } from "next/server";
import { createServiceClient } from "./supabase/service";
import { studentName } from "./school";
import { hashKey, keyFrom, hasScope, signPayload, retryIn, MAX_FAILURES, safeWebhookUrl } from "./open-api";

export type ApiCaller = { svc: any; tenantId: string; keyId: string; scopes: string[] };

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export const apiError = (message: string, status: number) => json({ error: { message, status } }, status);

// A simple per-instance limit: 120 requests a minute per key.
const hits = new Map<string, { minute: number; n: number }>();
function limited(keyId: string): boolean {
  const minute = Math.floor(Date.now() / 60_000);
  const h = hits.get(keyId);
  if (!h || h.minute !== minute) { hits.set(keyId, { minute, n: 1 }); return false; }
  h.n++;
  return h.n > 120;
}

/** The school and scopes behind the request's API key, or an error response. */
export async function authenticate(headers: Headers): Promise<ApiCaller | NextResponse> {
  const key = keyFrom(headers);
  if (!key) return apiError("Send your API key as 'Authorization: Bearer ssk_…'.", 401);
  const svc = createServiceClient();
  const { data: k } = await svc.from("api_keys").select("id,tenant_id,scopes,revoked_at,expires_at,last_used_at").eq("key_hash", hashKey(key)).maybeSingle();
  if (!k || k.revoked_at || (k.expires_at && new Date(k.expires_at) < new Date())) return apiError("This API key is not valid.", 401);
  const { data: t } = await svc.from("tenants").select("status").eq("id", k.tenant_id).maybeSingle();
  if (t?.status && t.status !== "active") return apiError("This school's account is not active.", 403);
  if (limited(k.id)) return apiError("Too many requests: at most 120 a minute.", 429);
  if (!k.last_used_at || Date.now() - new Date(k.last_used_at).getTime() > 5 * 60_000) {
    await svc.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", k.id);
  }
  return { svc, tenantId: k.tenant_id, keyId: k.id, scopes: k.scopes ?? [] };
}

type Args = Record<string, unknown> & { limit: number; offset: number };
type Resource = { scope: string; list: (c: ApiCaller, a: Args) => Promise<{ data: unknown[]; total: number | null }> };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
async function classId(c: ApiCaller, v: unknown) {
  const s = str(v);
  if (!s) return null;
  if (/^[0-9a-f-]{36}$/.test(s)) return s;
  const { data } = await c.svc.from("class_groups").select("id").eq("tenant_id", c.tenantId).eq("name", s).maybeSingle();
  return data?.id ?? "00000000-0000-0000-0000-000000000000";
}

export const RESOURCES: Record<string, Resource> = {
  students: { scope: "students:read", list: async (c, a) => {
    let q = c.svc.from("students").select("id,admission_no,first_name,last_name,other_names,gender,date_of_birth,status,admitted_on,class_group_id,class_groups(name,level),houses(name)", { count: "exact" }).eq("tenant_id", c.tenantId);
    const cg = await classId(c, a.class); if (cg) q = q.eq("class_group_id", cg);
    q = q.eq("status", str(a.status) ?? "active");
    if (str(a.updated_since)) q = q.gte("created_at", str(a.updated_since));
    const { data, count } = await q.order("admission_no").range(a.offset, a.offset + a.limit - 1);
    return { total: count, data: (data ?? []).map((s: any) => ({ id: s.id, admission_no: s.admission_no, name: studentName(s), first_name: s.first_name, last_name: s.last_name, other_names: s.other_names,
      gender: s.gender, date_of_birth: s.date_of_birth, status: s.status, admitted_on: s.admitted_on, class: s.class_groups ? { id: s.class_group_id, name: s.class_groups.name, level: s.class_groups.level } : null, house: s.houses?.name ?? null })) };
  } },
  classes: { scope: "classes:read", list: async (c, a) => {
    const { data, count } = await c.svc.from("class_groups").select("id,name,level,users!class_groups_form_teacher_id_fkey(full_name),subject_offerings(subjects(id,name),users(full_name))", { count: "exact" })
      .eq("tenant_id", c.tenantId).order("name").range(a.offset, a.offset + a.limit - 1);
    return { total: count, data: (data ?? []).map((k: any) => ({ id: k.id, name: k.name, level: k.level, form_teacher: k.users?.full_name ?? null,
      subjects: (k.subject_offerings ?? []).map((o: any) => ({ id: o.subjects?.id, name: o.subjects?.name, teacher: o.users?.full_name ?? null })) })) };
  } },
  staff: { scope: "staff:read", list: async (c, a) => {
    const { data, count } = await c.svc.from("staff").select("id,staff_no,full_name,email,department,position,status", { count: "exact" }).eq("tenant_id", c.tenantId).neq("status", "exited")
      .order("full_name").range(a.offset, a.offset + a.limit - 1);
    return { total: count, data: data ?? [] };
  } },
  attendance: { scope: "attendance:read", list: async (c, a) => {
    const from = str(a.from), to = str(a.to) ?? from;
    if (!from || !DATE.test(from) || !to || !DATE.test(to)) throw new Error("give from (and optionally to) as YYYY-MM-DD");
    let q = c.svc.from("class_attendance").select("student_id,date,status,class_group_id", { count: "exact" }).eq("tenant_id", c.tenantId).gte("date", from).lte("date", to);
    const cg = await classId(c, a.class); if (cg) q = q.eq("class_group_id", cg);
    const { data, count } = await q.order("date").order("student_id").range(a.offset, a.offset + a.limit - 1);
    return { total: count, data: data ?? [] };
  } },
  results: { scope: "results:read", list: async (c, a) => {
    let q = c.svc.from("report_cards").select("id,student_id,term_id,class_group_id,average,position,class_size,published_at,data", { count: "exact" }).eq("tenant_id", c.tenantId).eq("status", "published").eq("kind", "term");
    if (str(a.term)) q = q.eq("term_id", str(a.term));
    if (str(a.student)) q = q.eq("student_id", str(a.student));
    const { data, count } = await q.order("published_at", { ascending: false }).range(a.offset, a.offset + a.limit - 1);
    return { total: count, data: (data ?? []).map((r: any) => ({ id: r.id, student_id: r.student_id, term_id: r.term_id, term: r.data?.term_label ?? null, class_group_id: r.class_group_id,
      average: r.average, position: r.data?.scheme?.show_position ? r.position : null, class_size: r.class_size, published_at: r.published_at,
      subjects: (r.data?.subjects ?? []).map((s: any) => ({ subject_id: s.subject_id, subject: s.subject, total: s.total, grade: s.grade })) })) };
  } },
  invoices: { scope: "fees:read", list: async (c, a) => {
    let q = c.svc.from("fee_invoices").select("id,invoice_no,student_id,term_id,title,status,total,amount_paid,due_date,created_at", { count: "exact" }).eq("tenant_id", c.tenantId);
    if (str(a.status)) q = q.eq("status", str(a.status));
    if (str(a.student)) q = q.eq("student_id", str(a.student));
    if (str(a.term)) q = q.eq("term_id", str(a.term));
    const { data, count } = await q.order("created_at", { ascending: false }).range(a.offset, a.offset + a.limit - 1);
    return { total: count, data: (data ?? []).map((i: any) => ({ ...i, total: Number(i.total), amount_paid: Number(i.amount_paid), balance: Math.max(0, Number(i.total) - Number(i.amount_paid)) })) };
  } },
  payments: { scope: "payments:read", list: async (c, a) => {
    let q = c.svc.from("fee_payments").select("id,invoice_id,student_id,amount,currency,method,provider,reference,receipt_no,paid_at,created_at", { count: "exact" }).eq("tenant_id", c.tenantId).eq("status", "success");
    if (str(a.from) && DATE.test(str(a.from)!)) q = q.gte("created_at", str(a.from));
    if (str(a.to) && DATE.test(str(a.to)!)) q = q.lte("created_at", `${str(a.to)}T23:59:59`);
    const { data, count } = await q.order("created_at", { ascending: false }).range(a.offset, a.offset + a.limit - 1);
    return { total: count, data: (data ?? []).map((p: any) => ({ ...p, amount: Number(p.amount) })) };
  } },
  applications: { scope: "applications:read", list: async (c, a) => {
    let q = c.svc.from("applications").select("id,application_no,first_name,last_name,other_names,applying_for,status,source,created_at,guardian_name,guardian_phone,guardian_email", { count: "exact" }).eq("tenant_id", c.tenantId);
    if (str(a.status)) q = q.eq("status", str(a.status));
    const { data, count } = await q.order("created_at", { ascending: false }).range(a.offset, a.offset + a.limit - 1);
    return { total: count, data: data ?? [] };
  } },
  events: { scope: "events:read", list: async (c, a) => publicEvents(c.svc, c.tenantId, a.limit, a.offset) },
  news: { scope: "news:read", list: async (c, a) => publicNews(c.svc, c.tenantId, a.limit, a.offset) }
};

/** Lists a resource for a caller, checking the key's scope. */
export async function listResource(c: ApiCaller, name: string, args: Args) {
  const r = RESOURCES[name];
  if (!r) throw Object.assign(new Error(`unknown resource "${name}"`), { status: 404 });
  if (!hasScope(c.scopes, r.scope)) throw Object.assign(new Error(`this key does not have the ${r.scope} scope`), { status: 403 });
  return r.list(c, args);
}

/** Events the school chose to show on its website, from today on. */
export async function publicEvents(svc: any, tenantId: string, limit = 50, offset = 0) {
  const { data, count } = await svc.from("school_events").select("id,title,description,kind,starts_at,ends_at,location", { count: "exact" })
    .eq("tenant_id", tenantId).eq("show_on_website", true).gte("starts_at", new Date(Date.now() - 86400_000).toISOString()).order("starts_at").range(offset, offset + limit - 1);
  return { total: count, data: data ?? [] };
}
/** Published news, newest first (without the full body in lists). */
export async function publicNews(svc: any, tenantId: string, limit = 20, offset = 0) {
  const { data, count } = await svc.from("news_posts").select("id,title,slug,summary,image_url,published_at", { count: "exact" })
    .eq("tenant_id", tenantId).eq("status", "published").order("published_at", { ascending: false }).range(offset, offset + limit - 1);
  return { total: count, data: data ?? [] };
}

/** The school behind a public web address (/apply/<slug> etc.). */
export async function tenantByPublicSlug(svc: any, slug: string) {
  if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(slug)) return null;
  const { data: t } = await svc.from("tenants").select("id,name,status,timezone").eq("public_slug", slug).maybeSingle();
  if (!t || (t.status && t.status !== "active")) return null;
  const { data: s } = await svc.from("tenant_settings").select("school_name,logo_url,brand_color,address,phone,email").eq("tenant_id", t.id).maybeSingle();
  return { tenant: t, school: { name: s?.school_name ?? t.name, logo_url: s?.logo_url ?? null, brand_color: s?.brand_color ?? null, address: s?.address ?? null, phone: s?.phone ?? null, email: s?.email ?? null } };
}

/**
 * Sends queued webhooks (a batch per run), signed with each endpoint's secret.
 * Failures are retried with growing gaps; an endpoint that keeps failing is
 * turned off after 20 failures in a row.
 */
export async function deliverWebhooks(svc: any, batch = 50, budgetMs = 15_000): Promise<{ delivered: number; failed: number }> {
  const started = Date.now();
  const { data: due } = await svc.from("webhook_deliveries").select("id").eq("status", "queued").lte("next_attempt_at", new Date().toISOString()).order("created_at").limit(batch);
  if (!due?.length) return { delivered: 0, failed: 0 };
  const { data: claimed } = await svc.from("webhook_deliveries").update({ status: "sending" }).eq("status", "queued").in("id", due.map((d: any) => d.id))
    .select("id,endpoint_id,event,payload,attempts,webhook_endpoints(url,secret,active,failures)");
  let delivered = 0, failed = 0;
  for (const d of claimed ?? []) {
    const ep = d.webhook_endpoints;
    const attempts = d.attempts + 1;
    if (ep?.active && safeWebhookUrl(ep.url)) { await svc.from("webhook_deliveries").update({ status: "failed", attempts, last_error: "address is not a public https site" }).eq("id", d.id); failed++; continue; }
    if (!ep?.active) { await svc.from("webhook_deliveries").update({ status: "failed", attempts, last_error: "endpoint turned off" }).eq("id", d.id); failed++; continue; }
    if (Date.now() - started > budgetMs) { await svc.from("webhook_deliveries").update({ status: "queued" }).eq("id", d.id); continue; }
    const body = JSON.stringify(d.payload);
    let code = 0, err: string | null = null;
    try {
      const r = await fetch(ep.url, {
        method: "POST", redirect: "manual", signal: AbortSignal.timeout(8000),
        headers: { "Content-Type": "application/json", "User-Agent": "EduClass-Webhooks/1", "X-Webhook-Event": d.event, "X-Webhook-Id": d.payload?.id ?? d.id, "X-Webhook-Signature": signPayload(ep.secret, body) },
        body
      });
      code = r.status;
      if (!r.ok) err = `HTTP ${r.status}`;
    } catch (e) { err = String((e as Error).message).slice(0, 200); }
    if (!err) {
      await svc.from("webhook_deliveries").update({ status: "delivered", attempts, response_code: code, delivered_at: new Date().toISOString(), last_error: null }).eq("id", d.id);
      await svc.from("webhook_endpoints").update({ failures: 0, last_status: code, last_delivered_at: new Date().toISOString() }).eq("id", d.endpoint_id);
      delivered++;
    } else {
      const wait = retryIn(attempts);
      await svc.from("webhook_deliveries").update(wait === null
        ? { status: "failed", attempts, response_code: code || null, last_error: err }
        : { status: "queued", attempts, response_code: code || null, last_error: err, next_attempt_at: new Date(Date.now() + wait * 60_000).toISOString() }).eq("id", d.id);
      const failures = (ep.failures ?? 0) + 1;
      await svc.from("webhook_endpoints").update({ failures, last_status: code || null, ...(failures >= MAX_FAILURES ? { active: false } : {}) }).eq("id", d.endpoint_id);
      failed++;
    }
  }
  return { delivered, failed };
}
