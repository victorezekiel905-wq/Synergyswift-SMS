import { describe, it, expect } from "vitest";
import { createHash, createHmac } from "crypto";
import { unwrapJsonp, normaliseRemita, remitaPaymentPage, normaliseStripe, stripeMinor, verifyStripeSignature } from "@/lib/payments-more";

describe("Remita", () => {
  it("reads replies wrapped in jsonp", () => {
    expect(unwrapJsonp('jsonp ({"statuscode":"025","RRR":"280007021192","status":"Payment Reference generated"})')).toMatchObject({ RRR: "280007021192" });
    expect(unwrapJsonp('{"status":"00"}')).toEqual({ status: "00" });
    expect(unwrapJsonp("not json")).toBeNull();
  });
  it("treats 00 and 01 as paid", () => {
    expect(normaliseRemita({ status: "00", amount: 15000 }, "NGN")).toEqual({ status: "success", amount: 15000, currency: "NGN" });
    expect(normaliseRemita({ status: "01", amount: "15000.00" }, "NGN").status).toBe("success");
    expect(normaliseRemita({ status: "021" }, "NGN").status).toBe("pending");
    expect(normaliseRemita({ status: "02" }, "NGN").status).toBe("failed");
  });
  it("signs the payment page and escapes what it shows", () => {
    const c = { merchant_id: "2547916", service_type_id: "4430731", api_key: "1946" };
    const html = remitaPaymentPage(c, "280007021192", "https://school.example/api/pay/verify?reference=FEE-1&x=\"y\"");
    expect(html).toContain(`value="${createHash("sha512").update("2547916" + "280007021192" + "1946").digest("hex")}"`);
    expect(html).toContain("https://demo.remita.net/remita/ecomm/finalize.reg");
    expect(html).toContain("&quot;y&quot;");
    expect(remitaPaymentPage({ ...c, live: true }, "1", "https://x")).toContain("https://login.remita.net/");
  });
});

describe("Stripe", () => {
  it("uses the currency's minor unit", () => {
    expect(stripeMinor(1234.56, "NGN")).toBe(123456);
    expect(stripeMinor(5000, "jpy")).toBe(5000);
  });
  it("reads checkout sessions", () => {
    expect(normaliseStripe({ payment_status: "paid", amount_total: 2500000, currency: "ngn" })).toEqual({ status: "success", amount: 25000, currency: "NGN" });
    expect(normaliseStripe({ payment_status: "unpaid", status: "open", amount_total: 100, currency: "usd" }).status).toBe("pending");
    expect(normaliseStripe({ payment_status: "unpaid", status: "expired", amount_total: 100, currency: "usd" }).status).toBe("failed");
  });
  it("checks webhook signatures and their age", () => {
    const secret = "whsec_test", body = '{"id":"evt_1"}', now = 1_800_000_000_000, t = now / 1000;
    const sig = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
    expect(verifyStripeSignature(body, `t=${t},v1=${sig}`, secret, now)).toBe(true);
    expect(verifyStripeSignature(body, `t=${t},v1=${"0".repeat(64)},v1=${sig}`, secret, now)).toBe(true);
    expect(verifyStripeSignature(body + " ", `t=${t},v1=${sig}`, secret, now)).toBe(false);
    expect(verifyStripeSignature(body, `t=${t},v1=${sig}`, "other", now)).toBe(false);
    expect(verifyStripeSignature(body, `t=${t},v1=${sig}`, secret, now + 10 * 60_000)).toBe(false);
    expect(verifyStripeSignature(body, null, secret, now)).toBe(false);
  });
});
