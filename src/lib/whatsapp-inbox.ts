/**
 * Two-way WhatsApp (phase 14g-3): a parent's WhatsApp message to the school's number lands in
 * the shared school-office inbox, in an open WhatsApp thread for that family (one per family).
 * The platform has one WhatsApp number for every school, so the family is found by phone; when
 * the same number belongs to families in two schools, the school that last messaged it wins.
 */
import { createHmac, timingSafeEqual } from "crypto";
import { normalizePhone } from "@/lib/messaging/providers";
import { postMessage, MessagingError } from "@/lib/conversations";

export type Inbound = { from: string; name?: string | null; body: string; providerId: string };

const eq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** Meta (WhatsApp Cloud API): X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(app secret, raw body). */
export function verifyMetaSignature(raw: string, header: string | null, secret = process.env.WHATSAPP_APP_SECRET) {
  if (!secret || !header?.startsWith("sha256=")) return false;
  return eq(header.slice(7), createHmac("sha256", secret).update(raw).digest("hex"));
}

/** Twilio: X-Twilio-Signature = base64(HMAC-SHA1(auth token, URL + each POST param name and value, sorted by name)). */
export function verifyTwilioSignature(url: string, params: Record<string, string>, header: string | null, token = process.env.TWILIO_AUTH_TOKEN) {
  if (!token || !header) return false;
  const data = url + Object.keys(params).sort().map(k => k + params[k]).join("");
  return eq(header, createHmac("sha1", token).update(data).digest("base64"));
}

/** Text of a Meta message, with a placeholder for media (photos and voice notes stay in WhatsApp). */
export function metaText(m: any): string | null {
  switch (m?.type) {
    case "text": return m.text?.body ?? null;
    case "button": return m.button?.text ?? null;
    case "interactive": return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null;
    case "image": return `[photo]${m.image?.caption ? ` ${m.image.caption}` : ""}`;
    case "video": return `[video]${m.video?.caption ? ` ${m.video.caption}` : ""}`;
    case "document": return `[document${m.document?.filename ? `: ${m.document.filename}` : ""}]`;
    case "audio": return "[voice note]";
    case "location": return "[location]";
    case "sticker": return null;
    default: return null;
  }
}

/** Files one incoming WhatsApp message. Returns where it went (or that no school knows the number). */
export async function receiveWhatsApp(svc: any, m: Inbound, baseUrl: string) {
  const phone = normalizePhone(m.from);
  if (!phone || !m.body.trim()) return { status: "ignored" as const };
  const { data: matches } = await svc.rpc("guardians_by_phone", { p_digits: phone });
  let g = (matches ?? [])[0] as { guardian_id: string; tenant_id: string; full_name: string } | undefined;
  if ((matches ?? []).length > 1) {
    const { data: recent } = await svc.from("message_outbox").select("tenant_id").in("to_address", [phone, `+${phone}`]).order("created_at", { ascending: false }).limit(1);
    g = (matches ?? []).find((x: any) => x.tenant_id === recent?.[0]?.tenant_id) ?? g;
  }
  if (!g) {
    await svc.from("whatsapp_unmatched").insert({ from_phone: phone, name: m.name ?? null, body: m.body.slice(0, 4000), provider_id: m.providerId });
    return { status: "unmatched" as const };
  }
  let { data: c } = await svc.from("conversations").select("id").eq("tenant_id", g.tenant_id).eq("guardian_id", g.guardian_id).eq("channel", "whatsapp").eq("status", "open")
    .order("last_message_at", { ascending: false }).limit(1).maybeSingle();
  if (!c) {
    const { data: kid } = await svc.from("student_guardians").select("student_id").eq("guardian_id", g.guardian_id).limit(1).maybeSingle();
    const ins = await svc.from("conversations").insert({ tenant_id: g.tenant_id, guardian_id: g.guardian_id, student_id: kid?.student_id ?? null, staff_user_id: null,
      subject: "WhatsApp", started_by: "guardian", channel: "whatsapp" }).select("id").single();
    c = ins.data;
  }
  if (!c) return { status: "error" as const };
  try {
    const r = await postMessage(svc, { tenantId: g.tenant_id, conversationId: c.id, sender: { kind: "guardian", guardianId: g.guardian_id, name: g.full_name },
      body: m.body.slice(0, 4000), baseUrl, channel: "whatsapp", providerId: m.providerId });
    return { status: (r as { duplicate?: boolean }).duplicate ? "duplicate" as const : "filed" as const, tenant_id: g.tenant_id, conversation_id: c.id };
  } catch (e) {
    if (e instanceof MessagingError) return { status: "limited" as const };
    throw e;
  }
}
