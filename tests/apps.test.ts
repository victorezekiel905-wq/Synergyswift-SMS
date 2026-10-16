import { describe, it, expect } from "vitest";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { groupOf, isMuted, quietUntil, cleanPrefs, MUTABLE } from "@/lib/notify-prefs";
import { serviceJwt, fcmMessage, fcmOutcome } from "@/lib/messaging/fcm";

describe("groupOf", () => {
  it("puts message kinds in groups, safety first", () => {
    expect(groupOf("emergency")).toBe("safety");
    expect(groupOf("safeguarding")).toBe("safety");
    expect(groupOf("pickup_code")).toBe("safety");
    expect(groupOf("health")).toBe("safety");
    expect(groupOf("trip")).toBe("safety");
    expect(groupOf("absence")).toBe("attendance");
    expect(groupOf("lesson_absence")).toBe("attendance");
    expect(groupOf("exeat")).toBe("attendance");
    expect(groupOf("result")).toBe("learning");
    expect(groupOf("fee_reminder")).toBe("fees");
    expect(groupOf("wallet_topup")).toBe("fees");
    expect(groupOf("bus_near")).toBe("transport");
    expect(groupOf("library_overdue")).toBe("activities");
    expect(groupOf("club")).toBe("activities");
    expect(groupOf("leave_decided")).toBe("work");
    expect(groupOf("payslip_ready")).toBe("work");
    expect(groupOf("scheduled_summary")).toBe("work");
    expect(groupOf("broadcast")).toBe("messages");
    expect(groupOf("message")).toBe("messages");
    expect(groupOf("survey")).toBe("messages");
    expect(groupOf("something_new")).toBe("other");
    expect(groupOf("")).toBe("other");
  });
});

describe("isMuted", () => {
  it("honours the person's choices but never mutes safety", () => {
    const p = { muted: ["fees", "messages"] };
    expect(isMuted(p, "fee_receipt")).toBe(true);
    expect(isMuted(p, "broadcast")).toBe(true);
    expect(isMuted(p, "absence")).toBe(false);
    expect(isMuted({ muted: ["safety", "other"] }, "emergency")).toBe(false);
    expect(isMuted(null, "fee_receipt")).toBe(false);
  });
});

describe("quietUntil", () => {
  const tz = "Africa/Lagos"; // UTC+1, no daylight saving
  const night = { quiet_from: "21:00", quiet_to: "06:30" };
  it("holds app, WhatsApp and SMS messages overnight until the end of quiet hours", () => {
    // 22:30 Lagos on the 16th → held until 06:30 Lagos on the 17th (05:30 UTC).
    expect(quietUntil(night, "absence", "push", new Date("2026-10-16T21:30:00Z"), tz)?.toISOString()).toBe("2026-10-17T05:30:00.000Z");
    // 02:00 Lagos on the 17th → 06:30 the same morning.
    expect(quietUntil(night, "absence", "whatsapp", new Date("2026-10-17T01:00:00Z"), tz)?.toISOString()).toBe("2026-10-17T05:30:00.000Z");
  });
  it("lets messages go outside quiet hours, by email, and for safety", () => {
    expect(quietUntil(night, "absence", "push", new Date("2026-10-16T12:00:00Z"), tz)).toBeNull();
    expect(quietUntil(night, "absence", "email", new Date("2026-10-16T21:30:00Z"), tz)).toBeNull();
    expect(quietUntil(night, "emergency", "sms", new Date("2026-10-16T21:30:00Z"), tz)).toBeNull();
    expect(quietUntil({}, "absence", "push", new Date("2026-10-16T21:30:00Z"), tz)).toBeNull();
    // The end of quiet hours is not inside them.
    expect(quietUntil(night, "absence", "push", new Date("2026-10-17T05:30:00Z"), tz)).toBeNull();
  });
  it("handles quiet hours within one day", () => {
    const lunch = { quiet_from: "12:00:00", quiet_to: "13:00:00" };
    expect(quietUntil(lunch, "result", "push", new Date("2026-10-16T11:15:00Z"), tz)?.toISOString()).toBe("2026-10-16T12:00:00.000Z");
    expect(quietUntil(lunch, "result", "push", new Date("2026-10-16T12:15:00Z"), tz)).toBeNull();
  });
});

describe("cleanPrefs", () => {
  it("keeps known groups and a full pair of times", () => {
    expect(cleanPrefs({ muted: ["fees", "safety", "nonsense", "fees"], quiet_from: "21:00", quiet_to: "06:30" })).toEqual({ muted: ["fees"], quiet_from: "21:00", quiet_to: "06:30" });
    expect(cleanPrefs({ muted: "fees", quiet_from: "21:00" })).toEqual({ muted: [], quiet_from: null, quiet_to: null });
    expect(cleanPrefs({ quiet_from: "25:00", quiet_to: "06:00" })).toMatchObject({ quiet_from: null, quiet_to: null });
    expect(cleanPrefs({ quiet_from: "06:00", quiet_to: "06:00" })).toMatchObject({ quiet_from: null });
    expect(MUTABLE).not.toContain("safety");
  });
});

describe("Firebase messages", () => {
  it("signs the service-account request with the private key", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const jwt = serviceJwt("app@proj.iam.gserviceaccount.com", pem, 1_800_000_000);
    const [h, c, s] = jwt.split(".");
    const claims = JSON.parse(Buffer.from(c, "base64url").toString());
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    expect(claims).toMatchObject({ iss: "app@proj.iam.gserviceaccount.com", aud: "https://oauth2.googleapis.com/token", iat: 1_800_000_000, exp: 1_800_003_600 });
    expect(claims.scope).toContain("firebase.messaging");
    const v = createVerify("RSA-SHA256"); v.update(`${h}.${c}`);
    expect(v.verify(publicKey, Buffer.from(s, "base64url"))).toBe(true);
  });
  it("builds a notification that opens the page when tapped", () => {
    const m = fcmMessage("tok", { title: "x".repeat(100), body: "Ada signed in", url: "/parent", tag: "gate" });
    expect(m.message.token).toBe("tok");
    expect(m.message.notification.title).toHaveLength(80);
    expect(m.message.data).toEqual({ url: "/parent", tag: "gate" });
    expect(m.message.android.priority).toBe("HIGH");
    expect(m.message.apns.payload.aps).toMatchObject({ sound: "default", "thread-id": "gate" });
    expect(fcmMessage("t", { title: "a", body: "b", url: "/" }).message.data).toEqual({ url: "/" });
  });
  it("drops phones that left and retries busy errors", () => {
    expect(fcmOutcome(404, "UNREGISTERED")).toEqual({ gone: true, retryable: false });
    expect(fcmOutcome(400, "INVALID_ARGUMENT").gone).toBe(true);
    expect(fcmOutcome(429, "QUOTA_EXCEEDED")).toEqual({ gone: false, retryable: true });
    expect(fcmOutcome(503)).toEqual({ gone: false, retryable: true });
    expect(fcmOutcome(401, "THIRD_PARTY_AUTH_ERROR")).toEqual({ gone: false, retryable: false });
  });
});
