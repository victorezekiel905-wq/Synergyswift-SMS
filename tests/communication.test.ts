import { describe, it, expect } from "vitest";
import { fillTemplate, joinNames, safeguardingFlags, withinMessagingHours, readStats, conferenceSlots, clashesWith, EMERGENCY_TEMPLATES } from "@/lib/communication";

describe("templates", () => {
  it("fills placeholders and never leaves a known one in braces", () => {
    expect(fillTemplate("Dear {parent_name}, {child_names} in {class} at {school}.", { parent_name: "Mrs Obi", child_names: "Ada and Tunde", class: "JSS1", school: "Alpha" }))
      .toBe("Dear Mrs Obi, Ada and Tunde in JSS1 at Alpha.");
    expect(fillTemplate("Hello {parent_name}, about {child_name}", {})).toBe("Hello Parent, about your child");
    expect(fillTemplate("Keep {unknown} and { school }", { school: "Alpha" })).toBe("Keep {unknown} and Alpha");
  });
  it("joins names naturally", () => {
    expect(joinNames(["Ada"])).toBe("Ada");
    expect(joinNames(["Ada", "Tunde"])).toBe("Ada and Tunde");
    expect(joinNames(["Ada", "Tunde", "Bola", "Ada"])).toBe("Ada, Tunde and Bola");
    expect(joinNames([])).toBe("");
  });
  it("emergency templates use only known placeholders", () => {
    for (const t of EMERGENCY_TEMPLATES) expect(fillTemplate(t.body, { school: "S", child_names: "C" })).not.toMatch(/\{[a-z_]+\}/);
  });
});

describe("safeguarding", () => {
  it("flags contact details, private apps, secrets, meetings and risk", () => {
    expect(safeguardingFlags("Call me on 0803 123 4567 tonight")).toEqual(["a phone number"]);
    expect(safeguardingFlags("my email is tunde@example.com")).toEqual(["an email address"]);
    expect(safeguardingFlags("Add me on Snapchat")).toEqual(["a social media or private chat app"]);
    expect(safeguardingFlags("This is our secret, don't tell your parents")).toEqual(["a request to meet or keep a secret"]);
    expect(safeguardingFlags("Come to my house after school")).toEqual(["a request to meet or keep a secret"]);
    expect(safeguardingFlags("Sometimes I want to die")).toEqual(["a sign the student may be at risk"]);
    expect(safeguardingFlags("send me a pic")).toEqual(["a remark about appearance"]);
  });
  it("leaves ordinary schoolwork alone", () => {
    for (const ok of ["Please hand in your essay by Friday.", "Question 4: 1234 + 5678 = 6912", "Read chapter 3 of the novel", "Well done on the test, 18/20!", "Meet the deadline please"]) {
      expect(safeguardingFlags(ok)).toEqual([]);
    }
  });
  it("allows staff to message only on school days within the hours", () => {
    // 2026-03-02 is a Monday; Lagos is UTC+1.
    expect(withinMessagingHours(new Date("2026-03-02T09:00:00Z"), "Africa/Lagos", "07:00", "18:00")).toBe(true);
    expect(withinMessagingHours(new Date("2026-03-02T17:30:00Z"), "Africa/Lagos", "07:00", "18:00")).toBe(false);
    expect(withinMessagingHours(new Date("2026-03-02T05:30:00Z"), "Africa/Lagos", "07:00", "18:00")).toBe(false);
    expect(withinMessagingHours(new Date("2026-03-07T10:00:00Z"), "Africa/Lagos", "07:00", "18:00")).toBe(false);
  });
});

describe("read receipts", () => {
  it("counts read and confirmed", () => {
    expect(readStats([{ read_at: "x", acknowledged_at: "x" }, { read_at: "x", acknowledged_at: null }, { read_at: null, acknowledged_at: null }, { read_at: null, acknowledged_at: null }]))
      .toEqual({ total: 4, read: 2, acknowledged: 1, unread: 2, read_pct: 50, ack_pct: 25 });
    expect(readStats([]).read_pct).toBe(0);
  });
});

describe("parent-teacher evenings", () => {
  it("makes appointment slots in the school's time", () => {
    const s = conferenceSlots({ date: "2026-03-05", start: "16:00", end: "17:00", slotMinutes: 10, gapMinutes: 2, timeZone: "Africa/Lagos" });
    expect(s).toHaveLength(5);
    expect(s[0]).toEqual({ starts_at: "2026-03-05T15:00:00.000Z", ends_at: "2026-03-05T15:10:00.000Z" });
    expect(s[1].starts_at).toBe("2026-03-05T15:12:00.000Z");
    expect(conferenceSlots({ date: "2026-03-05", start: "17:00", end: "16:00", slotMinutes: 10, gapMinutes: 0, timeZone: "Africa/Lagos" })).toEqual([]);
  });
  it("stops a parent booking two places at once", () => {
    const booked = [{ starts_at: "2026-03-05T15:00:00Z", ends_at: "2026-03-05T15:10:00Z" }];
    expect(clashesWith({ starts_at: "2026-03-05T15:05:00Z", ends_at: "2026-03-05T15:15:00Z" }, booked)).toBe(true);
    expect(clashesWith({ starts_at: "2026-03-05T15:10:00Z", ends_at: "2026-03-05T15:20:00Z" }, booked)).toBe(false);
  });
});
