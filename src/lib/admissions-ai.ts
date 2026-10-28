/**
 * The AI admissions office (phase 14p). For each family it reads the enquiry,
 * the conversation so far and the application (form fee, documents, entrance
 * test, interview, offer), then writes a briefing for the admissions officer
 * and a reply in the school's voice. For each applicant it writes a short
 * summary with a suggested decision. Weekly it writes the admissions report.
 *
 * Messages go to families only when a person sends them, unless the school
 * switched on "answer new enquiries" or "chase unfinished applications" in its
 * AI settings; then the autopilot sends the drafted reply itself and logs it.
 */
import { z } from "zod/v4";
import { generateJson } from "./ai";
import { notifyContact } from "./notify";
import { admissionNote } from "./messaging/notices";

type Svc = any;

export type AdmissionsAiSettings = { autopilot?: boolean; auto_reply?: boolean; auto_chase?: boolean; weekly_report?: boolean };

export const FamilyBriefSchema = z.object({
  summary: z.string().describe("Two or three sentences: the family, the child, the class wanted, and where they are."),
  temperature: z.enum(["hot", "warm", "cold"]),
  missing: z.array(z.string()).describe("What the family still has to do, e.g. 'Pay the form fee', 'Upload last report card'. Empty if nothing."),
  next_step: z.string().describe("One concrete action for the admissions officer."),
  next_step_in_days: z.number(),
  reply: z.object({ subject: z.string(), body: z.string().describe("The message to the parent, in the school's voice, under 120 words.") })
});
export type FamilyBrief = z.infer<typeof FamilyBriefSchema> & { at: string };

export const ApplicantSummarySchema = z.object({
  summary: z.string().describe("Three or four sentences an admissions panel can read in ten seconds."),
  strengths: z.array(z.string()),
  concerns: z.array(z.string()),
  suggestion: z.enum(["offer", "interview", "waitlist", "regret", "need_more_information"]),
  reason: z.string().describe("One sentence: why that suggestion, from the facts given.")
});
export type ApplicantSummary = z.infer<typeof ApplicantSummarySchema>;

const OFFICE = (school: string) => `You work in the admissions office of ${school}, a school in Nigeria using Synergy Swift.
Write warmly and professionally in British spelling, as the school's admissions office would. Families are often busy parents
reading on a phone: short sentences, one clear request, exact dates and amounts only when they are given. Never invent fees,
dates, places, policies or promises; leave a [placeholder] when something is needed but not given. Never mention how the text
was produced, and never refer to yourself, to software, to assistants or to automation. Sign off as "Admissions Office, ${school}".`;

const days = (from: string | null | undefined, now: number) => (from ? Math.floor((now - Date.parse(from)) / 86_400_000) : null);

/** The facts a family brief is written from (exported for tests). */
export function familyFacts(lead: Record<string, any>, activities: { kind: string; body: string | null; created_at: string }[], app: Record<string, any> | null, now = Date.now()) {
  const docs = (app?.application_documents ?? []) as { kind: string }[];
  const pays = (app?.admission_payments ?? []) as { kind: string; status: string }[];
  const tests = (app?.entrance_attempts ?? []) as { status: string; total_score: number | null; max_score: number | null }[];
  return {
    today: new Date(now).toISOString().slice(0, 10),
    parent: lead.parent_name, child: lead.child_name, class_wanted: lead.applying_for ?? app?.applying_for ?? null, intake: lead.intake,
    stage: lead.stage, source: lead.source, enquired_days_ago: days(lead.created_at, now), last_contact_days_ago: days(lead.last_contact_at, now),
    answered_yet: Boolean(lead.first_response_at), has_email: Boolean(lead.email), has_phone: Boolean(lead.phone), notes: lead.notes,
    planned_follow_up: lead.next_follow_up_at,
    history: activities.slice(0, 20).map(a => `${a.created_at.slice(0, 10)} ${a.kind}: ${(a.body ?? "").slice(0, 300)}`),
    application: app ? {
      number: app.application_no, status: app.status, form_fee_paid: Boolean(app.fee_paid) || pays.some(p => p.kind === "application_fee" && p.status === "paid"),
      documents: docs.map(d => d.kind), previous_school: app.previous_school,
      entrance_test: tests.map(t => `${t.status}${t.total_score !== null ? ` ${t.total_score}/${t.max_score ?? "?"}` : ""}`),
      interview_at: app.interview_at, offer_expires_on: app.offer_expires_on, offer_accepted: Boolean(app.offer_accepted_at),
      acceptance_fee_paid: Boolean(app.acceptance_paid)
    } : null
  };
}

async function schoolName(svc: Svc, tenantId: string) {
  const { data } = await svc.from("tenant_settings").select("school_name").eq("tenant_id", tenantId).maybeSingle();
  if (data?.school_name) return data.school_name as string;
  const { data: t } = await svc.from("tenants").select("name").eq("id", tenantId).maybeSingle();
  return (t?.name as string) ?? "the school";
}

async function loadFamily(svc: Svc, tenantId: string, leadId: string) {
  const { data: lead } = await svc.from("admission_leads").select("*").eq("tenant_id", tenantId).eq("id", leadId).maybeSingle();
  if (!lead) throw new Error("lead not found");
  const [{ data: acts }, appRes] = await Promise.all([
    svc.from("lead_activities").select("kind,body,created_at").eq("lead_id", leadId).neq("kind", "ai").order("created_at", { ascending: false }).limit(30),
    lead.application_id
      ? svc.from("applications").select("*,application_documents(kind),admission_payments(kind,status),entrance_attempts(status,total_score,max_score)").eq("id", lead.application_id).maybeSingle()
      : Promise.resolve({ data: null })
  ]);
  return { lead, acts: acts ?? [], app: appRes.data ?? null };
}

/** Writes and saves a fresh brief (with a drafted reply) for one family. */
export async function briefFamily(svc: Svc, tenantId: string, leadId: string): Promise<FamilyBrief> {
  const { lead, acts, app } = await loadFamily(svc, tenantId, leadId);
  const school = await schoolName(svc, tenantId);
  const out = await generateJson({
    task: "admissions_brief", schema: FamilyBriefSchema, temperature: 0.5, maxTokens: 4000, tenantId,
    system: OFFICE(school) + "\nAlso brief the admissions officer: where the family is, what is missing, and the next step.",
    prompt: `Family (JSON):\n${JSON.stringify(familyFacts(lead, acts, app))}`
  });
  const brief: FamilyBrief = { ...out, next_step_in_days: Math.max(0, Math.min(30, Math.round(out.next_step_in_days))), at: new Date().toISOString() };
  await svc.from("admission_leads").update({ ai_brief: brief, ai_brief_at: brief.at }).eq("tenant_id", tenantId).eq("id", leadId);
  return brief;
}

/** Sends a (drafted, possibly edited) reply to the family by email and WhatsApp/SMS, and logs it. */
export async function sendFamilyReply(svc: Svc, tenantId: string, leadId: string, msg: { subject: string; body: string }, actorId: string | null, auto = false) {
  const { data: lead } = await svc.from("admission_leads").select("id,parent_name,email,phone").eq("tenant_id", tenantId).eq("id", leadId).maybeSingle();
  if (!lead) throw new Error("lead not found");
  if (!lead.email && !lead.phone) throw new Error("this family has no email or phone number on file");
  const n = await notifyContact(svc, { tenantId, name: lead.parent_name, email: lead.email, phone: lead.phone, kind: "admissions_message", refId: lead.id, defer: auto,
    build: b => admissionNote(b, { name: lead.parent_name, subject: msg.subject, lines: msg.body.split(/\n+/).filter(Boolean) }) });
  const now = new Date().toISOString();
  await svc.from("lead_activities").insert({ tenant_id: tenantId, lead_id: lead.id, kind: lead.email ? "email" : "whatsapp", body: msg.body.slice(0, 4000), actor_id: actorId,
    meta: { queued: n, subject: msg.subject, ai: true, auto } });
  await svc.from("admission_leads").update({ last_contact_at: now, updated_at: now }).eq("tenant_id", tenantId).eq("id", lead.id);
  await svc.from("admission_leads").update({ first_response_at: now }).eq("tenant_id", tenantId).eq("id", lead.id).is("first_response_at", null);
  return n;
}

/** The facts an applicant summary is written from (exported for tests). No family contact details. */
export function applicantFacts(app: Record<string, any>) {
  const tests = (app.entrance_attempts ?? []) as { status: string; total_score: number | null; max_score: number | null; section_scores?: Record<string, unknown> | null }[];
  return {
    applying_for: app.applying_for, gender: app.gender, age_years: app.date_of_birth ? Math.floor((Date.now() - Date.parse(app.date_of_birth)) / (365.25 * 86_400_000)) : null,
    previous_school: app.previous_school, status: app.status,
    entrance: tests.map(t => ({ status: t.status, score: t.total_score, max: t.max_score, sections: t.section_scores ?? null })),
    report_score: app.report_score, composite_score: app.composite_score, merit_rank: app.merit_rank, proposed_decision: app.proposed_decision,
    interview_score: app.interview_score, interview_notes: app.interview_notes ? String(app.interview_notes).slice(0, 2000) : null,
    form_fee_paid: Boolean(app.fee_paid), documents: ((app.application_documents ?? []) as { kind: string }[]).map(d => d.kind), notes: app.notes ? String(app.notes).slice(0, 1000) : null
  };
}

export async function summariseApplicant(svc: Svc, tenantId: string, appId: string): Promise<ApplicantSummary & { at: string }> {
  const { data: app } = await svc.from("applications").select("*,application_documents(kind),entrance_attempts(status,total_score,max_score,section_scores)")
    .eq("tenant_id", tenantId).eq("id", appId).maybeSingle();
  if (!app) throw new Error("application not found");
  const school = await schoolName(svc, tenantId);
  const out = await generateJson({
    task: "applicant_summary", schema: ApplicantSummarySchema, temperature: 0.3, maxTokens: 3000, tenantId,
    system: `You help the admissions panel of ${school} (Nigeria) review applicants. Be fair, factual and brief. Use only the facts given;
say what is missing rather than guessing. Never comment on family background, religion, ethnicity or anything not about the child's
readiness for the class. The suggestion is advice for the panel, who decide.`,
    prompt: `Applicant (JSON):\n${JSON.stringify(applicantFacts(app))}`
  });
  const at = new Date().toISOString();
  const text = [out.summary, out.strengths.length ? `Strengths: ${out.strengths.join("; ")}.` : "", out.concerns.length ? `Concerns: ${out.concerns.join("; ")}.` : "",
    `Suggestion: ${out.suggestion.replace(/_/g, " ")}: ${out.reason}`].filter(Boolean).join("\n");
  await svc.from("applications").update({ ai_summary: text.slice(0, 4000), ai_summary_at: at }).eq("tenant_id", tenantId).eq("id", appId);
  return { ...out, at };
}

// ---------------- weekly report ----------------

export const AdmissionsReportSchema = z.object({
  headline: z.string(),
  highlights: z.array(z.string()),
  bottlenecks: z.array(z.string()).describe("Where families are getting stuck, from the numbers."),
  actions: z.array(z.string()).describe("Three to five actions for the coming week.")
});

export async function admissionsReport(svc: Svc, tenantId: string) {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [{ data: leads }, { data: apps }] = await Promise.all([
    svc.from("admission_leads").select("stage,source,created_at,first_response_at,last_contact_at,next_follow_up_at").eq("tenant_id", tenantId).gte("updated_at", new Date(Date.now() - 120 * 86_400_000).toISOString()).limit(5000),
    svc.from("applications").select("status,fee_paid,created_at,offer_issued_at,offer_accepted_at,applying_for").eq("tenant_id", tenantId).gte("created_at", new Date(Date.now() - 365 * 86_400_000).toISOString()).limit(5000)
  ]);
  const L = leads ?? [], A = apps ?? [];
  const responseHours: number[] = L.filter((l: any) => l.first_response_at && l.created_at >= weekAgo).map((l: any) => (Date.parse(l.first_response_at) - Date.parse(l.created_at)) / 3_600_000);
  const count = (xs: any[], k: string) => xs.reduce((m: Record<string, number>, x) => { m[x[k]] = (m[x[k]] ?? 0) + 1; return m; }, {});
  const facts = {
    new_enquiries_this_week: L.filter((l: any) => l.created_at >= weekAgo).length,
    unanswered_enquiries: L.filter((l: any) => !l.first_response_at && l.stage === "enquiry").length,
    median_first_reply_hours: responseHours.length ? Math.round(responseHours.sort((a, b) => a - b)[Math.floor(responseHours.length / 2)]) : null,
    follow_ups_overdue: L.filter((l: any) => l.next_follow_up_at && Date.parse(l.next_follow_up_at) < Date.now() && !["enrolled", "lost"].includes(l.stage)).length,
    pipeline_by_stage: count(L, "stage"), enquiries_by_source: count(L.filter((l: any) => l.created_at >= weekAgo), "source"),
    applications_this_week: A.filter((a: any) => a.created_at >= weekAgo).length,
    applications_without_form_fee: A.filter((a: any) => !a.fee_paid && ["new", "reviewing"].includes(a.status)).length,
    applications_by_status: count(A, "status"), applications_by_class: count(A, "applying_for"),
    offers_out_not_accepted: A.filter((a: any) => a.offer_issued_at && !a.offer_accepted_at && a.status === "offered").length
  };
  const school = await schoolName(svc, tenantId);
  const out = await generateJson({
    task: "admissions_report", schema: AdmissionsReportSchema, temperature: 0.4, maxTokens: 3000, tenantId,
    system: `You write the weekly admissions report for the head and admissions team of ${school}. Plain, specific, short. Use only the numbers given.`,
    prompt: `This week's admissions numbers (JSON):\n${JSON.stringify(facts)}`
  });
  return { ...out, facts, at: new Date().toISOString() };
}

// ---------------- autopilot ----------------

/** Families to act on now: unanswered enquiries over 15 minutes old, and stalled applications (exported for tests). */
export function familiesToChase(leads: Record<string, any>[], now = Date.now()) {
  const enquiries = leads.filter(l => l.stage === "enquiry" && !l.first_response_at && l.consent !== false && (l.email || l.phone)
    && now - Date.parse(l.created_at) > 15 * 60_000 && now - Date.parse(l.created_at) < 14 * 86_400_000 && !l.ai_brief_at);
  const stalled = leads.filter(l => ["applied", "assessed", "offered"].includes(l.stage) && (l.email || l.phone)
    && now - Date.parse(l.last_contact_at ?? l.updated_at ?? l.created_at) > 3 * 86_400_000
    && (!l.ai_brief_at || now - Date.parse(l.ai_brief_at) > 4 * 86_400_000));
  return { enquiries, stalled };
}

export async function runAdmissionsAutopilot(svc: Svc, opts: { budgetMs: number }) {
  const start = Date.now();
  const { data: settings } = await svc.from("tenant_settings").select("tenant_id,ai_settings");
  const on = (settings ?? []).filter((s: any) => (s.ai_settings?.admissions as AdmissionsAiSettings | undefined)?.autopilot);
  let drafted = 0, sent = 0, reports = 0;
  for (const s of on) {
    if (Date.now() - start > opts.budgetMs) break;
    const cfg = s.ai_settings.admissions as AdmissionsAiSettings;
    const { data: t } = await svc.from("tenants").select("status,modules").eq("id", s.tenant_id).maybeSingle();
    if (t?.status !== "active" || t.modules?.ai === false || t.modules?.admissions === false) continue;
    const { data: leads } = await svc.from("admission_leads").select("id,stage,email,phone,consent,created_at,updated_at,last_contact_at,first_response_at,ai_brief_at,owner_id")
      .eq("tenant_id", s.tenant_id).not("stage", "in", "(enrolled,lost)").gte("updated_at", new Date(Date.now() - 60 * 86_400_000).toISOString()).limit(2000);
    const { enquiries, stalled } = familiesToChase(leads ?? []);
    for (const [l, send] of [...enquiries.map(l => [l, cfg.auto_reply] as const), ...stalled.map(l => [l, cfg.auto_chase] as const)].slice(0, 5)) {
      if (Date.now() - start > opts.budgetMs) break;
      try {
        const b = await briefFamily(svc, s.tenant_id, l.id);
        drafted++;
        if (send) { await sendFamilyReply(svc, s.tenant_id, l.id, b.reply, null, true); sent++; }
        else {
          await svc.from("lead_activities").insert({ tenant_id: s.tenant_id, lead_id: l.id, kind: "ai", body: `Reply drafted for you to check and send. Next step: ${b.next_step}`, assigned_to: l.owner_id ?? null });
        }
      } catch { break; }
    }
    // Monday mornings: the weekly report to the school's admissions team.
    const now = new Date();
    if (cfg.weekly_report !== false && now.getUTCDay() === 1 && now.getUTCHours() >= 5 && now.getUTCHours() < 9 && Date.now() - start < opts.budgetMs) {
      const last = s.ai_settings?.admissions_report_at as string | undefined;
      if (!last || Date.now() - Date.parse(last) > 5 * 86_400_000) {
        try {
          const r = await admissionsReport(svc, s.tenant_id);
          await svc.from("tenant_settings").update({ ai_settings: { ...s.ai_settings, admissions_report_at: r.at, admissions_report: { headline: r.headline, highlights: r.highlights, bottlenecks: r.bottlenecks, actions: r.actions, at: r.at } } }).eq("tenant_id", s.tenant_id);
          const { data: team } = await svc.from("users").select("full_name,email,role,extra_roles").eq("tenant_id", s.tenant_id).eq("active", true);
          for (const u of (team ?? []).filter((u: any) => [u.role, ...(u.extra_roles ?? [])].some((x: string) => ["admissions_officer", "school_admin", "principal"].includes(x)))) {
            await notifyContact(svc, { tenantId: s.tenant_id, name: u.full_name, email: u.email, kind: "admissions_report", defer: true,
              build: b => admissionNote(b, { name: u.full_name, subject: "Admissions this week", lines: [r.headline, ...r.highlights, "Where families are stuck:", ...r.bottlenecks, "This week:", ...r.actions] }) });
          }
          reports++;
        } catch { /* next run */ }
      }
    }
  }
  return { drafted, sent, reports };
}
