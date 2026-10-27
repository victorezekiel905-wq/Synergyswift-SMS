import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import { metaText, verifyMetaSignature, verifyTwilioSignature } from "@/lib/whatsapp-inbox";
import { bySource } from "@/lib/crm";

describe("WhatsApp webhook signatures", () => {
  const raw = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: "2348031234567", id: "wamid.1", type: "text", text: { body: "Hello" } }] } }] }] });
  it("accepts Meta's signature made with the app secret", () => {
    const sig = "sha256=" + createHmac("sha256", "s3cret").update(raw).digest("hex");
    expect(verifyMetaSignature(raw, sig, "s3cret")).toBe(true);
  });
  it("refuses a wrong, missing or unsigned request", () => {
    expect(verifyMetaSignature(raw, "sha256=" + "0".repeat(64), "s3cret")).toBe(false);
    expect(verifyMetaSignature(raw, null, "s3cret")).toBe(false);
    expect(verifyMetaSignature(raw, "sha256=abc", undefined)).toBe(false);
  });
  it("checks Twilio's signature over the URL and sorted parameters", () => {
    const url = "https://app.example.ng/api/whatsapp/webhook";
    const params = { From: "whatsapp:+2348031234567", Body: "Hi", MessageSid: "SM1" };
    const sig = createHmac("sha1", "tok").update(url + "BodyHi" + "Fromwhatsapp:+2348031234567" + "MessageSidSM1").digest("base64");
    expect(verifyTwilioSignature(url, params, sig, "tok")).toBe(true);
    expect(verifyTwilioSignature(url, { ...params, Body: "Changed" }, sig, "tok")).toBe(false);
  });
});

describe("WhatsApp message text", () => {
  it("reads text and replies, and marks media", () => {
    expect(metaText({ type: "text", text: { body: "When is PTA?" } })).toBe("When is PTA?");
    expect(metaText({ type: "image", image: { caption: "receipt" } })).toBe("[photo] receipt");
    expect(metaText({ type: "audio" })).toBe("[voice note]");
    expect(metaText({ type: "interactive", interactive: { button_reply: { title: "Yes" } } })).toBe("Yes");
    expect(metaText({ type: "sticker" })).toBeNull();
  });
});

describe("channel return", () => {
  it("shows fees billed for every naira of marketing spend per source", () => {
    const leads = [
      { id: "a", stage: "enrolled", source: "facebook", owner_id: null, created_at: "2026-01-01", first_response_at: null },
      { id: "b", stage: "enquiry", source: "facebook", owner_id: null, created_at: "2026-01-02", first_response_at: null }
    ] as any;
    const [fb] = bySource(leads, [{ source: "facebook", amount: 100000 }], new Map([["a", 450000]]));
    expect(fb).toMatchObject({ revenue: 450000, return_per_naira: 4.5, cost_per_enrolment: 100000 });
  });
});
