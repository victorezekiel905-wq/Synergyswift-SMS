/**
 * The AI sales manager (phase 14p) for the platform's own sales CRM. It reads a
 * prospect's history and writes a briefing: where the deal stands, how warm it
 * is, the next step and when, what to say, the package to offer, and a drafted
 * email or WhatsApp message. Weekly, it writes the pipeline summary for the
 * team. A person always sends the message; nothing goes to a school by itself.
 */
import { z } from "zod/v4";
import { generateJson } from "./ai";
import { STAGES, stageLabel, leadScore, customerHealth, type Metrics } from "./sales";
import { naira } from "./saas";

type Svc = any;

export const LeadBriefSchema = z.object({
  summary: z.string().describe("Two or three sentences: who the school is, what they need, where the deal stands."),
  temperature: z.enum(["hot", "warm", "cold"]),
  next_step: z.string().describe("One concrete action for the salesperson, e.g. 'Call Mrs Ade to book the demo for the bursar'."),
  next_step_in_days: z.number().describe("How many days from today the next step should happen (0 = today)."),
  talking_points: z.array(z.string()).describe("Two to four points to raise, tied to what this school said it needs."),
  risks: z.array(z.string()).describe("Up to three things that could lose the deal; empty if none."),
  suggested_plan: z.string().nullable().describe("The plan code to offer from the list given, or null."),
  message: z.object({
    channel: z.enum(["email", "whatsapp"]),
    subject: z.string().nullable(),
    body: z.string()
  })
});
export type LeadBrief = z.infer<typeof LeadBriefSchema> & { at: string };

const PRODUCT = `Synergy Swift is a school management and learning platform for Nigerian schools: results and report cards, CBT exams with
secure browser and entrance exams, live lessons and classroom games, fees and online payments, attendance, transport and gate safety,
HR and payroll, parent app with WhatsApp, admissions CRM and more. Priced per year by school size band, sold as Essentials, Growth or Complete.`;

const SALES_SYSTEM = `You are the sales manager for Synergy Swift, coaching a salesperson on one prospect school.
${PRODUCT}
Be practical and specific to this school: use what they asked for, their size, their stage and what has already happened. Never invent facts
about the school, prices or promises; prices come only from the plans and quotes given. Nigerian business English, polite and warm, not pushy.
The drafted message is from the salesperson to the school's contact: short (under 120 words for email, under 60 for WhatsApp), one clear ask,
no hype words ("revolutionary", "cutting-edge"), sign off with "[Your name], Synergy Swift". Pick WhatsApp when there is a phone number and the
contact has been chatty or the step is quick; email for quotes and formal steps. Leave subject null for WhatsApp.`;

type Lead = Record<string, any>;

/** The facts the brief is written from (exported for tests). */
export function leadFacts(lead: Lead, activities: { kind: string; body: string; at: string }[], quotes: { number: string; plan_code: string; annual: number | string; status: string; created_at: string }[], plans: { code: string; name: string }[], now = new Date()) {
  const last = activities[0]?.at ?? null;
  return {
    today: now.toISOString().slice(0, 10),
    school: lead.school_name, contact: lead.contact_name, role: lead.contact_role, city: lead.city, state: lead.state,
    has_phone: Boolean(lead.phone), has_email: Boolean(lead.email),
    students: lead.students_estimate, source: lead.source, stage: stageLabel(lead.stage),
    days_in_stage: Math.floor((now.getTime() - new Date(lead.stage_changed_at ?? lead.created_at).getTime()) / 86_400_000),
    days_since_contact: last ? Math.floor((now.getTime() - new Date(last).getTime()) / 86_400_000) : null,
    planned_next_step: lead.next_action, planned_for: lead.next_action_at, demo_at: lead.demo_at,
    needs: lead.needs, score: leadScore({ ...lead, last_activity_at: last } as never, now),
    value_estimate: lead.value_estimate ? naira(Number(lead.value_estimate)) : null,
    history: activities.slice(0, 25).map(a => `${a.at.slice(0, 10)} ${a.kind}: ${a.body.slice(0, 400)}`),
    quotes: quotes.map(q => `${q.number} ${q.plan_code} ${naira(Number(q.annual))}/yr (${q.status}, ${q.created_at.slice(0, 10)})`),
    plans: plans.map(p => `${p.code}: ${p.name}`)
  };
}

/** Writes and saves a fresh brief for one lead. */
export async function briefLead(svc: Svc, leadId: string): Promise<LeadBrief> {
  const [{ data: lead }, { data: acts }, { data: quotes }, { data: plans }] = await Promise.all([
    svc.from("sales_leads").select("*").eq("id", leadId).maybeSingle(),
    svc.from("sales_activities").select("kind,body,at").eq("lead_id", leadId).neq("kind", "ai").order("at", { ascending: false }).limit(40),
    svc.from("sales_quotes").select("number,plan_code,annual,status,created_at").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(5),
    svc.from("plans").select("code,name").eq("active", true).order("sort")
  ]);
  if (!lead) throw new Error("lead not found");
  const facts = leadFacts(lead, acts ?? [], quotes ?? [], plans ?? []);
  const out = await generateJson({
    task: "sales_brief", schema: LeadBriefSchema, temperature: 0.5, maxTokens: 4000, tenantId: null,
    system: SALES_SYSTEM, prompt: `Prospect (JSON):\n${JSON.stringify(facts)}`
  });
  const valid = new Set((plans ?? []).map((p: any) => p.code));
  const brief: LeadBrief = {
    ...out,
    next_step_in_days: Math.max(0, Math.min(30, Math.round(out.next_step_in_days))),
    suggested_plan: out.suggested_plan && valid.has(out.suggested_plan) ? out.suggested_plan : null,
    message: { ...out.message, channel: out.message.channel === "whatsapp" && !lead.phone ? "email" : out.message.channel === "email" && !lead.email && lead.phone ? "whatsapp" : out.message.channel },
    at: new Date().toISOString()
  };
  await svc.from("sales_leads").update({ ai_brief: brief, ai_brief_at: brief.at }).eq("id", leadId);
  return brief;
}

// ---------------- the weekly pipeline summary ----------------

export const PipelineSummarySchema = z.object({
  headline: z.string().describe("One sentence on the week."),
  focus: z.array(z.object({ school: z.string(), why: z.string(), action: z.string() })).describe("The three to six deals to work this week, best first."),
  at_risk_customers: z.array(z.object({ school: z.string(), why: z.string(), action: z.string() })).describe("Paying schools that may not renew, with a save play; empty if none."),
  forecast: z.string().describe("One or two sentences on what is likely to close this month and why."),
  coaching: z.string().describe("One habit for the team to fix, from the numbers.")
});
export type PipelineSummary = z.infer<typeof PipelineSummarySchema> & { at: string };

export async function pipelineSummary(svc: Svc): Promise<PipelineSummary> {
  const [{ data: leads }, { data: acts }, { data: metrics }] = await Promise.all([
    svc.from("sales_leads").select("id,school_name,stage,students_estimate,value_estimate,source,next_action,next_action_at,stage_changed_at,created_at,lost_reason,updated_at").limit(2000),
    svc.from("sales_activities").select("lead_id,at").neq("kind", "ai").order("at", { ascending: false }).limit(5000),
    svc.rpc("platform_customer_metrics")
  ]);
  const lastAt = new Map<string, string>();
  for (const a of acts ?? []) if (!lastAt.has(a.lead_id)) lastAt.set(a.lead_id, a.at);
  const now = Date.now();
  const open = (leads ?? []).filter((l: any) => !["won", "lost"].includes(l.stage)).map((l: any) => ({
    school: l.school_name, stage: stageLabel(l.stage), students: l.students_estimate, value: l.value_estimate ? naira(Number(l.value_estimate)) : null,
    days_quiet: lastAt.has(l.id) ? Math.floor((now - Date.parse(lastAt.get(l.id)!)) / 86_400_000) : null,
    next_step: l.next_action, overdue: Boolean(l.next_action_at && Date.parse(l.next_action_at) < now),
    score: leadScore({ ...l, last_activity_at: lastAt.get(l.id) ?? null })
  })).sort((a: any, b: any) => b.score - a.score).slice(0, 40);
  const weekAgo = now - 7 * 86_400_000;
  const changed = (leads ?? []).filter((l: any) => Date.parse(l.stage_changed_at) >= weekAgo);
  const customers = ((metrics ?? []) as (Metrics & { name: string })[]).map(m => ({ school: m.name, health: customerHealth(m) }))
    .filter(c => c.health.risk !== "low").slice(0, 15).map(c => ({ school: c.school, score: c.health.score, risk: c.health.risk, reasons: c.health.reasons }));
  const facts = {
    week_ending: new Date().toISOString().slice(0, 10),
    stages: STAGES.map(s => ({ stage: s.label, count: (leads ?? []).filter((l: any) => l.stage === s.key).length })),
    won_this_week: changed.filter((l: any) => l.stage === "won").map((l: any) => l.school_name),
    lost_this_week: changed.filter((l: any) => l.stage === "lost").map((l: any) => `${l.school_name}: ${l.lost_reason ?? "no reason"}`),
    open_deals: open, customers_at_risk: customers
  };
  const out = await generateJson({
    task: "sales_summary", schema: PipelineSummarySchema, temperature: 0.4, maxTokens: 6000, tenantId: null, quality: "best",
    system: `You are the sales manager for Synergy Swift writing the Monday pipeline summary for the founder and the sales team.\n${PRODUCT}\n` +
      "Be blunt, specific and short. Name schools. Base everything on the numbers given; never invent deals, figures or reasons.",
    prompt: `This week's numbers (JSON):\n${JSON.stringify(facts)}`
  });
  const summary: PipelineSummary = { ...out, at: new Date().toISOString() };
  await svc.from("platform_settings").upsert({ key: "sales.ai_summary", value: summary, updated_at: summary.at });
  return summary;
}

// ---------------- autopilot ----------------

/** Open leads that need a fresh brief: next step overdue or quiet for 7+ days, and no brief in the last 3 days. */
export function leadsNeedingBrief(leads: Lead[], lastActivity: Map<string, string>, now = new Date(), limit = 5) {
  const t = now.getTime();
  return leads
    .filter(l => !["won", "lost"].includes(l.stage))
    .filter(l => !l.ai_brief_at || t - Date.parse(l.ai_brief_at) > 3 * 86_400_000)
    .filter(l => {
      const overdue = l.next_action_at && Date.parse(l.next_action_at) < t;
      const last = lastActivity.get(l.id) ?? l.created_at;
      return overdue || t - Date.parse(last) > 7 * 86_400_000;
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit);
}

/**
 * Run by the AI scheduler: briefs a few stale leads (logged so the owner sees a
 * drafted follow-up waiting) and, on Monday mornings, writes and emails the
 * weekly summary to the platform team.
 */
export async function runSalesAutopilot(svc: Svc, opts: { budgetMs: number; send?: (to: string, subject: string, text: string) => Promise<unknown> }) {
  const start = Date.now();
  const [{ data: leads }, { data: acts }] = await Promise.all([
    svc.from("sales_leads").select("id,stage,score,next_action_at,ai_brief_at,created_at").not("stage", "in", "(won,lost)").limit(2000),
    svc.from("sales_activities").select("lead_id,at").neq("kind", "ai").order("at", { ascending: false }).limit(5000)
  ]);
  const last = new Map<string, string>();
  for (const a of acts ?? []) if (!last.has(a.lead_id)) last.set(a.lead_id, a.at);
  let briefed = 0;
  for (const l of leadsNeedingBrief(leads ?? [], last)) {
    if (Date.now() - start > opts.budgetMs) break;
    try {
      const b = await briefLead(svc, l.id);
      await svc.from("sales_activities").insert({ lead_id: l.id, kind: "ai", body: `Follow-up drafted (${b.message.channel}). Next step: ${b.next_step}` });
      briefed++;
    } catch { break; }
  }
  let summary = false;
  const now = new Date();
  // Monday, 06:00–09:59 Lagos (05:00–08:59 UTC), once a week.
  if (now.getUTCDay() === 1 && now.getUTCHours() >= 5 && now.getUTCHours() < 9 && Date.now() - start < opts.budgetMs) {
    const { data: prev } = await svc.from("platform_settings").select("value").eq("key", "sales.ai_summary").maybeSingle();
    const prevAt = (prev?.value as { at?: string } | null)?.at;
    if (!prevAt || Date.now() - Date.parse(prevAt) > 5 * 86_400_000) {
      try {
        const s = await pipelineSummary(svc);
        summary = true;
        if (opts.send) {
          const { data: team } = await svc.from("platform_admins").select("email");
          const text = summaryText(s);
          for (const t of team ?? []) if (t.email) await opts.send(t.email, "Synergy Swift sales: this week", text).catch(() => null);
        }
      } catch { /* try again next run */ }
    }
  }
  return { briefed, summary };
}

export function summaryText(s: PipelineSummary): string {
  const list = (xs: { school: string; why: string; action: string }[]) => xs.map(x => `- ${x.school}: ${x.why} → ${x.action}`).join("\n");
  return [s.headline, "", "Work these this week:", list(s.focus), "",
    s.at_risk_customers.length ? `Customers at risk:\n${list(s.at_risk_customers)}\n` : "",
    `Forecast: ${s.forecast}`, "", `Coaching: ${s.coaching}`].filter(x => x !== "").join("\n");
}
