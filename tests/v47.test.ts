import { describe, it, expect } from "vitest";
import { stopsToAlert, isLive, APPROACH_RADIUS_M } from "@/lib/bus";
import { suggestCover, isoDay, weekBounds } from "@/lib/cover";
import { basketTotal, safeReturnPath, WalletError } from "@/lib/wallet";
import { needsTranslation, languageName } from "@/lib/languages";
import { pushPayload, sitePath } from "@/lib/messaging/push";
import { rowsForGuardian, type Guardian } from "@/lib/messaging/outbox";
import { newMessage, busApproaching, walletLow } from "@/lib/messaging/notices";

describe("live bus", () => {
  const stops = [
    { name: "Allen Avenue", lat: 6.6018, lng: 3.3515 },
    { name: "Ikeja GRA", lat: 6.5833, lng: 3.35 },
    { name: "No coordinates" }
  ];
  it("alerts only stops within the radius that were not alerted yet", () => {
    const nearAllen = { lat: 6.6005, lng: 3.3515 }; // about 145 m away
    expect(stopsToAlert(nearAllen, stops, [])).toEqual(["Allen Avenue"]);
    expect(stopsToAlert(nearAllen, stops, ["Allen Avenue"])).toEqual([]);
  });
  it("ignores stops without coordinates and far-away stops", () => {
    expect(stopsToAlert({ lat: 6.45, lng: 3.39 }, stops, [])).toEqual([]);
    expect(APPROACH_RADIUS_M).toBeGreaterThan(500);
  });
  it("treats a position as live only while the trip runs and the fix is fresh", () => {
    const now = Date.parse("2026-09-25T07:30:00Z");
    expect(isLive({ ended_at: null, updated_at: "2026-09-25T07:25:00Z" }, now)).toBe(true);
    expect(isLive({ ended_at: null, updated_at: "2026-09-25T07:00:00Z" }, now)).toBe(false);
    expect(isLive({ ended_at: "2026-09-25T07:29:00Z", updated_at: "2026-09-25T07:28:00Z" }, now)).toBe(false);
    expect(isLive(null, now)).toBe(false);
  });
});

describe("cover", () => {
  it("works out ISO days and week bounds", () => {
    expect(isoDay("2026-09-21")).toBe(1);
    expect(isoDay("2026-09-27")).toBe(7);
    expect(weekBounds("2026-09-24")).toEqual({ from: "2026-09-21", to: "2026-09-27" });
  });
  it("never suggests someone teaching, absent or already covering that period", () => {
    const staff = [
      { id: "absent", name: "Ade", role: "teacher" },
      { id: "busy", name: "Bola", role: "teacher" },
      { id: "covering", name: "Chi", role: "teacher" },
      { id: "free", name: "Dayo", role: "teacher" },
      { id: "busyweek", name: "Efe", role: "teacher" },
      { id: "admin", name: "Funmi", role: "school_admin" }
    ];
    const out = suggestCover({
      lessons: [{ entryId: "L1", periodId: "P1", teacherId: "absent" }, { entryId: "L2", periodId: "P1", teacherId: "absent2" }],
      staff,
      teachingThatDay: [{ teacherId: "busy", periodId: "P1" }],
      absent: new Set(["absent"]),
      assigned: [{ coverUserId: "covering", periodId: "P1", entryId: "L2" }],
      weekCounts: new Map([["busyweek", 3]])
    });
    // Teachers first, then fewest covers this week; the admin comes last.
    expect(out.get("L1")!.map(c => c.id)).toEqual(["free", "busyweek", "admin"]);
    // The person already covering L2 can still be shown for L2 itself.
    expect(out.get("L2")!.map(c => c.id)).toContain("covering");
  });
});

describe("wallet", () => {
  const catalogue = [
    { id: "a", name: "Juice", price: 300, active: true },
    { id: "b", name: "Meat pie", price: 450.5, active: true },
    { id: "c", name: "Old item", price: 100, active: false }
  ];
  it("prices the basket from the catalogue, never from the client", () => {
    const r = basketTotal([{ id: "a", qty: 2 }, { id: "b", qty: 1 }], catalogue);
    expect(r.total).toBe(1050.5);
    expect(r.lines).toEqual([{ id: "a", name: "Juice", qty: 2, price: 300 }, { id: "b", name: "Meat pie", qty: 1, price: 450.5 }]);
  });
  it("rejects items that are not for sale", () => {
    expect(() => basketTotal([{ id: "c", qty: 1 }], catalogue)).toThrow(WalletError);
    expect(() => basketTotal([{ id: "zz", qty: 1 }], catalogue)).toThrow(WalletError);
  });
  it("only returns to the parent portal after checkout", () => {
    expect(safeReturnPath("/parent")).toBe("/parent");
    expect(safeReturnPath("/g/" + "a".repeat(48))).toBe("/g/" + "a".repeat(48));
    expect(safeReturnPath("https://evil.example")).toBe("/");
    expect(safeReturnPath("//evil.example")).toBe("/");
    expect(safeReturnPath("/school/fees")).toBe("/");
  });
});

describe("translation and push", () => {
  it("translates only when the parent chose a different, supported language", () => {
    expect(needsTranslation("yo", "en")).toBe(true);
    expect(needsTranslation("en", "en")).toBe(false);
    expect(needsTranslation(null, "en")).toBe(false);
    expect(needsTranslation("xx", "en")).toBe(false);
    expect(languageName("ha")).toBe("Hausa");
  });
  it("keeps push links on this site", () => {
    expect(sitePath("https://school.example/school/inbox?c=1")).toBe("/school/inbox?c=1");
    expect(sitePath("/g/abc#messages")).toBe("/g/abc#messages");
    expect(sitePath("//evil.example/x")).toBe("/");
    expect(sitePath(null)).toBe("/");
    const p = JSON.parse(pushPayload({ title: "x".repeat(200), body: "y".repeat(500), url: "https://a.b/parent", tag: "bus" }));
    expect(p.title).toHaveLength(80);
    expect(p.body).toHaveLength(240);
    expect(p.url).toBe("/parent");
  });
  it("adds a push row for every device a parent registered", () => {
    const g: Guardian = { id: "g1", full_name: "Mum", email: null, phone: null, whatsapp_phone: null, notify_email: true, notify_whatsapp: true,
      portal_token: "t0k3n", user_id: null, push_subscriptions: [{ id: "s1" }, { id: "s2" }] };
    const rows = rowsForGuardian("t", g, "message", newMessage({ schoolName: "Green Hills" }, { guardianName: "Mum", from: "Mr Obi", subject: "Homework", text: "Please check the maths.", link: "https://x/g/t0k3n#messages" }), "c1", null);
    expect(rows.map(r => r.channel)).toEqual(["push", "push"]);
    expect(rows[0].to_address).toBe("s1");
    expect(rows[0].template_params).toEqual(["/g/t0k3n"]);
  });
});

describe("v47 notices", () => {
  const b = { schoolName: "Green Hills" };
  it("builds WhatsApp parameters in template order", () => {
    expect(newMessage(b, { guardianName: "G", from: "Mr Obi", subject: "Trip", text: "Hi", link: "L" }).wa.params).toEqual(["Green Hills", "Mr Obi", "Trip", "L"]);
    expect(busApproaching(b, { guardianName: "G", studentName: "Ada", route: "Route 1", stop: "Allen", trip: "morning" }).text).toContain("have Ada ready");
    expect(walletLow(b, { guardianName: "G", studentName: "Ada", balance: "₦200", link: "L" }).wa.params).toHaveLength(4);
  });
});
