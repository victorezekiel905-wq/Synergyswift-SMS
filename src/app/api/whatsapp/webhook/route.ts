import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { absoluteRequestUrl } from "@/lib/exams/seb";
import { metaText, receiveWhatsApp, verifyMetaSignature, verifyTwilioSignature } from "@/lib/whatsapp-inbox";

export const dynamic = "force-dynamic";

/**
 * Incoming WhatsApp messages (phase 14g-3). Meta Cloud API: subscribe this URL with
 * WHATSAPP_VERIFY_TOKEN; requests are signed with WHATSAPP_APP_SECRET. Twilio: set it as the
 * WhatsApp sender's incoming-message webhook; requests are signed with TWILIO_AUTH_TOKEN.
 * Unsigned or wrongly signed requests are refused.
 */
export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (token && u.searchParams.get("hub.mode") === "subscribe" && u.searchParams.get("hub.verify_token") === token) {
    return new NextResponse(u.searchParams.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse("forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  const svc = createServiceClient();
  const base = appUrl(req);
  const raw = await req.text();
  if ((process.env.WHATSAPP_PROVIDER ?? "meta") === "twilio") {
    const params = Object.fromEntries(new URLSearchParams(raw)) as Record<string, string>;
    if (!verifyTwilioSignature(absoluteRequestUrl(req), params, req.headers.get("x-twilio-signature"))) return new NextResponse("bad signature", { status: 401 });
    const from = (params.From ?? "").replace(/^whatsapp:/, "");
    const media = Number(params.NumMedia ?? 0) > 0 ? "[photo or file] " : "";
    if (from && (params.Body || media)) await receiveWhatsApp(svc, { from, name: params.ProfileName ?? null, body: `${media}${params.Body ?? ""}`.trim(), providerId: params.MessageSid ?? params.SmsSid }, base);
    return new NextResponse("<Response></Response>", { headers: { "Content-Type": "text/xml" } });
  }
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"))) return new NextResponse("bad signature", { status: 401 });
  let body: any = {};
  try { body = JSON.parse(raw); } catch { return new NextResponse("bad body", { status: 400 }); }
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      const names = new Map<string, string>((v.contacts ?? []).map((c: any) => [c.wa_id, c.profile?.name ?? null]));
      for (const m of v.messages ?? []) {
        const text = metaText(m);
        if (!text || !m.from || !m.id) continue;
        await receiveWhatsApp(svc, { from: m.from, name: names.get(m.from) ?? null, body: text, providerId: m.id }, base).catch(e => console.error("whatsapp inbound:", (e as Error).message));
      }
    }
  }
  // Always 200 for signed requests, so WhatsApp does not keep retrying a message we chose to skip.
  return NextResponse.json({ ok: true });
}
