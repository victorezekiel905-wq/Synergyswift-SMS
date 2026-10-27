/**
 * Entrance exam automation (phase 14e), run every minute by the dispatch job:
 *  1. seats tests still waiting for a sitting (after a sitting is added or seats are raised);
 *  2. tells each family about the test: the online link and window, or the centre, time and
 *     a one-time PIN for the centre computer, or a link to choose a sitting;
 *  3. reminds families the day before;
 *  4. marks candidates who missed their sitting as absent (and tells the family);
 *  5. works out the merit list for every open intake and, when the intake decides
 *     automatically and its results are released, sends the decisions; interviews for
 *     borderline candidates are booked as soon as their test is marked.
 * Messages are queued (the dispatch run sends them right after).
 */
import { randomInt } from "crypto";
import { sha256hex } from "@/lib/crypto";
import { notifyContact } from "@/lib/notify";
import { admissionNote } from "@/lib/messaging/notices";
import { PIN_ALPHABET, formatPin, proposeDecisions, type Candidate, type EntrancePlan, type Proposal } from "@/lib/entrance";
import { bookInterview, issueOffer, regret, waitlist } from "@/lib/admissions-decisions";

export const pinHash = (pin: string) => sha256hex(`entrance-pin:${pin}`);

function newPin() {
  let s = "";
  for (let i = 0; i < 8; i++) s += PIN_ALPHABET[randomInt(PIN_ALPHABET.length)];
  return s;
}

/** A fresh one-time PIN for a centre test (any earlier PIN stops working). Valid until an hour after the sitting. */
export async function issuePin(svc: any, attempt: { id: string }, sittingEnds: string | null) {
  const expires = sittingEnds ? new Date(new Date(sittingEnds).getTime() + 3_600_000).toISOString() : new Date(Date.now() + 7 * 86_400_000).toISOString();
  for (let i = 0; i < 5; i++) {
    const pin = newPin();
    const { error } = await svc.from("entrance_attempts").update({ pin_hash: pinHash(pin), pin_expires_at: expires }).eq("id", attempt.id);
    if (!error) return pin;
    if (!/duplicate|unique/i.test(error.message)) throw new Error(error.message);
  }
  throw new Error("could not make a unique PIN; try again");
}

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" });
const ATTEMPT = "id,tenant_id,status,token,opens_at,closes_at,notified_at,reminded_at,absent,sitting_id,application_id,exams(title,duration_minutes)," +
  "applications!inner(id,tenant_id,first_name,last_name,guardian_name,guardian_email,guardian_phone,tracking_token,status,entrance_plan_id,lead_id)";

async function sittingsById(svc: any, ids: string[]) {
  if (!ids.length) return new Map<string, any>();
  const { data } = await svc.from("entrance_sittings").select("*").in("id", ids);
  return new Map<string, any>((data ?? []).map((s: any) => [s.id, s]));
}
async function plansById(svc: any, ids: string[]) {
  if (!ids.length) return new Map<string, any>();
  const { data } = await svc.from("entrance_plans").select("*").in("id", ids);
  return new Map<string, any>((data ?? []).map((p: any) => [p.id, p]));
}

/** The message telling a family about their child's test. */
export async function sendTestDetails(svc: any, at: any, sitting: any | null, plan: any | null, base: string, opts: { reminder?: boolean; defer?: boolean } = {}) {
  const a = at.applications;
  const exam = at.exams ?? {};
  const child = a.first_name;
  let lines: string[];
  let link: string;
  let label: string;
  if (sitting?.kind === "centre") {
    const pin = opts.reminder ? null : await issuePin(svc, at, sitting.ends_at);
    lines = [
      `${child}'s entrance test (${exam.title ?? "entrance test"}, ${exam.duration_minutes ?? 60} minutes) is at ${sitting.centre}${sitting.address ? `, ${sitting.address}` : ""}, ${when(sitting.starts_at)}.`,
      pin ? `${child}'s test PIN is ${formatPin(pin)}. ${child} types it on the school's computer to begin. Keep it private.`
          : `Bring the test PIN we sent. If it is lost, the staff at the centre can give ${child} a new one.`,
      "Please arrive 20 minutes early."
    ];
    link = `${base}/apply/track/${a.tracking_token}`; label = "View application";
  } else if (!sitting && plan?.where_mode === "choice") {
    lines = [`${child}'s entrance test is ready to book. Choose a date: online from home, or at one of the school's centres.`];
    link = `${base}/apply/track/${a.tracking_token}`; label = "Choose a date";
  } else {
    const window = at.opens_at ? `It opens ${when(at.opens_at)}${at.closes_at ? ` and closes ${when(at.closes_at)}` : ""}.` : "It can be taken any time.";
    lines = [`${child}'s online entrance test (${exam.title ?? "entrance test"}, ${exam.duration_minutes ?? 60} minutes) ${opts.reminder ? "is tomorrow" : "is ready"}.`, window,
      "Please let your child take it alone, in one sitting, on a computer or tablet." + (plan?.face_check ? " The test uses the camera to check the right person is taking it." : "")];
    link = `${base}/entrance/${at.token}`; label = "Start the entrance test";
  }
  return notifyContact(svc, { tenantId: at.tenant_id, name: a.guardian_name, email: a.guardian_email, phone: a.guardian_phone, kind: "admission", refId: a.id, defer: opts.defer,
    build: br => admissionNote(br, { name: a.guardian_name, subject: `${opts.reminder ? "Reminder: " : ""}Entrance test for ${child}`, lines, link, linkLabel: label }) });
}

export async function runEntranceAutomation(svc: any, base: string) {
  const out = { seated: 0, notified: 0, reminded: 0, absent: 0, decided: 0 };
  const { data: plans, error } = await svc.from("entrance_plans").select("*").eq("status", "open").limit(500);
  if (error) return out; // not set up yet (migration 6200)

  // 1. Seat tests waiting for a sitting.
  for (const p of (plans ?? []).filter((x: any) => x.where_mode !== "choice")) {
    const { data: n } = await svc.rpc("entrance_seat_waiting", { p_plan: p.id });
    out.seated += Number(n ?? 0);
  }

  // 2. Tell families about new tests.
  const { data: fresh } = await svc.from("entrance_attempts").select(ATTEMPT).eq("status", "assigned").is("notified_at", null).limit(200);
  const freshPlans = await plansById(svc, [...new Set((fresh ?? []).map((t: any) => t.applications?.entrance_plan_id).filter(Boolean))] as string[]);
  const freshSittings = await sittingsById(svc, [...new Set((fresh ?? []).map((t: any) => t.sitting_id).filter(Boolean))] as string[]);
  for (const at of fresh ?? []) {
    const plan = freshPlans.get(at.applications?.entrance_plan_id) ?? null;
    const sitting = at.sitting_id ? freshSittings.get(at.sitting_id) : null;
    if (plan?.where_mode === "centre" && !sitting) continue; // waits for a seat; staff see it on the Entrance screen
    try {
      await sendTestDetails(svc, at, sitting, plan, base, { defer: true });
      await svc.from("entrance_attempts").update({ notified_at: new Date().toISOString() }).eq("id", at.id);
      out.notified++;
    } catch { /* tried again next run */ }
  }

  // 3. Day-before reminders.
  const soon = new Date(Date.now() + 24 * 3_600_000).toISOString(), nowIso = new Date().toISOString();
  const { data: upcoming } = await svc.from("entrance_sittings").select("*").gt("starts_at", nowIso).lte("starts_at", soon).limit(200);
  if (upcoming?.length) {
    const { data: due } = await svc.from("entrance_attempts").select(ATTEMPT).in("sitting_id", upcoming.map((s: any) => s.id)).eq("status", "assigned")
      .not("notified_at", "is", null).is("reminded_at", null).limit(500);
    const byId = new Map<string, any>(upcoming.map((s: any) => [s.id, s]));
    for (const at of due ?? []) {
      // Not when the first message went out within the last 12 hours.
      if (Date.now() - new Date(at.notified_at).getTime() < 12 * 3_600_000) continue;
      await sendTestDetails(svc, at, byId.get(at.sitting_id), null, base, { reminder: true, defer: true }).catch(() => 0);
      await svc.from("entrance_attempts").update({ reminded_at: nowIso }).eq("id", at.id);
      out.reminded++;
    }
  }

  // 4. Absent: the sitting is over and the test was never started.
  const { data: over } = await svc.from("entrance_sittings").select("id,plan_id,ends_at").lt("ends_at", new Date(Date.now() - 30 * 60_000).toISOString())
    .gt("ends_at", new Date(Date.now() - 14 * 86_400_000).toISOString()).limit(500);
  if (over?.length) {
    const { data: missed } = await svc.from("entrance_attempts").select(ATTEMPT).in("sitting_id", over.map((s: any) => s.id)).eq("status", "assigned").eq("absent", false).limit(500);
    const missedPlans = await plansById(svc, [...new Set((missed ?? []).map((t: any) => t.applications?.entrance_plan_id).filter(Boolean))] as string[]);
    for (const at of missed ?? []) {
      await svc.from("entrance_attempts").update({ absent: true }).eq("id", at.id);
      out.absent++;
      const a = at.applications, plan = missedPlans.get(a?.entrance_plan_id);
      await notifyContact(svc, { tenantId: at.tenant_id, name: a.guardian_name, email: a.guardian_email, phone: a.guardian_phone, kind: "admission", refId: a.id, defer: true,
        build: br => admissionNote(br, { name: a.guardian_name, subject: `${a.first_name} missed the entrance test`,
          lines: [`${a.first_name} did not take the entrance test at the time booked.`, plan?.where_mode === "choice" ? "You can choose another date with the link below." : "Please contact the school to arrange another date."],
          link: `${base}/apply/track/${a.tracking_token}`, linkLabel: plan?.where_mode === "choice" ? "Choose another date" : "View application" }) }).catch(() => 0);
      if (a.lead_id) await svc.from("lead_activities").insert({ tenant_id: at.tenant_id, lead_id: a.lead_id, kind: "system", body: "Missed the entrance test sitting." });
    }
  }

  // 5. Decisions.
  for (const p of plans ?? []) out.decided += await decideIntake(svc, p, base, { send: null });
  return out;
}

/** Camera photos from home tests are kept 60 days (as the consent on the test page says). Daily. */
export async function purgeEntrancePhotos(svc: any) {
  const before = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const { data: old, error } = await svc.from("entrance_events").select("id,meta").eq("kind", "snapshot").lt("at", before).limit(1000);
  if (error || !old?.length) return 0;
  const paths = old.map((e: any) => e.meta?.path).filter(Boolean);
  if (paths.length) await svc.storage.from("admissions").remove(paths);
  await svc.from("entrance_events").delete().in("id", old.map((e: any) => e.id));
  return old.length;
}

/** Candidates of an intake with everything the decision needs. */
export async function loadCandidates(svc: any, planId: string) {
  const { data } = await svc.from("applications").select("id,tenant_id,status,first_name,last_name,applying_for,application_no,guardian_name,guardian_email,guardian_phone,tracking_token,lead_id,created_at," +
    "previous_school,source,assessment_score,interview_score,report_score,composite_score,merit_rank,proposed_decision,decision_reason,waitlist_position,decided_at,offer_expires_on," +
    "entrance_attempts(id,status,total_score,max_score,section_scores,absent,face_flags,violations,sitting_id,checked_in_at,submitted_at)")
    .eq("entrance_plan_id", planId).limit(5000);
  return (data ?? []) as any[];
}

export function toCandidate(a: any): Candidate {
  const at = (a.entrance_attempts ?? [])[0];
  const graded = at && at.status === "graded" && at.max_score;
  return {
    id: a.id, status: a.status, created_at: a.created_at,
    test: graded ? Math.round((Number(at.total_score) / Number(at.max_score)) * 1000) / 10 : null,
    sections: (at?.section_scores ?? {}) as Record<string, number>,
    interview: a.interview_score === null || a.interview_score === undefined ? null : Number(a.interview_score),
    report: a.report_score === null || a.report_score === undefined ? null : Number(a.report_score)
  };
}

/** Seats left for an intake: its capacity (named intake, else the level's) minus offers out, acceptances and enrolments. null = no limit. */
export async function seatsLeftFor(svc: any, plan: any) {
  const { data: caps } = await svc.from("admission_capacity").select("intake,seats").eq("tenant_id", plan.tenant_id).ilike("level", plan.level);
  const cap = (caps ?? []).find((c: any) => c.intake === plan.intake) ?? (caps ?? []).find((c: any) => c.intake === "");
  if (!cap) return null;
  const { count } = await svc.from("applications").select("id", { count: "exact", head: true }).eq("tenant_id", plan.tenant_id).ilike("applying_for", plan.level)
    .in("status", ["offered", "accepted", "enrolled"]);
  return Math.max(0, Number(cap.seats) - Number(count ?? 0));
}

/**
 * Works out the merit list for an intake and stores each candidate's proposed decision.
 * Interviews are booked straight away. Offers, waiting list and regrets go out when the
 * intake decides automatically and its results are released, or when staff send them
 * (`send`: the application ids to send, or "all").
 */
export async function decideIntake(svc: any, plan: any, base: string, opts: { send: string[] | "all" | null }) {
  const apps = await loadCandidates(svc, plan.id);
  if (!apps.length) return 0;
  const seats = await seatsLeftFor(svc, plan);
  const proposals = proposeDecisions(plan as EntrancePlan, apps.map(toCandidate), seats ?? 1e9);
  const byId = new Map(apps.map(a => [a.id, a]));
  const released = !plan.release_at || new Date(plan.release_at).getTime() <= Date.now();
  const auto = plan.decision_mode === "auto" && released;
  let acted = 0;
  for (const p of proposals) {
    const a = byId.get(p.id);
    if (!a) continue;
    if (a.proposed_decision !== p.decision || Number(a.composite_score ?? NaN) !== Number(p.score ?? NaN) || a.merit_rank !== p.rank || a.decision_reason !== p.reason) {
      await svc.from("applications").update({ proposed_decision: p.decision, composite_score: p.score, merit_rank: p.rank, decision_reason: p.reason }).eq("id", a.id);
    }
    const chosen = opts.send === "all" || (Array.isArray(opts.send) && opts.send.includes(a.id));
    if (await apply(svc, plan, a, p, base, { interviewOnly: !(auto || chosen) })) acted++;
  }
  return acted;
}

/** Carries out one proposal if it changes anything. Returns true when something was sent or changed. */
async function apply(svc: any, plan: any, a: any, p: Proposal, base: string, opts: { interviewOnly: boolean }) {
  if (!p.decision) return false;
  if (p.decision === "interview") {
    if (a.status === "interview") return false;
    await bookInterview(svc, a, base, true);
    return true;
  }
  if (opts.interviewOnly) return false;
  const stamp = () => svc.from("applications").update({ decided_at: new Date().toISOString() }).eq("id", a.id);
  if (p.decision === "offer") {
    if (["offered", "accepted", "enrolled"].includes(a.status)) return false;
    await issueOffer(svc, a, base, { acceptanceFee: plan.acceptance_fee === null || plan.acceptance_fee === undefined ? null : Number(plan.acceptance_fee), validDays: plan.offer_valid_days ?? null, defer: true });
    await stamp();
    return true;
  }
  if (p.decision === "waitlist") {
    if (a.status === "waitlisted" && a.waitlist_position === (p.waitlist_position ?? null)) return false;
    await waitlist(svc, a, p.waitlist_position ?? null, base, true);
    return true;
  }
  if (a.status === "rejected") return false;
  await regret(svc, a, base, true);
  return true;
}
