import { describe, it, expect, vi, afterEach } from "vitest";
import { leadFacts, leadsNeedingBrief, briefLead, summaryText } from "@/lib/sales-ai";
import { familyFacts, familiesToChase, applicantFacts } from "@/lib/admissions-ai";
import { resetAiAllowanceCache } from "@/lib/ai";

vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => { throw new Error("no database in tests"); } }));

const NOW = new Date("2026-11-02T08:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

/** A tiny stand-in for the Supabase client: fixed rows per table, records updates. */
function fakeDb(tables: Record<string, any>) {
  const updates: { table: string; values: any }[] = [];
  const from = (table: string) => {
    const rows = tables[table];
    const q: any = {
      select: () => q, eq: () => q, neq: () => q, order: () => q, limit: () => q, not: () => q, in: () => q, gte: () => q,
      maybeSingle: async () => ({ data: Array.isArray(rows) ? rows[0] ?? null : rows ?? null }),
      update: (values: any) => { updates.push({ table, values }); return q; },
      then: (res: (v: any) => unknown) => res({ data: Array.isArray(rows) ? rows : rows ? [rows] : [] })
    };
    return q;
  };
  return { db: { from, rpc: async () => ({ data: [] }) }, updates };
}

describe("AI sales manager", () => {
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.GEMINI_API_KEY; resetAiAllowanceCache(); });
  const lead = { id: "L1", school_name: "Greenfield College", contact_name: "Mrs Ade", contact_role: "Proprietor", phone: "08031234567", email: null,
    city: "Ibadan", state: "Oyo", students_estimate: 600, source: "referral", stage: "demo_done", stage_changed_at: day(9), created_at: day(30),
    next_action: "Send proposal", next_action_at: day(2), demo_at: day(9), needs: "CBT exams and fees online", value_estimate: 3_800_000, score: 70 };

  it("briefs from the school's own history, quotes and the price list", () => {
    const f = leadFacts(lead, [{ kind: "demo", body: "Demo for the proprietor and bursar; they liked CBT", at: day(9) }],
      [{ number: "Q-001", plan_code: "complete", annual: 3_800_000, status: "draft", created_at: day(8) }], [{ code: "growth", name: "Growth" }, { code: "complete", name: "Complete" }], NOW);
    expect(f.stage).toBe("Demo done");
    expect(f.days_in_stage).toBe(9);
    expect(f.days_since_contact).toBe(9);
    expect(f.history[0]).toContain("liked CBT");
    expect(f.quotes[0]).toMatch(/Q-001 complete ₦3,800,000\/yr \(draft/);
    expect(f.plans).toEqual(["growth: Growth", "complete: Complete"]);
    expect(f.has_email).toBe(false);
  });

  it("picks stale or overdue open deals, best first, not ones briefed in the last 3 days", () => {
    const leads = [
      { id: "a", stage: "proposal", score: 80, next_action_at: day(1), created_at: day(20) },               // overdue
      { id: "b", stage: "contacted", score: 40, next_action_at: null, created_at: day(20) },                // quiet 10 days
      { id: "c", stage: "trial", score: 90, next_action_at: day(1), created_at: day(20), ai_brief_at: day(1) }, // briefed yesterday
      { id: "d", stage: "won", score: 100, next_action_at: day(5), created_at: day(40) },
      { id: "e", stage: "new", score: 20, next_action_at: null, created_at: day(2) }                       // fresh
    ];
    const last = new Map([["b", day(10)], ["e", day(1)]]);
    expect(leadsNeedingBrief(leads, last, NOW).map(l => l.id)).toEqual(["a", "b"]);
  });

  it("never offers a plan that isn't on the price list, and drafts WhatsApp when there's no email", async () => {
    process.env.GEMINI_API_KEY = "g-key";
    const answer = { summary: "Warm, keen on CBT.", temperature: "warm", next_step: "Call Mrs Ade", next_step_in_days: 45, talking_points: ["CBT"], risks: [],
      suggested_plan: "platinum", message: { channel: "email", subject: "Your proposal", body: "Dear Mrs Ade..." } };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] }, finishReason: "STOP" }] }) })));
    const { db, updates } = fakeDb({ sales_leads: [lead], sales_activities: [], sales_quotes: [], plans: [{ code: "complete", name: "Complete" }] });
    const b = await briefLead(db, "L1");
    expect(b.suggested_plan).toBeNull();
    expect(b.message.channel).toBe("whatsapp");
    expect(b.next_step_in_days).toBe(30);
    expect(updates.find(u => u.table === "sales_leads")?.values.ai_brief.summary).toBe("Warm, keen on CBT.");
  });

  it("writes the weekly summary as plain text for the email", () => {
    const t = summaryText({ headline: "A good week.", focus: [{ school: "Greenfield", why: "proposal out 5 days", action: "call today" }], at_risk_customers: [],
      forecast: "Two likely.", coaching: "Log every call.", at: NOW.toISOString() });
    expect(t).toContain("- Greenfield: proposal out 5 days → call today");
    expect(t).not.toContain("Customers at risk");
  });
});

describe("AI admissions office", () => {
  it("tells the officer what the family still has to do", () => {
    const f = familyFacts({ parent_name: "Mr Bello", child_name: "Musa", applying_for: "JSS1", stage: "applied", source: "website", created_at: day(6), last_contact_at: day(4),
      first_response_at: day(6), email: "b@example.com", phone: null }, [{ kind: "email", body: "Sent the form link", created_at: day(4) }],
      { application_no: "APP-12", status: "new", fee_paid: false, application_documents: [{ kind: "birth_certificate" }], admission_payments: [{ kind: "application_fee", status: "pending" }],
        entrance_attempts: [{ status: "assigned", total_score: null, max_score: null }] }, NOW.getTime());
    expect(f.enquired_days_ago).toBe(6);
    expect(f.answered_yet).toBe(true);
    expect(f.application?.form_fee_paid).toBe(false);
    expect(f.application?.documents).toEqual(["birth_certificate"]);
    expect(f.application?.entrance_test).toEqual(["assigned"]);
  });

  it("answers new enquiries after 15 minutes and chases applications quiet for 3 days", () => {
    const t = NOW.getTime(), mins = (n: number) => new Date(t - n * 60_000).toISOString();
    const leads = [
      { id: "new-10m", stage: "enquiry", email: "a@x.ng", created_at: mins(10) },
      { id: "new-30m", stage: "enquiry", phone: "080", created_at: mins(30) },
      { id: "answered", stage: "enquiry", email: "a@x.ng", created_at: mins(60), first_response_at: mins(50) },
      { id: "no-consent", stage: "enquiry", email: "a@x.ng", created_at: mins(60), consent: false },
      { id: "no-contact", stage: "enquiry", created_at: mins(60) },
      { id: "quiet-app", stage: "applied", email: "a@x.ng", created_at: day(10), last_contact_at: day(4) },
      { id: "recent-app", stage: "applied", email: "a@x.ng", created_at: day(10), last_contact_at: day(1) },
      { id: "chased", stage: "offered", phone: "080", created_at: day(10), last_contact_at: day(5), ai_brief_at: day(2) }
    ];
    const { enquiries, stalled } = familiesToChase(leads, t);
    expect(enquiries.map(l => l.id)).toEqual(["new-30m"]);
    expect(stalled.map(l => l.id)).toEqual(["quiet-app"]);
  });

  it("summarises an applicant without the family's contact details", () => {
    const f = applicantFacts({ applying_for: "SS1", gender: "female", date_of_birth: "2012-03-01", previous_school: "Bright Start", status: "assessment",
      guardian_name: "Mrs Okafor", guardian_phone: "0803", guardian_email: "o@x.ng", address: "12 Allen Avenue",
      entrance_attempts: [{ status: "marked", total_score: 72, max_score: 100, section_scores: { Maths: 80, English: 64 } }], report_score: 70, interview_score: null,
      fee_paid: true, application_documents: [{ kind: "report_card" }] });
    expect(f.entrance[0]).toEqual({ status: "marked", score: 72, max: 100, sections: { Maths: 80, English: 64 } });
    const text = JSON.stringify(f);
    for (const secret of ["Okafor", "0803", "o@x.ng", "Allen"]) expect(text).not.toContain(secret);
  });
});
