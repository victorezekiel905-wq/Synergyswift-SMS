import { describe, it, expect } from "vitest";
import { stageForApplication, detectSource, normalizePhone, findDuplicate, scoreLead, renderTemplate, buildIcs, seatsLeft,
  funnel, bySource, staffPerformance, monthlyTrend, lostReasons, type LeadRow } from "@/lib/crm";

describe("pipeline stages", () => {
  it("follows the application", () => {
    expect(stageForApplication("new", "enquiry")).toBe("applied");
    expect(stageForApplication("reviewing", "tour_booked")).toBe("applied");
    expect(stageForApplication("assessment")).toBe("assessed");
    expect(stageForApplication("waitlisted")).toBe("assessed");
    expect(stageForApplication("offered")).toBe("offered");
    expect(stageForApplication("accepted")).toBe("accepted");
    expect(stageForApplication("enrolled")).toBe("enrolled");
    for (const s of ["rejected", "withdrawn", "declined", "expired"]) expect(stageForApplication(s)).toBe("lost");
  });
});

describe("lead sources", () => {
  it("reads campaign tags, referrers and referral codes", () => {
    expect(detectSource({ utm_source: "facebook", utm_medium: "cpc" })).toBe("facebook");
    expect(detectSource({ utm_source: "ig" })).toBe("instagram");
    expect(detectSource({}, "https://l.instagram.com/")).toBe("instagram");
    expect(detectSource({}, "https://wa.me/234")).toBe("whatsapp");
    expect(detectSource({ utm_medium: "newsletter" })).toBe("email");
    expect(detectSource({}, null, "ABCD1234")).toBe("referral");
    expect(detectSource({})).toBe("website");
  });
  it("normalises Nigerian phone numbers and finds duplicates", () => {
    expect(normalizePhone("0803 123 4567")).toBe("+2348031234567");
    expect(normalizePhone("2348031234567")).toBe("+2348031234567");
    expect(normalizePhone("+44 7700 900123")).toBe("+447700900123");
    const leads = [{ id: "1", phone: "+2348031234567", email: "a@b.co" }, { id: "2", phone: null, email: "MUM@x.com" }];
    expect(findDuplicate(leads, "08031234567", null)?.id).toBe("1");
    expect(findDuplicate(leads, null, "mum@x.com ")?.id).toBe("2");
    expect(findDuplicate(leads, "0700", "new@x.com")).toBeNull();
  });
});

describe("lead score", () => {
  it("rises with intent and fit and falls with silence", () => {
    const cold = scoreLead({ stage: "enquiry", source: "facebook", daysSinceContact: 40 });
    const warm = scoreLead({ stage: "applied", source: "referral", phone: "1", email: "e", sibling: true, tourAttended: true, feePaid: true, documents: 3, contacts: 4, daysSinceContact: 2 });
    expect(cold.score).toBeLessThan(10);
    expect(warm.score).toBeGreaterThan(70);
    expect(warm.reasons.join(" ")).toContain("sibling");
    expect(scoreLead({ stage: "enrolled", source: "website" }).score).toBe(100);
    expect(scoreLead({ stage: "lost", source: "referral" }).score).toBe(0);
    expect(scoreLead({ stage: "accepted", source: "referral", phone: "1", email: "e", sibling: true, tourAttended: true, feePaid: true, documents: 5, contacts: 9, assessmentPct: 90 }).score).toBeLessThanOrEqual(99);
  });
});

describe("templates and calendar files", () => {
  it("fills merge fields and leaves unknown ones visible", () => {
    expect(renderTemplate("Dear {parent}, {child} joins {level}. {oops}", { parent: "Mrs Obi", child: "Ada", level: "JSS1" })).toBe("Dear Mrs Obi, Ada joins JSS1. {oops}");
  });
  it("builds a valid iCalendar event", () => {
    const ics = buildIcs({ uid: "b1", title: "School tour, Main campus", starts_at: "2026-11-03T09:00:00Z", location: "Gate A; reception", organizer: "Alpha School" });
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("DTSTART:20261103T090000Z");
    expect(ics).toContain("DTEND:20261103T100000Z");
    expect(ics).toContain("SUMMARY:School tour\\, Main campus");
    expect(ics).toContain("LOCATION:Gate A\\; reception");
    expect(ics.split("\r\n").length).toBeGreaterThan(10);
  });
});

describe("capacity", () => {
  it("counts offered, accepted and enrolled places", () => {
    const left = seatsLeft([{ level: "JSS1", seats: 3 }, { level: "SS1", seats: 1 }],
      [{ applying_for: "JSS1", status: "enrolled" }, { applying_for: "JSS1", status: "offered" }, { applying_for: "JSS1", status: "new" }, { applying_for: "SS1", status: "accepted" }, { applying_for: "SS1", status: "enrolled" }]);
    expect(left.get("JSS1")).toBe(1);
    expect(left.get("SS1")).toBe(0);
  });
});

describe("admissions analytics", () => {
  const L = (id: string, stage: LeadRow["stage"], source: LeadRow["source"], owner: string | null, created: string, resp: string | null = null, lost_reason: string | null = null): LeadRow =>
    ({ id, stage, source, owner_id: owner, created_at: created, first_response_at: resp, lost_reason });
  const leads = [
    L("1", "enquiry", "facebook", "u1", "2026-01-05T08:00:00Z"),
    L("2", "tour_booked", "facebook", "u1", "2026-01-06T08:00:00Z", "2026-01-06T10:00:00Z"),
    L("3", "applied", "referral", "u2", "2026-02-01T08:00:00Z", "2026-02-01T09:00:00Z"),
    L("4", "enrolled", "referral", "u2", "2026-02-02T08:00:00Z", "2026-02-02T08:30:00Z"),
    L("5", "lost", "website", "u1", "2026-02-03T08:00:00Z", null, "Fees too high"),
    L("6", "lost", "website", null, "2026-03-03T08:00:00Z", null, "Fees too high")
  ];
  it("builds the funnel", () => {
    const f = funnel(leads);
    expect(f[0]).toMatchObject({ stage: "enquiry", count: 6 });
    expect(f.find(x => x.stage === "applied")!.count).toBe(2);
    expect(f.find(x => x.stage === "applied")!.from_previous).toBe(33.3);
    expect(f.find(x => x.stage === "enrolled")!.count).toBe(1);
  });
  it("works out cost per enrolment by source", () => {
    const s = bySource(leads, [{ source: "facebook", amount: 50000 }, { source: "referral", amount: 10000 }]);
    const fb = s.find(x => x.source === "facebook")!, ref = s.find(x => x.source === "referral")!;
    expect(fb).toMatchObject({ leads: 2, enrolled: 0, cost_per_lead: 25000, cost_per_enrolment: null });
    expect(ref).toMatchObject({ leads: 2, enrolled: 1, conversion: 50, cost_per_enrolment: 10000 });
  });
  it("measures staff response and conversion", () => {
    const p = staffPerformance(leads, new Map([["u1", "Bisi"], ["u2", "Tunde"]]));
    expect(p[0]).toMatchObject({ name: "Tunde", enrolled: 1, median_first_response_hours: 0.5 });
    expect(p.find(x => x.name === "Bisi")).toMatchObject({ leads: 3, not_contacted: 1, median_first_response_hours: 2 });
  });
  it("shows monthly trends and why families were lost", () => {
    expect(monthlyTrend(leads).map(m => [m.month, m.leads])).toEqual([["2026-01", 2], ["2026-02", 3], ["2026-03", 1]]);
    expect(lostReasons(leads)).toEqual([{ reason: "Fees too high", count: 2 }]);
  });
});
