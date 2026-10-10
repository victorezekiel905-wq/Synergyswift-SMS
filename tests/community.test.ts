import { describe, it, expect } from "vitest";
import {
  slaFor, dueDates, slaState, escalationLevel, npsCategory, npsSummary, validateAnswers, summariseQuestions, DEFAULT_SURVEY,
  retentionRisk, matchesSegment, describeSegment, merge, renderCampaign, smsParts, reenrolmentSummary, type FamilySummary, type RetentionInput
} from "@/lib/community";

const brand = { schoolName: "Alpha School" };

describe("ticket SLAs", () => {
  it("uses the school's hours and falls back to defaults", () => {
    expect(slaFor("urgent")).toEqual({ respond: 2, resolve: 24 });
    expect(slaFor("high", { high: { respond: 4 } })).toEqual({ respond: 4, resolve: 72 });
    expect(slaFor("low", { low: { respond: -1, resolve: 99999 } })).toEqual({ respond: 48, resolve: 240 });
  });
  it("sets due dates from the creation time", () => {
    const d = dueDates("normal", new Date("2026-01-01T08:00:00Z"));
    expect(d.respond_due_at).toBe("2026-01-02T08:00:00.000Z");
    expect(d.resolve_due_at).toBe("2026-01-06T08:00:00.000Z");
  });
  const t = { status: "open", respond_due_at: "2026-01-01T10:00:00Z", resolve_due_at: "2026-01-02T08:00:00Z", first_response_at: null, resolved_at: null };
  it("counts down, then reports a breach and the escalation level", () => {
    expect(slaState(t, new Date("2026-01-01T09:00:00Z")).respond).toEqual({ state: "running", minutes: 60 });
    expect(escalationLevel(t, new Date("2026-01-01T09:00:00Z"))).toBe(0);
    expect(slaState(t, new Date("2026-01-01T11:30:00Z")).respond).toEqual({ state: "breached", minutes: 90 });
    expect(escalationLevel(t, new Date("2026-01-01T11:30:00Z"))).toBe(1);
    expect(escalationLevel(t, new Date("2026-01-03T00:00:00Z"))).toBe(2);
  });
  it("a reply in time stops the response clock; a late reply is marked late", () => {
    expect(slaState({ ...t, first_response_at: "2026-01-01T09:59:00Z" }, new Date("2026-01-01T12:00:00Z")).respond.state).toBe("met");
    expect(slaState({ ...t, first_response_at: "2026-01-01T10:30:00Z" }, new Date("2026-01-01T12:00:00Z")).respond).toEqual({ state: "late", minutes: 30 });
    expect(escalationLevel({ ...t, first_response_at: "2026-01-01T09:00:00Z" }, new Date("2026-01-01T12:00:00Z"))).toBe(0);
  });
  it("resolved tickets never escalate", () => {
    const done = { ...t, status: "resolved", first_response_at: "2026-01-01T09:00:00Z", resolved_at: "2026-01-01T20:00:00Z" };
    expect(escalationLevel(done, new Date("2026-02-01T00:00:00Z"))).toBe(0);
    expect(slaState(done, new Date("2026-02-01T00:00:00Z")).resolve.state).toBe("met");
  });
});

describe("NPS and surveys", () => {
  it("categorises scores", () => {
    expect([10, 9, 8, 7, 6, 0].map(npsCategory)).toEqual(["promoter", "promoter", "passive", "passive", "detractor", "detractor"]);
    expect(npsCategory(null)).toBeNull();
  });
  it("computes NPS as % promoters minus % detractors", () => {
    expect(npsSummary([10, 9, 9, 8, 7, 6, 3, 10, 10, 5])).toEqual({ responses: 10, promoters: 5, passives: 2, detractors: 3, nps: 20 });
    expect(npsSummary([]).nps).toBeNull();
    expect(npsSummary([11, -1, null]).responses).toBe(0);
  });
  it("validates answers and pulls out the NPS", () => {
    const ok = validateAnswers(DEFAULT_SURVEY, { nps: "9", why: "  Great teachers ", teaching: 5, hack: "x" });
    expect(ok.errors).toEqual([]);
    expect(ok.nps).toBe(9);
    expect(ok.answers).toEqual({ nps: 9, why: "Great teachers", teaching: 5 });
    expect(validateAnswers(DEFAULT_SURVEY, {}).errors[0]).toMatch(/please answer/);
    expect(validateAnswers(DEFAULT_SURVEY, { nps: 11 }).errors[0]).toMatch(/0–10/);
    expect(validateAnswers([{ id: "c", type: "choice", label: "Pick", options: ["A", "B"] }], { c: "Z" }).errors).toHaveLength(1);
  });
  it("summarises each question", () => {
    const qs = [...DEFAULT_SURVEY, { id: "c", type: "choice" as const, label: "Bus?", options: ["Yes", "No"] }];
    const s = summariseQuestions(qs, [{ answers: { nps: 10, teaching: 4, c: "Yes", why: "a" } }, { answers: { nps: 2, teaching: 5, c: "Yes" } }]);
    expect(s.find(x => x.id === "teaching")).toMatchObject({ average: 4.5, count: 2 });
    expect(s.find(x => x.id === "nps")).toMatchObject({ nps: 0, promoters: 1, detractors: 1 });
    expect(s.find(x => x.id === "c")).toMatchObject({ counts: { Yes: 2, No: 0 } });
    expect(s.find(x => x.id === "why")).toMatchObject({ texts: ["a"] });
  });
});

const calm: RetentionInput = { balance: 0, overdueInvoices: 0, lastNps: 9, openTickets: 0, breachedTickets: 0, attendanceRate: 0.97, reenrolment: "returning", siblingLeft: false, daysSinceContact: 10 };

describe("retention risk", () => {
  it("a happy, paid-up, returning family is low risk", () => {
    expect(retentionRisk(calm)).toEqual({ score: 0, level: "low", reasons: [] });
  });
  it("saying they will not return is high risk on its own", () => {
    const r = retentionRisk({ ...calm, reenrolment: "not_returning" });
    expect(r.level).toBe("high");
    expect(r.reasons[0]).toMatch(/will not return/);
  });
  it("adds up smaller warning signs, biggest first", () => {
    const r = retentionRisk({ ...calm, lastNps: 5, overdueInvoices: 2, breachedTickets: 1, attendanceRate: 0.8 });
    expect(r.score).toBe(15 + 20 + 15 + 8);
    expect(r.level).toBe("high");
    expect(r.reasons[0]).toMatch(/overdue invoice/);
  });
  it("only mentions long silence when something else is wrong", () => {
    expect(retentionRisk({ ...calm, daysSinceContact: 300 }).score).toBe(0);
    expect(retentionRisk({ ...calm, reenrolment: "undecided", daysSinceContact: 300 }).score).toBe(30);
  });
});

const fam = (o: Partial<FamilySummary> = {}): FamilySummary => ({
  id: "g1", full_name: "Mrs Ada Obi", email: "ada@example.com", phone: "+2348030000000", whatsapp_phone: null, language: null,
  notify_email: true, notify_whatsapp: true, notify_sms: false, marketing_opt_out: false,
  children: [{ id: "s1", name: "Chidi Obi", class_group_id: "c1", class_name: "JSS1 A", level: "JSS1" }],
  balance: 50000, overdue_invoices: 1, last_nps: 4, open_tickets: 0, breached_tickets: 0, attendance_rate: 0.95,
  reenrolment: "undecided", referrals: 0, last_contact_at: null, sibling_left: false, risk: { score: 40, level: "medium", reasons: [] }, ...o
});

describe("segments", () => {
  it("empty rules match everyone", () => expect(matchesSegment(fam(), {})).toBe(true));
  it("checks every rule that is set", () => {
    expect(matchesSegment(fam(), { levels: ["JSS1"], min_balance: 20000, nps: ["detractor"], risk: ["medium", "high"] })).toBe(true);
    expect(matchesSegment(fam(), { levels: ["SS1"] })).toBe(false);
    expect(matchesSegment(fam(), { min_balance: 60000 })).toBe(false);
    expect(matchesSegment(fam({ last_nps: null }), { nps: ["none"] })).toBe(true);
    expect(matchesSegment(fam(), { reenrolment: ["returning"] })).toBe(false);
    expect(matchesSegment(fam({ reenrolment: null }), { reenrolment: ["no_response"] })).toBe(false);
    expect(matchesSegment(fam({ email: null }), { channel: "email" })).toBe(false);
    expect(matchesSegment(fam(), { languages: ["en"] })).toBe(true);
    expect(matchesSegment(fam(), { min_children: 2 })).toBe(false);
  });
  it("describes a segment in words", () => {
    expect(describeSegment({})).toBe("Every family");
    expect(describeSegment({ class_group_ids: ["c1"], overdue: true, nps: ["detractor"] }, { classes: { c1: "JSS1 A" } })).toBe("JSS1 A · overdue fees · detractors");
  });
});

describe("campaigns", () => {
  it("merges names, skipping titles for the first name", () => {
    expect(merge("Dear {first_name} ({name}) at {school}", { name: "Mrs Ada Obi" }, "Alpha")).toBe("Dear Ada (Mrs Ada Obi) at Alpha");
  });
  it("renders a newsletter with safe links and an unsubscribe footer", () => {
    const r = renderCampaign(brand, { kind: "newsletter", subject: "News for {first_name}", body: "Hello {name}", blocks: [
      { heading: "Sports day", text: "We won.", image_url: "https://img.example/a.jpg", link_url: "https://example.com/s", link_label: "Photos" },
      { heading: "Bad", link_url: "javascript:alert(1)", image_url: "http://insecure/x.png" },
      {}
    ] }, { name: "Mr Tunde Bello", unsubscribeUrl: "https://app.example/unsubscribe/abc" });
    expect(r.subject).toBe("News for Tunde");
    expect(r.html).toContain("https://img.example/a.jpg");
    expect(r.html).not.toContain("javascript:");
    expect(r.html).not.toContain("http://insecure");
    expect(r.html).toContain("Unsubscribe");
    expect(r.text).toContain("SPORTS DAY");
    expect(r.wa.text).toContain("• Sports day");
  });
  it("escapes HTML in campaign text", () => {
    const r = renderCampaign(brand, { kind: "campaign", subject: "Hi", body: "<script>x</script>", blocks: [] }, { name: "A" });
    expect(r.html).not.toContain("<script>x");
  });
  it("counts SMS parts", () => {
    expect(smsParts("a".repeat(160))).toBe(1);
    expect(smsParts("a".repeat(161))).toBe(2);
    expect(smsParts("a".repeat(307))).toBe(3);
  });
});

describe("re-enrolment", () => {
  it("counts intents, non-responders and reasons for leaving", () => {
    const s = reenrolmentSummary(["a", "b", "c", "d"], [
      { student_id: "a", intent: "returning", reason: null }, { student_id: "b", intent: "not_returning", reason: "fees" },
      { student_id: "c", intent: "not_returning", reason: null }, { student_id: "x", intent: "returning", reason: null }
    ]);
    expect(s).toMatchObject({ students: 4, returning: 1, not_returning: 2, undecided: 0, no_response: 1, response_rate: 75, reasons: { fees: 1, other: 1 } });
  });
});
