/**
 * Admissions CRM: server side. Every function takes the service client (or
 * an admissions user's client) and the tenant, and keeps leads, stages,
 * follow-ups and applications in step.
 */
import { createHash } from "crypto";
import { stageForApplication, findDuplicate, normalizePhone, scoreLead, renderTemplate, type Stage, type Source } from "./crm";
import { notifyContact } from "./notify";
import { admissionNote } from "./messaging/notices";
import { loadBrand, formatInZone, enqueue, staffRows } from "./messaging/outbox";
import { verifyPayment, matchesExpected, type Provider } from "./payments";

export type LeadInput = {
  parent_name: string; email?: string | null; phone?: string | null; child_name?: string | null; child_dob?: string | null;
  applying_for?: string | null; intake?: string | null; source: Source; utm?: Record<string, string>; referral_code?: string | null;
  notes?: string | null; owner_id?: string | null; consent?: boolean;
};

const OPEN = ["enquiry", "tour_booked", "applied", "assessed", "offered", "accepted"];

async function log(svc: any, tenantId: string, leadId: string, kind: string, body: string | null, actor: string | null, meta: Record<string, unknown> = {}) {
  await svc.from("lead_activities").insert({ tenant_id: tenantId, lead_id: leadId, kind, body, actor_id: actor, meta });
}

/** Least-busy admissions officer (or admin) for new leads, so no enquiry sits unowned. */
async function pickOwner(svc: any, tenantId: string): Promise<string | null> {
  const { data: staff } = await svc.from("users").select("id,role,extra_roles").eq("tenant_id", tenantId).eq("active", true);
  const officers = (staff ?? []).filter((u: any) => [u.role, ...(u.extra_roles ?? [])].includes("admissions_officer"));
  const pool = officers.length ? officers : (staff ?? []).filter((u: any) => ["school_admin", "principal"].includes(u.role));
  if (!pool.length) return null;
  const { data: open } = await svc.from("admission_leads").select("owner_id").eq("tenant_id", tenantId).in("stage", OPEN).limit(10000);
  const load = new Map<string, number>(pool.map((u: any) => [u.id as string, 0]));
  for (const l of open ?? []) if (load.has(l.owner_id)) load.set(l.owner_id, (load.get(l.owner_id) ?? 0) + 1);
  return [...load].sort((a, b) => a[1] - b[1])[0][0];
}

/**
 * Adds an enquiry, or merges it into the family's open lead (same phone or
 * email). Starts the follow-up sequence for the stage and tells the owner.
 */
export async function upsertLead(svc: any, tenantId: string, input: LeadInput, actor: string | null = null, baseUrl = "") {
  const phone = normalizePhone(input.phone) || null;
  const email = input.email?.trim().toLowerCase() || null;
  const { data: candidates } = await svc.from("admission_leads").select("id,phone,email,stage,notes,child_name")
    .eq("tenant_id", tenantId).in("stage", OPEN).or([phone ? `phone.eq.${phone}` : "", email ? `email.eq.${email}` : ""].filter(Boolean).join(",") || "id.is.null").limit(20);
  type Cand = { id: string; phone: string | null; email: string | null; stage: string; notes: string | null; child_name: string | null };
  const dup = findDuplicate<Cand>((candidates ?? []) as Cand[], phone, email);
  let referredBy: string | null = null;
  if (input.referral_code) {
    const { data: g } = await svc.from("guardians").select("id").eq("tenant_id", tenantId).eq("referral_code", input.referral_code.toUpperCase()).maybeSingle();
    referredBy = g?.id ?? null;
  }
  if (dup && (!input.child_name || !dup.child_name || dup.child_name.toLowerCase() === input.child_name.toLowerCase())) {
    const merged = { notes: [dup.notes, input.notes].filter(Boolean).join("\n") || null, updated_at: new Date().toISOString(),
      ...(input.child_name && !dup.child_name ? { child_name: input.child_name } : {}), ...(input.applying_for ? { applying_for: input.applying_for } : {}) };
    await svc.from("admission_leads").update(merged).eq("id", dup.id);
    await log(svc, tenantId, dup.id, "system", `Enquired again via ${input.source.replace("_", " ")}.${input.notes ? ` "${input.notes}"` : ""}`, actor);
    return { id: dup.id, merged: true };
  }
  const owner = input.owner_id ?? (await pickOwner(svc, tenantId));
  const { data: lead, error } = await svc.from("admission_leads").insert({
    tenant_id: tenantId, parent_name: input.parent_name, email, phone, child_name: input.child_name ?? null, child_dob: input.child_dob || null,
    applying_for: input.applying_for ?? null, intake: input.intake ?? null, source: referredBy ? "referral" : input.source, utm: input.utm ?? {},
    referral_code: input.referral_code?.toUpperCase() ?? null, referred_by: referredBy, notes: input.notes ?? null, owner_id: owner, consent: Boolean(input.consent),
    next_follow_up_at: new Date(Date.now() + 24 * 3_600_000).toISOString()
  }).select("*").single();
  if (error) throw new Error(error.message);
  await log(svc, tenantId, lead.id, "system", `New enquiry via ${lead.source.replace("_", " ")}.`, actor, { utm: input.utm ?? {} });
  await startSequences(svc, tenantId, lead.id, "enquiry");
  await refreshScore(svc, tenantId, lead.id);
  if (owner && owner !== actor) {
    const rows = await staffRows(svc, { tenantId, userIds: [owner], kind: "admissions_lead", subject: `New enquiry: ${lead.parent_name}`,
      text: `${lead.parent_name}${lead.child_name ? ` for ${lead.child_name}` : ""}${lead.applying_for ? ` (${lead.applying_for})` : ""} via ${lead.source.replace("_", " ")}.`,
      url: `${baseUrl}/school/admissions?lead=${lead.id}`, refId: lead.id });
    if (rows.length) await enqueue(svc, rows);
  }
  return { id: lead.id, merged: false };
}

/** Moves a lead to a stage, logs it, and swaps follow-up sequences. */
export async function setLeadStage(svc: any, tenantId: string, leadId: string, stage: Stage, actor: string | null, note?: string | null) {
  const { data: lead } = await svc.from("admission_leads").select("id,stage").eq("tenant_id", tenantId).eq("id", leadId).maybeSingle();
  if (!lead || lead.stage === stage) return lead;
  await svc.from("admission_leads").update({ stage, updated_at: new Date().toISOString(), ...(stage === "lost" ? { lost_reason: note ?? null } : {}) }).eq("id", leadId);
  await log(svc, tenantId, leadId, "stage", note ?? null, actor, { from: lead.stage, to: stage });
  await svc.from("lead_sequence_runs").update({ status: "stopped" }).eq("lead_id", leadId).eq("status", "active");
  if (OPEN.includes(stage)) await startSequences(svc, tenantId, leadId, stage);
  await refreshScore(svc, tenantId, leadId);
  return { ...lead, stage };
}

export async function startSequences(svc: any, tenantId: string, leadId: string, stage: string) {
  const { data: seqs } = await svc.from("admission_sequences").select("id,admission_sequence_steps(position,delay_hours)").eq("tenant_id", tenantId).eq("stage", stage).eq("active", true);
  for (const s of seqs ?? []) {
    const first = (s.admission_sequence_steps ?? []).sort((a: any, b: any) => a.position - b.position)[0];
    if (!first) continue;
    await svc.from("lead_sequence_runs").upsert({ tenant_id: tenantId, lead_id: leadId, sequence_id: s.id, next_step: first.position,
      next_at: new Date(Date.now() + first.delay_hours * 3_600_000).toISOString(), status: "active", started_at: new Date().toISOString() }, { onConflict: "lead_id,sequence_id" });
  }
}

/** Keeps the lead in step with its application (creating the lead for applications that came in directly). */
export async function syncLeadFromApplication(svc: any, app: any) {
  let leadId: string | null = app.lead_id ?? null;
  if (!leadId) {
    const r = await upsertLead(svc, app.tenant_id, {
      parent_name: app.guardian_name, email: app.guardian_email, phone: app.guardian_phone, child_name: `${app.first_name} ${app.last_name}`,
      child_dob: app.date_of_birth, applying_for: app.applying_for, source: (["walk_in", "referral", "agent", "website", "whatsapp", "facebook", "instagram", "phone", "open_day", "email"].includes(app.source) ? app.source : "website") as Source,
      utm: app.utm ?? {}, referral_code: app.referral_code ?? null, consent: true
    });
    leadId = r.id;
    await svc.from("applications").update({ lead_id: leadId }).eq("id", app.id);
    await svc.from("admission_leads").update({ application_id: app.id }).eq("id", leadId);
  }
  const { data: lead } = await svc.from("admission_leads").select("stage").eq("id", leadId).maybeSingle();
  const next = stageForApplication(app.status, (lead?.stage ?? "applied") as Stage);
  await setLeadStage(svc, app.tenant_id, leadId!, next, null, ["rejected", "withdrawn", "declined", "expired"].includes(app.status) ? `Application ${app.status}` : null);
  await svc.from("admission_leads").update({ application_id: app.id }).eq("id", leadId);
  return leadId;
}

/** Recomputes a lead's score from what the school knows about the family. */
export async function refreshScore(svc: any, tenantId: string, leadId: string) {
  const { data: l } = await svc.from("admission_leads").select("*").eq("id", leadId).maybeSingle();
  if (!l) return null;
  const [{ data: bookings }, { count: contacts }, app, sibling] = await Promise.all([
    svc.from("admission_bookings").select("status").eq("lead_id", leadId),
    svc.from("lead_activities").select("id", { count: "exact", head: true }).eq("lead_id", leadId).in("kind", ["call", "email", "sms", "whatsapp", "meeting"]),
    l.application_id ? svc.from("applications").select("fee_paid,assessment_score,application_documents(id)").eq("id", l.application_id).maybeSingle() : Promise.resolve({ data: null }),
    l.phone || l.email ? svc.from("guardians").select("id").eq("tenant_id", tenantId).or([l.phone ? `phone.eq.${l.phone}` : "", l.email ? `email.eq.${l.email}` : ""].filter(Boolean).join(",")).limit(1) : Promise.resolve({ data: [] })
  ]);
  const a: any = (app as any).data;
  const { score } = scoreLead({
    stage: l.stage, source: l.source, email: l.email, phone: l.phone, child_dob: l.child_dob, applying_for: l.applying_for,
    sibling: Boolean((sibling as any).data?.length), tourAttended: (bookings ?? []).some((b: any) => b.status === "attended"),
    tourBooked: (bookings ?? []).some((b: any) => b.status === "booked"), feePaid: Boolean(a?.fee_paid),
    assessmentPct: a?.assessment_score === null || a?.assessment_score === undefined ? null : Number(a.assessment_score),
    contacts: contacts ?? 0, documents: a?.application_documents?.length ?? 0,
    daysSinceContact: l.last_contact_at ? (Date.now() - new Date(l.last_contact_at).getTime()) / 86_400_000 : (Date.now() - new Date(l.created_at).getTime()) / 86_400_000
  });
  await svc.from("admission_leads").update({ score }).eq("id", leadId);
  return score;
}

async function brandAndPrincipal(svc: any, tenantId: string) {
  const brand = await loadBrand(svc, tenantId);
  const { data: s } = await svc.from("tenant_settings").select("principal_name").eq("tenant_id", tenantId).maybeSingle();
  return { brand, principal: s?.principal_name ?? "The Principal" };
}

/**
 * Runs due follow-up steps (called every minute by the dispatch job). A run
 * stops as soon as the lead leaves the stage it was started for.
 */
export async function processSequences(svc: any, opts: { limit?: number; baseUrl: string }) {
  const { data: due } = await svc.from("lead_sequence_runs")
    .select("id,tenant_id,lead_id,sequence_id,next_step,admission_sequences(stage,active,admission_sequence_steps(position,delay_hours,channel,subject,body)),admission_leads(*)")
    .eq("status", "active").lte("next_at", new Date().toISOString()).order("next_at").limit(opts.limit ?? 50);
  let sent = 0;
  for (const run of due ?? []) {
    const seq = run.admission_sequences, lead = run.admission_leads;
    if (!seq?.active || !lead || lead.stage !== seq.stage) { await svc.from("lead_sequence_runs").update({ status: "stopped" }).eq("id", run.id); continue; }
    const steps = (seq.admission_sequence_steps ?? []).sort((a: any, b: any) => a.position - b.position);
    const step = steps.find((s: any) => s.position === run.next_step);
    if (!step) { await svc.from("lead_sequence_runs").update({ status: "done" }).eq("id", run.id); continue; }
    const { brand } = await brandAndPrincipal(svc, run.tenant_id);
    const { data: t } = await svc.from("tenants").select("public_slug").eq("id", run.tenant_id).maybeSingle();
    const vars = { parent: lead.parent_name, child: lead.child_name ?? "your child", school: brand.schoolName, level: lead.applying_for ?? "",
      apply_link: t?.public_slug ? `${opts.baseUrl}/apply/${t.public_slug}` : "", visit_link: t?.public_slug ? `${opts.baseUrl}/visit/${t.public_slug}` : "" };
    const body = renderTemplate(step.body, vars);
    if (step.channel === "task") {
      await svc.from("lead_activities").insert({ tenant_id: run.tenant_id, lead_id: lead.id, kind: "task", body, due_at: new Date().toISOString(), assigned_to: lead.owner_id, meta: { sequence_id: run.sequence_id } });
    } else if (lead.consent || lead.source !== "website") {
      const lines = body.split(/\n+/).filter(Boolean);
      const link = vars.apply_link && /apply/i.test(body) ? vars.apply_link : vars.visit_link && /tour|visit/i.test(body) ? vars.visit_link : null;
      const r = admissionNote(brand, { name: lead.parent_name, subject: renderTemplate(step.subject || `${brand.schoolName} admissions`, vars), lines, link, linkLabel: link === vars.visit_link ? "Book a visit" : "Apply online" });
      const queued = await notifyContact(svc, { tenantId: run.tenant_id, name: lead.parent_name, email: step.channel === "email" ? lead.email : null,
        phone: step.channel !== "email" ? lead.phone : null, kind: "admissions_followup", refId: lead.id, build: () => r });
      if (queued) {
        await svc.from("lead_activities").insert({ tenant_id: run.tenant_id, lead_id: lead.id, kind: step.channel, body, meta: { automatic: true, sequence_id: run.sequence_id } });
        await svc.from("admission_leads").update({ last_contact_at: new Date().toISOString() }).eq("id", lead.id);
        sent++;
      } else {
        await svc.from("lead_activities").insert({ tenant_id: run.tenant_id, lead_id: lead.id, kind: "system",
          body: `Automatic ${step.channel} skipped: no ${step.channel === "email" ? "email address" : "phone number"} on file.`, meta: { sequence_id: run.sequence_id } });
      }
    }
    const next = steps.find((s: any) => s.position > step.position);
    await svc.from("lead_sequence_runs").update(next
      ? { next_step: next.position, next_at: new Date(Date.now() + next.delay_hours * 3_600_000).toISOString() }
      : { status: "done" }).eq("id", run.id);
  }
  return { processed: (due ?? []).length, sent };
}

/** Reminds families the day before their tour, open day, assessment or interview. */
export async function sendBookingReminders(svc: any, baseUrl: string) {
  const soon = new Date(Date.now() + 26 * 3_600_000).toISOString();
  const { data } = await svc.from("admission_bookings").select("id,tenant_id,name,email,phone,token,admission_events!inner(title,starts_at,location)")
    .eq("status", "booked").is("reminded_at", null).lte("admission_events.starts_at", soon).gte("admission_events.starts_at", new Date().toISOString()).limit(200);
  for (const b of data ?? []) {
    const brand = await loadBrand(svc, b.tenant_id);
    const when = formatInZone(new Date(b.admission_events.starts_at), brand.timezone);
    await notifyContact(svc, { tenantId: b.tenant_id, name: b.name, email: b.email, phone: b.phone, kind: "admissions_booking", refId: b.id,
      build: br => admissionNote(br, { name: b.name, subject: `Reminder: ${b.admission_events.title}`,
        lines: [`This is a reminder of your ${b.admission_events.title} at ${br.schoolName} on ${when.date} at ${when.time}.`, ...(b.admission_events.location ? [`Where: ${b.admission_events.location}`] : [])],
        link: `${baseUrl}/visit/booking/${b.token}`, linkLabel: "View or cancel" }) });
    await svc.from("admission_bookings").update({ reminded_at: new Date().toISOString() }).eq("id", b.id);
  }
  return (data ?? []).length;
}

/** Offers past their expiry date lapse; the lead becomes lost and the owner is told (daily job). */
export async function expireOffers(svc: any) {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await svc.from("applications").select("*").eq("status", "offered").lt("offer_expires_on", today).is("offer_accepted_at", null).limit(500);
  for (const a of data ?? []) {
    await svc.from("applications").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", a.id);
    await syncLeadFromApplication(svc, { ...a, status: "expired" });
  }
  return (data ?? []).length;
}

/** Confirms an application or acceptance fee after the provider redirect or webhook (references start with ADM-). */
export async function confirmAdmissionPayment(svc: any, reference: string) {
  const { data: p } = await svc.from("admission_payments").select("*,applications(tracking_token,tenant_id,id)").eq("reference", reference).maybeSingle();
  if (!p) return { status: "unknown", token: null as string | null };
  if (p.status === "success") return { status: "success", token: p.applications?.tracking_token ?? null };
  const v = await verifyPayment(p.provider as Provider, reference);
  if ("error" in v) return { status: "pending", token: p.applications?.tracking_token ?? null };
  if (!matchesExpected(v, Number(p.amount), p.currency)) {
    if (v.status === "failed") await svc.from("admission_payments").update({ status: "failed" }).eq("id", p.id);
    return { status: v.status === "failed" ? "failed" : "pending", token: p.applications?.tracking_token ?? null };
  }
  await svc.from("admission_payments").update({ status: "success", paid_at: new Date().toISOString() }).eq("id", p.id).neq("status", "success");
  await svc.from("applications").update(p.kind === "application_fee" ? { fee_paid: true, fee_reference: reference } : { acceptance_paid: true }).eq("id", p.application_id);
  const { data: app } = await svc.from("applications").select("*").eq("id", p.application_id).single();
  if (app.lead_id) {
    await svc.from("lead_activities").insert({ tenant_id: app.tenant_id, lead_id: app.lead_id, kind: "system", body: `${p.kind === "application_fee" ? "Application" : "Acceptance"} fee paid online (${reference}).` });
    await refreshScore(svc, app.tenant_id, app.lead_id);
  }
  return { status: "success", token: app.tracking_token };
}

export { brandAndPrincipal };

/** Starts an online application or acceptance fee payment from the family's tracking page. */
export async function startAdmissionPayment(svc: any, p: { trackingToken: string; kind: "application_fee" | "acceptance_fee"; email?: string | null; baseUrl: string }) {
  const { initializePayment, providerConfigured, newReference } = await import("./payments");
  const { financeSettings } = await import("./fees");
  const { data: app } = await svc.from("applications").select("id,tenant_id,application_no,first_name,last_name,guardian_email,fee_paid,acceptance_paid,acceptance_fee,status,tenants(status)")
    .eq("tracking_token", p.trackingToken).maybeSingle();
  if (!app || app.tenants?.status !== "active") throw new Error("application not found");
  const s = await financeSettings(svc, app.tenant_id);
  if (!providerConfigured(s.provider)) throw new Error("online payment is not enabled for this school; please pay by transfer or at the school");
  let amount = 0;
  if (p.kind === "application_fee") {
    if (app.fee_paid) throw new Error("the application fee is already paid");
    const { data: t } = await svc.from("tenant_settings").select("application_fee").eq("tenant_id", app.tenant_id).maybeSingle();
    amount = Number(t?.application_fee ?? 0);
  } else {
    if (app.acceptance_paid) throw new Error("the acceptance fee is already paid");
    if (!["offered", "accepted"].includes(app.status)) throw new Error("there is no offer to accept");
    amount = Number(app.acceptance_fee ?? 0);
  }
  if (!(amount > 0)) throw new Error("there is nothing to pay");
  const email = p.email?.trim() || app.guardian_email || process.env.PAYMENTS_FALLBACK_EMAIL || null;
  if (!email) throw new Error("enter an email address for the receipt");
  const reference = newReference("ADM");
  const { error } = await svc.from("admission_payments").insert({ tenant_id: app.tenant_id, application_id: app.id, kind: p.kind, amount, currency: s.currency,
    provider: s.provider, reference, status: "pending", payer_email: email });
  if (error) throw new Error(error.message);
  const init = await initializePayment({ provider: s.provider!, reference, amount, currency: s.currency, email, subaccount: s.subaccount,
    callbackUrl: `${p.baseUrl}/api/pay/verify?reference=${encodeURIComponent(reference)}`,
    description: `${s.schoolName ?? "School"}: ${p.kind === "application_fee" ? "application fee" : "acceptance fee"} ${app.application_no}`, logoUrl: s.logoUrl,
    metadata: { application_no: app.application_no, tenant_id: app.tenant_id, kind: p.kind } });
  if (!init.ok) { await svc.from("admission_payments").update({ status: "failed" }).eq("reference", reference); throw new Error(init.error); }
  return { url: init.url, reference };
}

/** Fingerprint of the exact offer letter a family signed (subject, body and issue time). */
export function letterHash(letter: { subject: string; body: string; issued_at: string }) {
  return createHash("sha256").update(`${letter.subject}\n${letter.body}\n${letter.issued_at}`).digest("hex");
}
