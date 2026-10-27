import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { groupPrices } from "@/lib/saas-server";
import { bandFor, quote, naira, type ModuleGroup, type PlanDef } from "@/lib/saas";
import { autoOnboarding, customerHealth, leadScore, weightedPipeline, SOURCES, STAGES, type Metrics, type Stage } from "@/lib/sales";
import { sendEmail } from "@/lib/messaging/providers";

export const dynamic = "force-dynamic";

/**
 * The platform's sales CRM (phase 14g-1): the pipeline of prospect schools, a lead with its
 * activity and quotes, and customers with health, churn risk, renewals and onboarding.
 */
export async function GET(req: NextRequest) {
  const gate = await requirePlatformAdmin();
  if (gate instanceof NextResponse) return gate;
  const svc = createServiceClient();
  const u = new URL(req.url);
  const leadId = u.searchParams.get("lead");
  if (leadId) {
    const [{ data: lead }, { data: activities }, { data: quotes }] = await Promise.all([
      svc.from("sales_leads").select("*").eq("id", leadId).maybeSingle(),
      svc.from("sales_activities").select("*").eq("lead_id", leadId).order("at", { ascending: false }).limit(200),
      svc.from("sales_quotes").select("*").eq("lead_id", leadId).order("created_at", { ascending: false })
    ]);
    if (!lead) return jsonError("lead not found", 404);
    return NextResponse.json({ lead, activities: activities ?? [], quotes: quotes ?? [] });
  }
  if (u.searchParams.get("view") === "customers") {
    const [{ data: rows, error }, { data: steps }] = await Promise.all([
      svc.rpc("platform_customer_metrics"),
      svc.from("tenant_onboarding").select("tenant_id,step,done_at,auto")
    ]);
    if (error) return jsonError(error.message.includes("platform_customer_metrics") ? "Customers need the database update (migration 20260101006400)." : error.message);
    const customers = ((rows ?? []) as (Metrics & { tenant_id: string; name: string; plan_name: string | null; custom_annual: number | null })[]).map(m => {
      const stored = (steps ?? []).filter((s: any) => s.tenant_id === m.tenant_id).map((s: any) => s.step as string);
      return { ...m, health: customerHealth(m), onboarding: [...new Set([...stored, ...autoOnboarding(m)])] };
    }).sort((a, b) => a.health.score - b.health.score);
    return NextResponse.json({ customers });
  }
  const [{ data: leads, error }, { data: last }, { data: plans }, { data: team }] = await Promise.all([
    svc.from("sales_leads").select("*").order("updated_at", { ascending: false }).limit(2000),
    svc.from("sales_activities").select("lead_id,at").order("at", { ascending: false }).limit(5000),
    svc.from("plans").select("code,name,groups,prices,active").eq("active", true).order("sort"),
    svc.from("platform_admins").select("user_id,role,email")
  ]);
  if (error) return jsonError(error.message.includes("sales_leads") ? "The sales CRM needs the database update (migration 20260101006400)." : error.message);
  const lastAt = new Map<string, string>();
  for (const a of last ?? []) if (!lastAt.has(a.lead_id)) lastAt.set(a.lead_id, a.at);
  const rows = (leads ?? []).map((l: any) => ({ ...l, last_activity_at: lastAt.get(l.id) ?? null }));
  const month = new Date(); month.setDate(1); month.setHours(0, 0, 0, 0);
  const won = rows.filter((l: any) => l.stage === "won" && new Date(l.stage_changed_at) >= month);
  return NextResponse.json({
    leads: rows, plans: plans ?? [], group_prices: await groupPrices(svc), team: team ?? [],
    stats: {
      open: rows.filter((l: any) => !["won", "lost"].includes(l.stage)).length,
      pipeline: rows.filter((l: any) => !["won", "lost"].includes(l.stage)).reduce((s: number, l: any) => s + Number(l.value_estimate ?? 0), 0),
      weighted: weightedPipeline(rows.map((l: any) => ({ stage: l.stage, value_estimate: l.value_estimate === null ? null : Number(l.value_estimate) }))),
      won_this_month: won.length, won_value_this_month: won.reduce((s: number, l: any) => s + Number(l.value_estimate ?? 0), 0),
      due_today: rows.filter((l: any) => l.next_action_at && new Date(l.next_action_at) <= new Date(Date.now() + 86_400_000) && !["won", "lost"].includes(l.stage)).length
    }
  });
}

const Lead = z.object({
  school_name: z.string().trim().min(2).max(200), contact_name: z.string().trim().max(120).nullish(), contact_role: z.string().trim().max(80).nullish(),
  phone: z.string().trim().max(30).nullish(), email: z.string().trim().email().nullish().or(z.literal("")), city: z.string().trim().max(80).nullish(), state: z.string().trim().max(80).nullish(),
  students_estimate: z.number().int().min(0).max(100000).nullish(), source: z.enum(SOURCES), owner_id: z.string().uuid().nullish(),
  next_action: z.string().trim().max(300).nullish(), next_action_at: z.string().datetime({ offset: true }).nullish(), demo_at: z.string().datetime({ offset: true }).nullish(),
  value_estimate: z.number().int().min(0).max(1e12).nullish(), needs: z.string().trim().max(2000).nullish()
});
const Body = z.discriminatedUnion("action", [
  Lead.extend({ action: z.literal("save_lead"), id: z.string().uuid().nullish() }),
  z.object({ action: z.literal("stage"), lead_id: z.string().uuid(), stage: z.enum(STAGES.map(s => s.key) as [Stage, ...Stage[]]), lost_reason: z.string().trim().max(500).nullish() }),
  z.object({ action: z.literal("activity"), lead_id: z.string().uuid(), kind: z.enum(["note", "call", "email", "whatsapp", "meeting", "demo"]), body: z.string().trim().min(1).max(4000),
    next_action: z.string().trim().max(300).nullish(), next_action_at: z.string().datetime({ offset: true }).nullish() }),
  z.object({ action: z.literal("quote"), lead_id: z.string().uuid(), plan_code: z.string().min(1).max(40), students: z.number().int().min(1).max(100000),
    add_on_groups: z.array(z.string()).max(6).default([]), cycle: z.enum(["annual", "termly"]).default("annual"), custom_annual: z.number().int().min(0).max(1e12).nullish(),
    discount_pct: z.number().min(0).max(100).default(0), valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish() }),
  z.object({ action: z.literal("quote_status"), quote_id: z.string().uuid(), status: z.enum(["sent", "accepted", "declined"]), email: z.boolean().default(false) }),
  z.object({ action: z.literal("onboarding"), tenant_id: z.string().uuid(), step: z.enum(["school_created", "data_imported", "staff_trained", "parents_invited", "go_live"]), done: z.boolean() })
]);

export async function POST(req: NextRequest) {
  const gate = await requirePlatformAdmin("admin");
  if (gate instanceof NextResponse) return gate;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const svc = createServiceClient();
  const now = new Date().toISOString();
  const log = (lead_id: string, kind: string, body: string) => svc.from("sales_activities").insert({ lead_id, kind, body, actor_id: gate.userId });
  const rescore = async (id: string) => {
    const { data: l } = await svc.from("sales_leads").select("*").eq("id", id).maybeSingle();
    const { data: a } = await svc.from("sales_activities").select("at").eq("lead_id", id).order("at", { ascending: false }).limit(1);
    if (l) await svc.from("sales_leads").update({ score: leadScore({ ...l, last_activity_at: a?.[0]?.at ?? null }) }).eq("id", id);
  };

  switch (b.action) {
    case "save_lead": {
      const { action: _a, id, ...row } = b;
      const values = { ...row, email: row.email || null, updated_at: now };
      const { data, error } = id ? await svc.from("sales_leads").update(values).eq("id", id).select("*").single()
        : await svc.from("sales_leads").insert({ ...values, owner_id: row.owner_id ?? gate.userId }).select("*").single();
      if (error) return jsonError(error.message);
      if (!id) await log(data.id, "system", "Lead added.");
      await rescore(data.id);
      return NextResponse.json({ ok: true, lead: data });
    }
    case "stage": {
      const { data: l } = await svc.from("sales_leads").select("stage").eq("id", b.lead_id).maybeSingle();
      if (!l) return jsonError("lead not found", 404);
      if (b.stage === "lost" && !b.lost_reason) return jsonError("Say why the school was lost; it helps the next one.");
      await svc.from("sales_leads").update({ stage: b.stage, lost_reason: b.stage === "lost" ? b.lost_reason : null, stage_changed_at: now, updated_at: now }).eq("id", b.lead_id);
      await log(b.lead_id, "stage", `${STAGES.find(s => s.key === l.stage)?.label} → ${STAGES.find(s => s.key === b.stage)?.label}${b.lost_reason ? `: ${b.lost_reason}` : ""}`);
      await rescore(b.lead_id);
      return NextResponse.json({ ok: true });
    }
    case "activity": {
      await log(b.lead_id, b.kind, b.body);
      const next = b.next_action !== undefined || b.next_action_at !== undefined ? { next_action: b.next_action ?? null, next_action_at: b.next_action_at ?? null } : {};
      await svc.from("sales_leads").update({ ...next, ...(b.kind === "demo" ? { stage: "demo_done", stage_changed_at: now } : {}), updated_at: now }).eq("id", b.lead_id).neq("stage", "won");
      await rescore(b.lead_id);
      return NextResponse.json({ ok: true });
    }
    case "quote": {
      const [{ data: plan }, gp] = await Promise.all([svc.from("plans").select("code,name,groups,prices").eq("code", b.plan_code).maybeSingle(), groupPrices(svc)]);
      if (!plan) return jsonError("plan not found");
      const band = bandFor(b.students);
      const q = quote({ plan: plan as Pick<PlanDef, "name" | "groups" | "prices">, band, addOns: b.add_on_groups as ModuleGroup[], cycle: b.cycle, groupPrices: gp,
        customAnnual: b.custom_annual ?? null, discountPct: b.discount_pct });
      if (q.annual === null) return jsonError("Schools above the top size band need an agreed yearly price.");
      const { data: number } = await svc.rpc("next_sales_quote_number");
      const { data, error } = await svc.from("sales_quotes").insert({ lead_id: b.lead_id, number, plan_code: b.plan_code, band, students: b.students, add_on_groups: b.add_on_groups,
        cycle: b.cycle, custom_annual: b.custom_annual ?? null, discount_pct: b.discount_pct, lines: q.lines, annual: q.annual,
        valid_until: b.valid_until ?? new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10), created_by: gate.userId }).select("*").single();
      if (error) return jsonError(error.message);
      await svc.from("sales_leads").update({ package_code: b.plan_code, value_estimate: q.annual, students_estimate: b.students, updated_at: now }).eq("id", b.lead_id);
      await log(b.lead_id, "quote", `Quote ${number}: ${plan.name}, ${naira(q.annual)} a year.`);
      await rescore(b.lead_id);
      return NextResponse.json({ ok: true, quote: data });
    }
    case "quote_status": {
      const { data: q } = await svc.from("sales_quotes").select("*,sales_leads(id,school_name,contact_name,email,stage)").eq("id", b.quote_id).maybeSingle();
      if (!q) return jsonError("quote not found", 404);
      const lead = (q as any).sales_leads;
      if (b.status === "sent" && b.email) {
        if (!lead?.email) return jsonError("Add the contact's email to send the quote.");
        const lines = (q.lines as { label: string; amount: number }[]).map(l => `${l.label}: ${naira(l.amount)}`).join("\n");
        await sendEmail({ to: lead.email, subject: `Synergy Swift quote ${q.number} for ${lead.school_name}`,
          text: `Dear ${lead.contact_name ?? "colleague"},\n\nThank you for your interest in Synergy Swift. Here is your quote:\n\n${lines}\n\nTotal per year: ${naira(Number(q.annual))}${q.cycle === "termly" ? " (billed termly)" : ""}\nValid until ${q.valid_until}.\n\nReply to this email with any questions.\n\nSynergy Swift Technologies Limited` }).catch(() => null);
      }
      await svc.from("sales_quotes").update({ status: b.status, ...(b.status === "sent" ? { sent_at: now } : { decided_at: now }) }).eq("id", q.id);
      if (lead) {
        const stage = b.status === "sent" ? "proposal" : b.status === "accepted" ? "won" : null;
        if (stage && lead.stage !== "won") await svc.from("sales_leads").update({ stage, stage_changed_at: now, updated_at: now }).eq("id", lead.id);
        await log(lead.id, "quote", `Quote ${q.number} ${b.status}${b.email && b.status === "sent" ? " by email" : ""}.`);
        await rescore(lead.id);
      }
      return NextResponse.json({ ok: true });
    }
    case "onboarding": {
      const q = b.done ? svc.from("tenant_onboarding").upsert({ tenant_id: b.tenant_id, step: b.step, done_by: gate.userId, auto: false, done_at: now }, { onConflict: "tenant_id,step" })
        : svc.from("tenant_onboarding").delete().eq("tenant_id", b.tenant_id).eq("step", b.step);
      const { error } = await q;
      return error ? jsonError(error.message) : NextResponse.json({ ok: true });
    }
  }
}
