/**
 * Fee collections and fundraising on the server (phase 14g-2): the families-who-owe worklist,
 * the daily promise check (kept / broken, follow-up, polite message), and online gifts.
 */
import { notifyContact, money } from "@/lib/notify";
import { admissionNote } from "@/lib/messaging/notices";
import { nextStep, promiseState, LEVELS } from "@/lib/collections";
import { initializePayment, providerConfigured, newReference, verifyPayment, matchesExpected, type Provider } from "@/lib/payments";
import { financeSettings } from "@/lib/fees";

const day = (d: Date) => d.toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);

/** Every family that owes, with balance, age, promises, last contact, escalation and the suggested next step. */
export async function loadCollections(svc: any, tenantId: string) {
  const today = day(new Date());
  const { data: invoices } = await svc.from("fee_invoices").select("id,student_id,total,amount_paid,due_date,pay_token,status")
    .eq("tenant_id", tenantId).not("status", "in", "(paid,void)").limit(20000);
  const owing = (invoices ?? []).filter((i: any) => Number(i.total) - Number(i.amount_paid ?? 0) > 0.005);
  const sids = [...new Set(owing.map((i: any) => i.student_id))] as string[];
  if (!sids.length) return { families: [], total: 0 };
  const [{ data: links }, { data: students }] = await Promise.all([
    svc.from("student_guardians").select("student_id,guardian_id,is_primary,guardians(id,full_name,phone,email,whatsapp_phone)").eq("tenant_id", tenantId).in("student_id", sids),
    svc.from("students").select("id,first_name,last_name,class_groups(name)").in("id", sids)
  ]);
  // One family per child: the primary guardian, else the first linked.
  const familyOf = new Map<string, any>();
  for (const l of (links ?? []).sort((a: any, b: any) => Number(b.is_primary) - Number(a.is_primary))) if (!familyOf.has(l.student_id) && l.guardians) familyOf.set(l.student_id, l.guardians);
  const fam = new Map<string, any>();
  for (const i of owing) {
    const g = familyOf.get(i.student_id);
    if (!g) continue;
    const f = fam.get(g.id) ?? { guardian: g, balance: 0, oldest_due: null as string | null, children: new Set<string>(), pay_token: null as string | null };
    f.balance += Number(i.total) - Number(i.amount_paid ?? 0);
    f.children.add(i.student_id);
    if (i.due_date && (!f.oldest_due || i.due_date < f.oldest_due)) { f.oldest_due = i.due_date; f.pay_token = i.pay_token ?? f.pay_token; }
    if (!f.pay_token) f.pay_token = i.pay_token ?? null;
    fam.set(g.id, f);
  }
  const gids = [...fam.keys()];
  const [{ data: contacts }, { data: promises }, { data: cases }] = await Promise.all([
    svc.from("crm_interactions").select("guardian_id,occurred_at,kind,body").eq("tenant_id", tenantId).in("guardian_id", gids).order("occurred_at", { ascending: false }).limit(10000),
    svc.from("fee_promises").select("*").eq("tenant_id", tenantId).in("guardian_id", gids).order("created_at", { ascending: false }).limit(10000),
    svc.from("fee_collection_cases").select("*").eq("tenant_id", tenantId).in("guardian_id", gids)
  ]);
  const nameOf = (sid: string) => { const s = (students ?? []).find((x: any) => x.id === sid); return s ? { id: sid, name: `${s.first_name} ${s.last_name}`, class_name: s.class_groups?.name ?? null } : { id: sid, name: "", class_name: null }; };
  const families = gids.map(gid => {
    const f = fam.get(gid);
    const last = (contacts ?? []).find((c: any) => c.guardian_id === gid) ?? null;
    const mine = (promises ?? []).filter((p: any) => p.guardian_id === gid);
    const open = mine.find((p: any) => p.status === "open") ?? null;
    const c = (cases ?? []).find((x: any) => x.guardian_id === gid) ?? null;
    const daysOverdue = f.oldest_due && f.oldest_due < today ? daysBetween(f.oldest_due, today) : 0;
    const lastContactDays = last ? daysBetween(last.occurred_at.slice(0, 10), today) : null;
    const brokenPromises = mine.filter((p: any) => p.status === "broken" && (!last || p.settled_at > last.occurred_at)).length;
    const level = c?.level ?? 0;
    return {
      guardian_id: gid, name: f.guardian.full_name, phone: f.guardian.whatsapp_phone ?? f.guardian.phone, email: f.guardian.email,
      children: [...f.children].map(nameOf), balance: Math.round(f.balance * 100) / 100, oldest_due: f.oldest_due, days_overdue: daysOverdue, pay_token: f.pay_token,
      level, level_label: LEVELS[level], owner_id: c?.owner_id ?? null, next_action_at: c?.next_action_at ?? null, case_note: c?.note ?? null,
      last_contact: last ? { at: last.occurred_at, kind: last.kind, body: last.body } : null,
      promise: open ? { id: open.id, amount: Number(open.amount), promised_by: open.promised_by } : null,
      promises: mine.slice(0, 5).map((p: any) => ({ id: p.id, amount: Number(p.amount), promised_by: p.promised_by, status: p.status, paid: Number(p.paid) })),
      next: nextStep({ balance: f.balance, daysOverdue, level, lastContactDays, openPromise: open ? { amount: Number(open.amount), promised_by: open.promised_by } : null, brokenPromises }, today)
    };
  }).sort((a, b) => Number(b.next.urgent) - Number(a.next.urgent) || b.days_overdue - a.days_overdue || b.balance - a.balance);
  return { families, total: Math.round(families.reduce((s, f) => s + f.balance, 0) * 100) / 100 };
}

/** Payments for these children since a moment (successful only). */
async function paidSince(svc: any, studentIds: string[], since: string) {
  if (!studentIds.length) return 0;
  const { data } = await svc.from("fee_payments").select("amount").in("student_id", studentIds).eq("status", "success").gte("created_at", since);
  return (data ?? []).reduce((s: number, p: any) => s + Number(p.amount), 0);
}

/**
 * Daily: every open promise is checked against payments since it was made. Kept promises close;
 * broken ones raise the family's case to "call", leave a follow-up for today on the family's
 * record, and the parent gets a polite message with the payment link.
 */
export async function runPromiseChecks(svc: any, base: string) {
  const today = day(new Date());
  const { data: open } = await svc.from("fee_promises").select("*,guardians(full_name,phone,email,whatsapp_phone)").eq("status", "open").limit(2000);
  let kept = 0, broken = 0;
  for (const p of open ?? []) {
    let sids = p.student_ids ?? [];
    if (!sids.length) {
      const { data: kids } = await svc.from("student_guardians").select("student_id").eq("guardian_id", p.guardian_id);
      sids = (kids ?? []).map((k: any) => k.student_id);
    }
    const paid = await paidSince(svc, sids, p.created_at);
    const state = promiseState({ amount: Number(p.amount), promised_by: p.promised_by }, paid, today);
    if (state === "open") { if (paid !== Number(p.paid)) await svc.from("fee_promises").update({ paid }).eq("id", p.id); continue; }
    await svc.from("fee_promises").update({ status: state, paid, settled_at: new Date().toISOString() }).eq("id", p.id);
    const g = p.guardians ?? {};
    const { data: s } = await svc.from("tenant_settings").select("currency").eq("tenant_id", p.tenant_id).maybeSingle();
    if (state === "kept") {
      kept++;
      await svc.from("crm_interactions").insert({ tenant_id: p.tenant_id, guardian_id: p.guardian_id, kind: "note", body: `Promise to pay ${money(Number(p.amount), s?.currency ?? "NGN")} kept.` });
      continue;
    }
    broken++;
    const { data: c } = await svc.from("fee_collection_cases").select("level").eq("tenant_id", p.tenant_id).eq("guardian_id", p.guardian_id).maybeSingle();
    await svc.from("fee_collection_cases").upsert({ tenant_id: p.tenant_id, guardian_id: p.guardian_id, level: Math.max(2, c?.level ?? 0), next_action_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: "tenant_id,guardian_id" });
    await svc.from("crm_interactions").insert({ tenant_id: p.tenant_id, guardian_id: p.guardian_id, kind: "note", follow_up_at: new Date().toISOString(),
      body: `Promise to pay ${money(Number(p.amount), s?.currency ?? "NGN")} by ${p.promised_by} was not kept (${money(paid, s?.currency ?? "NGN")} paid since). Call the family.` });
    const { data: inv } = await svc.from("fee_invoices").select("pay_token").in("student_id", sids).not("status", "in", "(paid,void)").order("due_date").limit(1);
    await notifyContact(svc, { tenantId: p.tenant_id, name: g.full_name, email: g.email, phone: g.whatsapp_phone ?? g.phone, kind: "fees", refId: p.id, defer: true,
      build: br => admissionNote(br, { name: g.full_name, subject: "School fees: the payment you planned",
        lines: [`We have not yet received the ${money(Number(p.amount), s?.currency ?? "NGN")} you planned to pay by ${new Date(`${p.promised_by}T12:00:00Z`).toLocaleDateString("en-GB", { dateStyle: "long" })}.`,
          "If you have paid, thank you, and please ignore this message. If you need more time, reply or call the bursar so we can agree a new date."],
        link: inv?.[0]?.pay_token ? `${base}/pay/${inv[0].pay_token}` : null, linkLabel: "Pay now" }) }).catch(() => 0);
  }
  return { kept, broken };
}

/** Starts an online gift on the public giving page. */
export async function startDonation(svc: any, p: { tenantId: string; campaign: any; name: string; email: string; phone?: string | null; amount: number; anonymous: boolean; message?: string | null; base: string; schoolSlug: string }) {
  const s = await financeSettings(svc, p.tenantId);
  if (!providerConfigured(s.provider)) throw new Error("Online giving is not switched on for this school yet. Please contact the school.");
  const reference = newReference("DON");
  const { error } = await svc.from("donations").insert({ tenant_id: p.tenantId, campaign_id: p.campaign.id, donor_name: p.name, email: p.email, phone: p.phone ?? null,
    amount: p.amount, currency: s.currency, kind: "gift", status: "pending", method: "online", anonymous: p.anonymous, message: p.message ?? null, reference, provider: s.provider });
  if (error) throw new Error(error.message);
  const init = await initializePayment({ provider: s.provider!, reference, amount: p.amount, currency: s.currency, email: p.email, name: p.name, phone: p.phone ?? null, subaccount: s.subaccount,
    callbackUrl: `${p.base}/api/pay/verify?reference=${encodeURIComponent(reference)}`, description: `${s.schoolName ?? "School"}: ${p.campaign.title}`, logoUrl: s.logoUrl,
    metadata: { tenant_id: p.tenantId, campaign: p.campaign.slug, kind: "donation" } });
  if (!init.ok) { await svc.from("donations").update({ status: "failed" }).eq("reference", reference); throw new Error(init.error); }
  return { url: init.url };
}

/** Confirms an online gift with the provider (redirect or webhook), numbers its receipt and thanks the donor. */
export async function confirmDonation(svc: any, reference: string, base = "") {
  const { data: d } = await svc.from("donations").select("*,fundraising_campaigns(slug,title),tenants(public_slug)").eq("reference", reference).maybeSingle();
  if (!d) return { status: "unknown", path: "/" };
  const path = `/give/${d.tenants?.public_slug ?? ""}/${d.fundraising_campaigns?.slug ?? ""}`;
  if (d.status === "paid") return { status: "success", path };
  const v = await verifyPayment(d.provider as Provider, reference);
  if ("error" in v) return { status: "pending", path };
  if (!matchesExpected(v, Number(d.amount), d.currency)) {
    if (v.status === "failed") await svc.from("donations").update({ status: "failed" }).eq("id", d.id);
    return { status: v.status === "failed" ? "failed" : "pending", path };
  }
  const { data: no } = await svc.rpc("next_doc_no", { p_tenant: d.tenant_id, p_kind: "don" });
  const { data: done } = await svc.from("donations").update({ status: "paid", paid_at: new Date().toISOString(), receipt_no: no }).eq("id", d.id).neq("status", "paid").select("id");
  if (done?.length) {
    await notifyContact(svc, { tenantId: d.tenant_id, name: d.donor_name, email: d.email, phone: d.phone, kind: "donation", refId: d.id,
      build: br => admissionNote(br, { name: d.donor_name, subject: `Thank you for supporting ${d.fundraising_campaigns?.title ?? "the school"}`,
        lines: [`We have received your gift of ${money(Number(d.amount), d.currency)}. Thank you.`, `Receipt ${no}.`], link: base ? `${base}${path}` : null, linkLabel: "See the appeal" }) }).catch(() => 0);
  }
  return { status: "success", path };
}
