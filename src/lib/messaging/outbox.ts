/**
 * Outbox: enqueue → dispatch → retry. All writes use the service role, and
 * callers must already have authorised the action for this tenant.
 *
 * "ASAP" delivery: callers enqueue and immediately call `dispatchDue` with a
 * time budget, so messages leave within seconds. Anything left over (or
 * failed with a retryable error) is picked up by /api/cron/dispatch.
 */
import { sendEmail, sendWhatsApp, sendSms, smsText, normalizePhone } from "./providers";
import { sendPush, pushPayload, sitePath } from "./push";
import { sendFcm } from "./fcm";
import { isMuted, quietUntil, type Prefs } from "../notify-prefs";
import type { Brand, Rendered } from "./templates";

export type Guardian = {
  id: string; full_name: string; email: string | null; phone: string | null; whatsapp_phone: string | null;
  notify_email: boolean; notify_whatsapp: boolean; notify_sms?: boolean; portal_token?: string;
  user_id?: string | null; language?: string | null; push_subscriptions?: { id: string }[];
};

export type OutboxRow = {
  tenant_id: string; channel: "email" | "whatsapp" | "sms" | "push"; to_address: string; to_name?: string | null;
  kind: string; subject?: string | null; body_text: string; body_html?: string | null;
  template_name?: string | null; template_params?: string[]; ref_id?: string | null; created_by?: string | null;
  /** Who the message is for, so their notification choices apply when it is sent. */
  recipient_user_id?: string | null; recipient_guardian_id?: string | null;
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
  const sms = normalizePhone(g.phone || g.whatsapp_phone);
  if (g.notify_sms && sms) {
    rows.push({ tenant_id: tenantId, channel: "sms", to_address: sms, to_name: g.full_name, kind,
      subject: r.subject, body_text: smsText(r.wa.text), ref_id: refId, created_by: createdBy });
  }
  // Push to every device where the parent turned notifications on. Free, so always sent.
  const url = g.user_id ? "/parent" : g.portal_token ? `/g/${g.portal_token}` : "/";
  for (const sub of g.push_subscriptions ?? []) {
    rows.push({ tenant_id: tenantId, channel: "push", to_address: sub.id, to_name: g.full_name, kind,
      subject: r.subject, body_text: smsText(r.wa.text).slice(0, 240), template_params: [url], ref_id: refId, created_by: createdBy });
  }
  return rows.map(x => ({ ...x, recipient_guardian_id: g.id }));
}

/** Guardians of a set of students, keyed by student id. */
export async function guardiansByStudent(svc: any, tenantId: string, studentIds: string[]) {
  const map = new Map<string, Guardian[]>();
  if (!studentIds.length) return map;
  for (let i = 0; i < studentIds.length; i += 200) {
    const chunk = studentIds.slice(i, i + 200);
    const { data } = await svc.from("student_guardians")
      .select("student_id, guardians(id,user_id,full_name,email,phone,whatsapp_phone,notify_email,notify_whatsapp,notify_sms,portal_token,language,push_subscriptions(id))")
      .eq("tenant_id", tenantId).in("student_id", chunk);
    for (const row of data ?? []) {
      if (!row.guardians) continue;
      if (!map.has(row.student_id)) map.set(row.student_id, []);
      map.get(row.student_id)!.push(row.guardians as Guardian);
    }
  }
  return map;
}

export async function enqueue(svc: any, input: OutboxRow[]): Promise<string[]> {
  const ids: string[] = [];
  // Schools in "always" SMS mode get an SMS copy of every WhatsApp message.
  const rows = [...input];
  const tenants = [...new Set(input.filter(r => r.channel === "whatsapp").map(r => r.tenant_id))];
  if (tenants.length) {
    const { data: modes } = await svc.from("tenant_settings").select("tenant_id,sms_mode").in("tenant_id", tenants);
    const always = new Set((modes ?? []).filter((m: { sms_mode: string }) => m.sms_mode === "always").map((m: { tenant_id: string }) => m.tenant_id));
    for (const r of input) {
      if (r.channel !== "whatsapp" || !always.has(r.tenant_id)) continue;
      if (rows.some(x => x.channel === "sms" && x.to_address === r.to_address && x.kind === r.kind && x.ref_id === r.ref_id)) continue;
      rows.push({ ...r, channel: "sms", body_text: smsText(r.body_text), template_name: null, template_params: [] });
    }
  }
  for (let i = 0; i < rows.length; i += 500) {
    let { data, error } = await svc.from("message_outbox").insert(rows.slice(i, i + 500)).select("id");
    // A database not yet updated for notification choices: send without the recipient reference rather than not at all.
    if (error && /recipient_(user|guardian)_id/.test(error.message)) {
      ({ data, error } = await svc.from("message_outbox")
        .insert(rows.slice(i, i + 500).map(({ recipient_user_id: _u, recipient_guardian_id: _g, ...r }) => r)).select("id"));
    }
    if (error) throw new Error(`outbox insert failed: ${error.message}`);
    ids.push(...(data ?? []).map((r: { id: string }) => r.id));
  }
  return ids;
}

type Claimed = OutboxRow & { id: string; attempts: number };

async function deliver(svc: any, m: Claimed, brandCache: Map<string, Awaited<ReturnType<typeof loadBrand>>>) {
  let brand = brandCache.get(m.tenant_id);
  if (!brand) { brand = await loadBrand(svc, m.tenant_id); brandCache.set(m.tenant_id, brand); }
  if (m.channel === "push") return deliverPush(svc, m);
  const res = m.channel === "email"
    ? await sendEmail({ to: m.to_address, toName: m.to_name, subject: m.subject ?? brand.schoolName, text: m.body_text, html: m.body_html, fromName: brand.senderName, replyTo: brand.replyTo })
    : m.channel === "sms"
      ? await sendSms({ to: m.to_address, text: m.body_text })
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
  await smsFallback(svc, m);
  return "failed" as const;
}

async function deliverPush(svc: any, m: Claimed) {
  let { data: sub, error: subErr } = await svc.from("push_subscriptions").select("id,endpoint,p256dh,auth,kind").eq("id", m.to_address).maybeSingle();
  // Before the database update that adds app devices, every device is a web one.
  if (subErr) ({ data: sub } = await svc.from("push_subscriptions").select("id,endpoint,p256dh,auth").eq("id", m.to_address).maybeSingle());
  if (!sub) {
    await svc.from("message_outbox").update({ status: "skipped", last_error: "device unsubscribed" }).eq("id", m.id);
    return "skipped" as const;
  }
  const res = sub.kind === "fcm"
    ? await sendFcm(sub.endpoint, { title: m.subject ?? "School update", body: m.body_text, url: sitePath(m.template_params?.[0]), tag: m.kind })
    : await sendPush(sub, pushPayload({ title: m.subject ?? "School update", body: m.body_text, url: m.template_params?.[0], tag: m.kind }));
  if (res.ok) {
    await svc.from("message_outbox").update({ status: "sent", sent_at: new Date().toISOString(), last_error: null }).eq("id", m.id);
    return "sent" as const;
  }
  if (res.gone) {
    await svc.from("push_subscriptions").delete().eq("id", sub.id);
    await svc.from("message_outbox").update({ status: "skipped", last_error: res.error }).eq("id", m.id);
    return "skipped" as const;
  }
  if (res.notConfigured) {
    await svc.from("message_outbox").update({ status: "skipped", last_error: res.error }).eq("id", m.id);
    return "skipped" as const;
  }
  if (res.retryable && m.attempts < MAX_ATTEMPTS) {
    await svc.from("message_outbox").update({ status: "queued", last_error: res.error,
      next_attempt_at: new Date(Date.now() + Math.pow(2, m.attempts) * 60_000).toISOString() }).eq("id", m.id);
    return "retry" as const;
  }
  await svc.from("message_outbox").update({ status: "failed", last_error: res.error }).eq("id", m.id);
  return "failed" as const;
}

/** Push to a member of staff's devices, falling back to email when they have none. */
export async function staffRows(svc: any, p: { tenantId: string; userIds: string[]; kind: string; subject: string; text: string; url: string; refId?: string | null }): Promise<OutboxRow[]> {
  if (!p.userIds.length) return [];
  const [{ data: users }, { data: subs }] = await Promise.all([
    svc.from("users").select("id,full_name,email").eq("tenant_id", p.tenantId).in("id", p.userIds),
    svc.from("push_subscriptions").select("id,user_id").eq("tenant_id", p.tenantId).in("user_id", p.userIds)
  ]);
  const rows: OutboxRow[] = [];
  for (const u of users ?? []) {
    const mine = (subs ?? []).filter((x: { user_id: string }) => x.user_id === u.id);
    for (const sub of mine) {
      rows.push({ tenant_id: p.tenantId, channel: "push", to_address: sub.id, to_name: u.full_name, kind: p.kind,
        subject: p.subject, body_text: p.text.slice(0, 240), template_params: [p.url], ref_id: p.refId ?? null, recipient_user_id: u.id });
    }
    if (!mine.length && u.email) {
      rows.push({ tenant_id: p.tenantId, channel: "email", to_address: u.email, to_name: u.full_name, kind: p.kind,
        subject: p.subject, body_text: `${p.text}\n\nOpen: ${p.url}`, ref_id: p.refId ?? null, recipient_user_id: u.id });
    }
  }
  return rows;
}

/**
 * WhatsApp failed for good (number not on WhatsApp, template rejected, retries
 * exhausted): send the same message by SMS when the school allows it.
 */
async function smsFallback(svc: any, m: Claimed) {
  if (m.channel !== "whatsapp") return;
  const { data: s } = await svc.from("tenant_settings").select("sms_mode").eq("tenant_id", m.tenant_id).maybeSingle();
  if ((s?.sms_mode ?? "fallback") === "off") return;
  // Do not double up if an SMS for the same message already exists (e.g. "always" mode).
  let dup = svc.from("message_outbox").select("id").eq("tenant_id", m.tenant_id).eq("channel", "sms")
    .eq("to_address", m.to_address).eq("kind", m.kind).gte("created_at", new Date(Date.now() - 86400_000).toISOString());
  dup = m.ref_id ? dup.eq("ref_id", m.ref_id) : dup.eq("body_text", smsText(m.body_text));
  const { data: existing } = await dup.limit(1);
  if (existing?.length) return;
  await svc.from("message_outbox").insert({
    tenant_id: m.tenant_id, channel: "sms", to_address: m.to_address, to_name: m.to_name ?? null, kind: m.kind,
    subject: m.subject ?? null, body_text: smsText(m.body_text), ref_id: m.ref_id ?? null, created_by: m.created_by ?? null
  });
}

/** Sends due messages with bounded concurrency until the batch or time budget runs out. */
export async function dispatchDue(svc: any, opts: { limit?: number; budgetMs?: number; concurrency?: number } = {}) {
  const started = Date.now();
  const budget = opts.budgetMs ?? 20_000;
  const stats = { sent: 0, failed: 0, retry: 0, skipped: 0, held: 0 };
  const brandCache = new Map<string, Awaited<ReturnType<typeof loadBrand>>>();
  while (Date.now() - started < budget) {
    const { data: batch, error } = await svc.rpc("claim_outbox", { p_limit: opts.limit ?? 50 });
    if (error) throw new Error(`claim_outbox failed: ${error.message}`);
    const claimed = (batch ?? []) as Claimed[];
    if (!claimed.length) break;
    const screened = await screenByPrefs(svc, claimed).catch(() => ({ send: claimed, held: 0, muted: 0 }));
    stats.held += screened.held; stats.skipped += screened.muted;
    const rows = screened.send;
    const conc = opts.concurrency ?? 8;
    for (let i = 0; i < rows.length; i += conc) {
      const results = await Promise.all(rows.slice(i, i + conc).map(m => deliver(svc, m, brandCache).catch(async (e) => {
        await svc.from("message_outbox").update({ status: "queued", last_error: String(e?.message ?? e), next_attempt_at: new Date(Date.now() + 120_000).toISOString() }).eq("id", m.id);
        return "retry" as const;
      })));
      for (const r of results) stats[r]++;
    }
    if (claimed.length < (opts.limit ?? 50)) break;
  }
  return stats;
}

/**
 * Applies each recipient's notification choices to a claimed batch: groups
 * they turned off are skipped, and app, WhatsApp and SMS messages arriving in
 * their quiet hours go back in the queue until the quiet hours end.
 */
async function screenByPrefs(svc: any, rows: Claimed[]): Promise<{ send: Claimed[]; held: number; muted: number }> {
  const users = [...new Set(rows.map(r => r.recipient_user_id).filter(Boolean))] as string[];
  const guardians = [...new Set(rows.map(r => r.recipient_guardian_id).filter(Boolean))] as string[];
  if (!users.length && !guardians.length) return { send: rows, held: 0, muted: 0 };
  const sel = "user_id,guardian_id,muted,quiet_from,quiet_to";
  const [{ data: up }, { data: gp }] = await Promise.all([
    users.length ? svc.from("notification_prefs").select(sel).in("user_id", users) : { data: [] },
    guardians.length ? svc.from("notification_prefs").select(sel).in("guardian_id", guardians) : { data: [] }
  ]);
  const byUser = new Map<string, Prefs>((up ?? []).map((p: any) => [p.user_id, p]));
  const byGuardian = new Map<string, Prefs>((gp ?? []).map((p: any) => [p.guardian_id, p]));
  if (!byUser.size && !byGuardian.size) return { send: rows, held: 0, muted: 0 };
  const tenantIds = [...new Set(rows.map(r => r.tenant_id))];
  const { data: tz } = await svc.from("tenants").select("id,timezone").in("id", tenantIds);
  const zone = new Map<string, string>((tz ?? []).map((t: any) => [t.id, t.timezone ?? "Africa/Lagos"]));
  const send: Claimed[] = [];
  let held = 0, muted = 0;
  const now = new Date();
  for (const r of rows) {
    const prefs = (r.recipient_guardian_id && byGuardian.get(r.recipient_guardian_id)) || (r.recipient_user_id && byUser.get(r.recipient_user_id)) || null;
    if (!prefs) { send.push(r); continue; }
    if (isMuted(prefs, r.kind)) {
      await svc.from("message_outbox").update({ status: "skipped", last_error: "turned off by the recipient" }).eq("id", r.id);
      muted++; continue;
    }
    const until = quietUntil(prefs, r.kind, r.channel, now, zone.get(r.tenant_id) ?? "Africa/Lagos");
    if (until) {
      await svc.from("message_outbox").update({ status: "queued", attempts: Math.max(0, r.attempts - 1), next_attempt_at: until.toISOString(), last_error: "held for quiet hours" }).eq("id", r.id);
      held++; continue;
    }
    send.push(r);
  }
  return { send, held, muted };
}

/** Messages stuck in "sending" (process crashed mid-send) go back to the queue. */
export async function requeueStale(svc: any) {
  const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  await svc.from("message_outbox").update({ status: "queued" }).eq("status", "sending").lt("next_attempt_at", cutoff);
}

/**
 * Best-effort immediate delivery for request handlers: never throws, so a
 * provider or database hiccup cannot fail the action that queued the message.
 * Anything not sent here is picked up by /api/cron/dispatch.
 */
export async function tryDispatch(svc: any, opts: { limit?: number; budgetMs?: number; concurrency?: number } = {}) {
  try { return await dispatchDue(svc, opts); }
  catch (e) { console.error("dispatch deferred to cron:", (e as Error).message); return null; }
}
