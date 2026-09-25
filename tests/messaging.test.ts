import { describe, it, expect, afterEach } from "vitest";
import { normalizePhone, sendWhatsApp, sendEmail } from "@/lib/messaging/providers";
import { resultPublished, gateEvent, pickupCode, escapeHtml } from "@/lib/messaging/templates";
import { rowsForGuardian } from "@/lib/messaging/outbox";
import { pickupCodeHash, randomDigits } from "@/lib/crypto";

const brand = { schoolName: "Green Hills Academy", color: "#0a7", address: "1 School Rd" };

describe("normalizePhone", () => {
  it("handles local, international and messy formats", () => {
    expect(normalizePhone("08012345678", "234")).toBe("2348012345678");
    expect(normalizePhone("+234 801 234 5678")).toBe("2348012345678");
    expect(normalizePhone("+44 7700 900123")).toBe("447700900123");
    expect(normalizePhone("00447700900123")).toBe("447700900123");
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("12")).toBeNull();
  });
});

describe("templates", () => {
  it("result message includes link, average and position", () => {
    const r = resultPublished(brand, {
      guardianName: "Mrs Okafor", studentName: "Chidi Okafor", termName: "First Term 2025/2026",
      average: 71.5, position: 3, classSize: 30, showPosition: true, link: "https://x/r/tok",
      subjects: [{ subject: "Maths", total: 80, grade: "A1" }]
    });
    expect(r.text).toContain("https://x/r/tok");
    expect(r.wa.text).toContain("71.5%");
    expect(r.wa.params).toHaveLength(6);
    expect(r.html).toContain("Maths");
  });
  it("hides position when the school does", () => {
    const r = resultPublished(brand, {
      guardianName: "G", studentName: "S", termName: "T", average: 50, position: 3, classSize: 30,
      showPosition: false, link: "l", subjects: []
    });
    expect(r.text).not.toContain("position");
  });
  it("escapes HTML from user-entered names", () => {
    const r = gateEvent(brand, { guardianName: "<script>x</script>", studentName: "A", direction: "in", time: "7:40 am", date: "Mon" });
    expect(r.html).not.toContain("<script>x");
    expect(escapeHtml(`"'&`)).toBe("&quot;&#39;&amp;");
  });
  it("pickup message carries the code", () => {
    expect(pickupCode(brand, { guardianName: "G", studentName: "S", code: "123456", expires: "4pm", collector: "Driver" }).wa.text).toContain("123456");
  });
});

describe("rowsForGuardian", () => {
  const r = gateEvent(brand, { guardianName: "G", studentName: "S", direction: "out", time: "t", date: "d" });
  it("respects channel preferences and validates addresses", () => {
    const g = { id: "g", full_name: "G", email: "g@x.com", phone: "08012345678", whatsapp_phone: null, notify_email: true, notify_whatsapp: true };
    const rows = rowsForGuardian("t1", g, "gate_out", r, null, null);
    expect(rows.map(x => x.channel)).toEqual(["email", "whatsapp"]);
    expect(rows[1].to_address).toBe("2348012345678");
    expect(rowsForGuardian("t1", { ...g, notify_email: false }, "k", r, null, null).map(x => x.channel)).toEqual(["whatsapp"]);
    expect(rowsForGuardian("t1", { ...g, email: "bad", phone: null }, "k", r, null, null)).toEqual([]);
  });
});

describe("providers without configuration", () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });
  it("report not-configured instead of pretending to send", async () => {
    delete process.env.WHATSAPP_TOKEN; delete process.env.RESEND_API_KEY; delete process.env.EMAIL_FROM;
    expect(await sendWhatsApp({ to: "08012345678", text: "x" })).toMatchObject({ ok: false, notConfigured: true });
    expect(await sendEmail({ to: "a@b.c", subject: "s", text: "t" })).toMatchObject({ ok: false, notConfigured: true });
  });
});

describe("pickup codes", () => {
  it("are 6 random digits and hashed per tenant", () => {
    const c = randomDigits(6);
    expect(c).toMatch(/^\d{6}$/);
    expect(pickupCodeHash("t1", c)).not.toBe(pickupCodeHash("t2", c));
    expect(pickupCodeHash("t1", ` ${c} `)).toBe(pickupCodeHash("t1", c));
  });
});
