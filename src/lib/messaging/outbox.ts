/**
 * Outbox: enqueue → dispatch → retry. All writes use the service role, and
 * callers must already have authorised the action for this tenant.
 *
 * "ASAP" delivery: callers enqueue and immediately call `dispatchDue` with a
 * time budget, so messages leave within seconds. Anything left over (or
 * failed with a retryable error) is picked up by /api/cron/dispatch.
 */
import { sendEmail, sendWhatsApp, normalizePhone } from "./providers";
import type { Brand, Rendered } from "./templates";

export type Guardian = {
  id: string; full_name: string; email: string | null; phone: string | null; whatsapp_phone: string | null;
  notify_email: boolean; notify_whatsapp: boolean; portal_token?: string;
};

export type OutboxRow = {
  tenant_id: string; channel: "email" | "whatsapp"; to_address: string; to_name?: string | null;
  kind: string; subject?: string | null; body_text: string; body_html?: string | null;
  template_name?: string | null; template_params?: string[]; ref_id?: string | null; created_by?: string | null;
};

const MAX_ATTEMPTS = 5;

export async function loadBrand(svc: any, tenantId: string): Promise<Brand & { senderName: string; replyTo: string | null; timezone: string }> {
  const [{ data: t }, { data: s }] = await Promise.all([
    svc.from("tenants").select("name,timezone").eq("id", tenantId).maybeSingle(),
    svc.from("tenant_settings").select("school_name,brand_color,logo_url,address,sender_name,reply_to_email").eq("tenant_id", tenantId).maybeSingle()
  ]);
  const name = s?.school_name || t?.name || "School";
  return {
    schoolName: name, color: s?.brand_color, logoUrl: s?.logo_url, address: s?.address,
    senderName: s?.sender_name || name, replyTo: s?.reply_to_email ?? null,
    timezone: t?.timezone || "Africa/Lagos"
  };
}

export function formatInZone(d: Date, timeZone: string) {
  const safeTz = (() => { try { new Intl.DateTimeFormat("en-GB", { timeZone }); return timeZone; } catch { return "UTC"; } })();
  return {
    time: new Intl.DateTimeFormat("en-GB", { timeZone: safeTz, hour: "2-digit", minute: "2-digit", hour12: true }).format(d),
    date: new Intl.DateTimeFormat("en-GB", { timeZone: safeTz, weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(d)
  };
}

/** Builds outbox rows for one guardian according to their channel preferences. */
export function rowsForGuardian(tenantId: string, g: Guardian, kind: string, r: Rendered, refId: string | null, createdBy: string | null): OutboxRow[] {
  const rows: OutboxRow[] = [];
  if (g.notify_email && g.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(g.email)) {
    rows.push({ tenant_id: tenantId, channel: "email", to_address: g.email.trim(), to_name: g.full_name, kind,
      subject: r.subject, body_text: r.text, body_html: r.html, ref_id: refId, created_by: createdBy });
  }
  const wa = normalizePhone(g.whatsapp_phone || g.phone);
  if (g.notify_whatsapp && wa) {
    rows.push({ tenant_id: tenantId, channel: "whatsapp", to_address: wa, to_name: g.full_name, kind,
      subject: r.subject, body_text: r.wa.text, template_name: r.wa.template, template_params: r.wa.params,
      ref_id: refId, created_by: createdBy });
  }
  return rows;
}

/** Guardians of a set of students, keyed by student id. */
export async function guardiansByStudent(svc: any, tenantId: string, studentIds: string[]) {
  const map = new Map<string, Guardian[]>();
  if (!studentIds.length) return map;
  for (let i = 0; i < studentIds.length; i += 200) {
    const chunk = studentIds.slice(i, i + 200);
    const { data } = await svc.from("student_guardians")
      .select("student_id, guardians(id,full_name,email,phone,whatsapp_phone,notify_email,notify_whatsapp,portal_token)")
      .eq("tenant_id", tenantId).in("student_id", chunk);
    for (const row of data ?? []) {
      if (!row.guardians) continue;
      if (!map.has(row.student_id)) map.set(row.student_id, []);
      map.get(row.student_id)!.push(row.guardians as Guardian);
    }
  }
  return map;
}

export async function enqueue(svc: any, rows: OutboxRow[]): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await svc.from("message_outbox").insert(rows.slice(i, i + 500)).select("id");
    if (error) throw new Error(`outbox insert failed: ${error.message}`);
    ids.push(...(data ?? []).map((r: { id: string }) => r.id));
  }
  return ids;
}

type Claimed = OutboxRow & { id: string; attempts: number };

async function deliver(svc: any, m: Claimed, brandCache: Map<string, Awaited<ReturnType<typeof loadBrand>>>) {
  let brand = brandCache.get(m.tenant_id);
  if (!brand) { brand = await loadBrand(svc, m.tenant_id); brandCache.set(m.tenant_id, brand); }
  const res = m.channel === "email"
    ? await sendEmail({ to: m.to_address, toName: m.to_name, subject: m.subject ?? brand.schoolName, text: m.body_text, html: m.body_html, fromName: brand.senderName, replyTo: brand.replyTo })
    : await sendWhatsApp({ to: m.to_address, text: m.body_text, template: m.template_name, params: m.template_params ?? [] });

  if (res.ok) {
    await svc.from("message_outbox").update({ status: "sent", sent_at: new Date().toISOString(), provider_message_id: res.providerId ?? null, last_error: null }).eq("id", m.id);
    return "sent" as const;
  }
  if (res.notConfigured) {
    await svc.from("message_outbox").update({ status: "skipped", last_error: res.error }).eq("id", m.id);
    return "skipped" as const;
  }
  if (res.retryable && m.attempts < MAX_ATTEMPTS) {
    const delayMin = Math.pow(2, m.attempts); // 2, 4, 8, 16 minutes
    await svc.from("message_outbox").update({
      status: "queued", last_error: res.error,
      next_attempt_at: new Date(Date.now() + delayMin * 60_000).toISOString()
    }).eq("id", m.id);
    return "retry" as const;
  }
  await svc.from("message_outbox").update({ status: "failed", last_error: res.error }).eq("id", m.id);
  return "failed" as const;
}

/** Sends due messages with bounded concurrency until the batch or time budget runs out. */
export async function dispatchDue(svc: any, opts: { limit?: number; budgetMs?: number; concurrency?: number } = {}) {
  const started = Date.now();
  const budget = opts.budgetMs ?? 20_000;
  const stats = { sent: 0, failed: 0, retry: 0, skipped: 0 };
  const brandCache = new Map<string, Awaited<ReturnType<typeof loadBrand>>>();
  while (Date.now() - started < budget) {
    const { data: batch, error } = await svc.rpc("claim_outbox", { p_limit: opts.limit ?? 50 });
    if (error) throw new Error(`claim_outbox failed: ${error.message}`);
    const rows = (batch ?? []) as Claimed[];
    if (!rows.length) break;
    const conc = opts.concurrency ?? 8;
    for (let i = 0; i < rows.length; i += conc) {
      const results = await Promise.all(rows.slice(i, i + conc).map(m => deliver(svc, m, brandCache).catch(async (e) => {
        await svc.from("message_outbox").update({ status: "queued", last_error: String(e?.message ?? e), next_attempt_at: new Date(Date.now() + 120_000).toISOString() }).eq("id", m.id);
        return "retry" as const;
      })));
      for (const r of results) stats[r]++;
    }
    if (rows.length < (opts.limit ?? 50)) break;
  }
  return stats;
}

/** Messages stuck in "sending" (process crashed mid-send) go back to the queue. */
export async function requeueStale(svc: any) {
  const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  await svc.from("message_outbox").update({ status: "queued" }).eq("status", "sending").lt("next_attempt_at", cutoff);
}
