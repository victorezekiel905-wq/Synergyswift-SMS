/**
 * Outbound providers. Configured entirely by environment variables so the
 * platform operator holds the credentials, not individual tenants.
 *
 * Email:    EMAIL_PROVIDER=resend|sendgrid, RESEND_API_KEY | SENDGRID_API_KEY, EMAIL_FROM
 * WhatsApp: WHATSAPP_PROVIDER=meta|twilio
 *   meta:   WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TEMPLATE_LANG (default en)
 *   twilio: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM (e.g. whatsapp:+14155238886)
 */

export type SendResult =
  | { ok: true; providerId?: string }
  | { ok: false; error: string; retryable: boolean; notConfigured?: boolean };

export type EmailMessage = { to: string; toName?: string | null; subject: string; text: string; html?: string | null; fromName?: string | null; replyTo?: string | null };
export type WhatsAppMessage = { to: string; text: string; template?: string | null; params?: string[] };

const env = (k: string) => {
  const v = process.env[k];
  return v && !v.includes("replace_me") && !v.includes("replace-with") ? v : undefined;
};

export function emailConfigured(): boolean {
  const p = env("EMAIL_PROVIDER") ?? "resend";
  return Boolean(env("EMAIL_FROM") && (p === "sendgrid" ? env("SENDGRID_API_KEY") : env("RESEND_API_KEY")));
}

export function whatsappConfigured(): boolean {
  const p = env("WHATSAPP_PROVIDER") ?? "meta";
  if (p === "twilio") return Boolean(env("TWILIO_ACCOUNT_SID") && env("TWILIO_AUTH_TOKEN") && env("TWILIO_WHATSAPP_FROM"));
  return Boolean(env("WHATSAPP_TOKEN") && env("WHATSAPP_PHONE_NUMBER_ID"));
}

/** Normalises a phone number to E.164 digits (no +). Local numbers get DEFAULT_COUNTRY_CODE. */
export function normalizePhone(raw: string | null | undefined, defaultCc = process.env.DEFAULT_COUNTRY_CODE ?? "234"): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  if (trimmed.startsWith("+")) return digits.length >= 8 ? digits : null;
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = defaultCc + digits.slice(1);
  else if (digits.length <= 10) digits = defaultCc + digits;
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

function classify(status: number): boolean {
  return status === 429 || status >= 500; // retry on throttling / provider errors only
}

async function safeText(r: Response) {
  try { return (await r.text()).slice(0, 500); } catch { return ""; }
}

export async function sendEmail(m: EmailMessage): Promise<SendResult> {
  if (!emailConfigured()) return { ok: false, error: "email provider not configured", retryable: false, notConfigured: true };
  const provider = env("EMAIL_PROVIDER") ?? "resend";
  const fromAddr = env("EMAIL_FROM")!;
  const from = m.fromName ? `${m.fromName.replace(/[<>"]/g, "")} <${fromAddr.replace(/^.*<|>.*$/g, "")}>` : fromAddr;
  try {
    if (provider === "sendgrid") {
      const r = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${env("SENDGRID_API_KEY")}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: m.to, name: m.toName ?? undefined }] }],
          from: { email: fromAddr.replace(/^.*<|>.*$/g, ""), name: m.fromName ?? undefined },
          reply_to: m.replyTo ? { email: m.replyTo } : undefined,
          subject: m.subject,
          content: [{ type: "text/plain", value: m.text }, ...(m.html ? [{ type: "text/html", value: m.html }] : [])]
        })
      });
      if (r.ok) return { ok: true, providerId: r.headers.get("x-message-id") ?? undefined };
      return { ok: false, error: `sendgrid ${r.status}: ${await safeText(r)}`, retryable: classify(r.status) };
    }
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to: [m.to], subject: m.subject, text: m.text,
        html: m.html ?? undefined, reply_to: m.replyTo ?? undefined
      })
    });
    if (r.ok) {
      const j = await r.json().catch(() => ({}));
      return { ok: true, providerId: j.id };
    }
    return { ok: false, error: `resend ${r.status}: ${await safeText(r)}`, retryable: classify(r.status) };
  } catch (e) {
    return { ok: false, error: `email network error: ${(e as Error).message}`, retryable: true };
  }
}

/**
 * WhatsApp Business rules: messages to a parent who has not messaged you in
 * the last 24h MUST use a pre-approved template. When a template name is
 * configured for the message kind we send the template; otherwise we send
 * free text, which only delivers inside an open 24h conversation.
 */
export async function sendWhatsApp(m: WhatsAppMessage): Promise<SendResult> {
  if (!whatsappConfigured()) return { ok: false, error: "whatsapp provider not configured", retryable: false, notConfigured: true };
  const to = normalizePhone(m.to);
  if (!to) return { ok: false, error: `invalid phone number: ${m.to}`, retryable: false };
  const provider = env("WHATSAPP_PROVIDER") ?? "meta";
  try {
    if (provider === "twilio") {
      const sid = env("TWILIO_ACCOUNT_SID")!;
      const form = new URLSearchParams({ From: env("TWILIO_WHATSAPP_FROM")!, To: `whatsapp:+${to}` });
      if (m.template) {
        form.set("ContentSid", m.template);
        form.set("ContentVariables", JSON.stringify(Object.fromEntries((m.params ?? []).map((p, i) => [String(i + 1), p]))));
      } else {
        form.set("Body", m.text);
      }
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: "Basic " + Buffer.from(`${sid}:${env("TWILIO_AUTH_TOKEN")}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: form
      });
      if (r.ok) { const j = await r.json().catch(() => ({})); return { ok: true, providerId: j.sid }; }
      return { ok: false, error: `twilio ${r.status}: ${await safeText(r)}`, retryable: classify(r.status) };
    }

    const version = env("WHATSAPP_API_VERSION") ?? "v20.0";
    const payload = m.template
      ? {
          messaging_product: "whatsapp", to, type: "template",
          template: {
            name: m.template,
            language: { code: env("WHATSAPP_TEMPLATE_LANG") ?? "en" },
            components: m.params?.length
              ? [{ type: "body", parameters: m.params.map(p => ({ type: "text", text: String(p).slice(0, 1000) })) }]
              : []
          }
        }
      : { messaging_product: "whatsapp", to, type: "text", text: { body: m.text.slice(0, 4096), preview_url: true } };
    const r = await fetch(`https://graph.facebook.com/${version}/${env("WHATSAPP_PHONE_NUMBER_ID")}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env("WHATSAPP_TOKEN")}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (r.ok) {
      const j = await r.json().catch(() => ({}));
      return { ok: true, providerId: j.messages?.[0]?.id };
    }
    return { ok: false, error: `whatsapp ${r.status}: ${await safeText(r)}`, retryable: classify(r.status) };
  } catch (e) {
    return { ok: false, error: `whatsapp network error: ${(e as Error).message}`, retryable: true };
  }
}
