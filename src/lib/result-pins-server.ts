/**
 * Result-checker PINs on the server (phase 14l): making a batch and checking a PIN.
 * PINs are kept only as hashes; the plain PINs are returned once, when the batch is made.
 */
import { randomDigits, sha256hex } from "@/lib/crypto";
import { normalizePin, serialFor, serialPrefix, pinDecision, TRIES } from "@/lib/result-pins";
import { localDate } from "@/lib/staff-time";

export const pinHash = (tenantId: string, pin: string) => sha256hex(`result-pin:${tenantId}:${normalizePin(pin)}`);

export async function createPinBatch(svc: any, p: { tenantId: string; schoolName: string; name: string; termId: string | null; maxUses: number; price: number; count: number; expiresOn: string | null; actor: string }) {
  const { data: batch, error } = await svc.from("result_pin_batches").insert({ tenant_id: p.tenantId, name: p.name, term_id: p.termId, max_uses: p.maxUses, price: p.price,
    pins: p.count, expires_on: p.expiresOn, created_by: p.actor }).select("id").single();
  if (error) throw new Error(error.message);
  const prefix = serialPrefix(p.schoolName);
  const { count: existing } = await svc.from("result_pins").select("id", { count: "exact", head: true }).eq("tenant_id", p.tenantId);
  const out: { serial: string; pin: string }[] = [];
  const seen = new Set<string>();
  let n = (existing ?? 0) + 1;
  while (out.length < p.count) {
    const pin = randomDigits(12);
    if (seen.has(pin)) continue;
    seen.add(pin);
    out.push({ serial: serialFor(prefix, n++), pin });
  }
  for (let i = 0; i < out.length; i += 500) {
    const chunk = out.slice(i, i + 500);
    const { error: e } = await svc.from("result_pins").insert(chunk.map(x => ({ tenant_id: p.tenantId, batch_id: batch.id, serial: x.serial, pin_hash: pinHash(p.tenantId, x.pin) })));
    if (e) { await svc.from("result_pin_batches").delete().eq("id", batch.id); throw new Error(/duplicate/.test(e.message) ? "Please try again (a PIN clashed)." : e.message); }
  }
  return { batchId: batch.id, pins: out };
}

/** The public result checker: school (by its web address), admission number and PIN → the report card link. */
export async function checkResult(svc: any, p: { slug: string; admissionNo: string; pin: string; ip: string; now?: Date }): Promise<{ ok: true; token: string; term: string; student: string } | { ok: false; error: string; status: number }> {
  const now = p.now ?? new Date();
  const { data: tenant } = await svc.from("tenants").select("id,status,timezone").eq("slug", p.slug.toLowerCase()).maybeSingle();
  if (!tenant || tenant.status !== "active") return { ok: false, error: "not found", status: 404 };
  const since = new Date(now.getTime() - TRIES.windowMin * 60_000).toISOString();
  const ipKey = `ip:${sha256hex(p.ip).slice(0, 24)}`, stKey = `st:${tenant.id}:${p.admissionNo.trim().toUpperCase()}`;
  const [{ count: ipTries }, { count: stTries }] = await Promise.all([
    svc.from("result_pin_tries").select("id", { count: "exact", head: true }).eq("key", ipKey).gte("at", since),
    svc.from("result_pin_tries").select("id", { count: "exact", head: true }).eq("key", stKey).gte("at", since)
  ]);
  if ((ipTries ?? 0) >= TRIES.perAddress || (stTries ?? 0) >= TRIES.perStudent) return { ok: false, error: "Too many tries. Wait 15 minutes and try again.", status: 429 };
  await svc.from("result_pin_tries").insert([{ key: ipKey }, { key: stKey }]);

  const { data: student } = await svc.from("students").select("id,first_name,last_name,status").eq("tenant_id", tenant.id).ilike("admission_no", p.admissionNo.trim()).maybeSingle();
  const { data: pin } = await svc.from("result_pins").select("id,status,uses,student_id,batch_id,first_used_at").eq("tenant_id", tenant.id).eq("pin_hash", pinHash(tenant.id, p.pin)).maybeSingle();
  const { data: batch } = pin ? await svc.from("result_pin_batches").select("max_uses,expires_on,term_id").eq("id", pin.batch_id).maybeSingle() : { data: null };
  if (!student) return { ok: false, error: "We could not find that admission number with that PIN.", status: 400 };
  const d = pinDecision(pin, batch, student.id, localDate(now, tenant.timezone || "Africa/Lagos"));
  if (!d.ok) return { ok: false, error: d.error, status: 400 };
  let q = svc.from("report_cards").select("access_token,term_id,terms(name,academic_sessions(name))").eq("tenant_id", tenant.id).eq("student_id", student.id).eq("status", "published").eq("kind", "term");
  if (batch!.term_id) q = q.eq("term_id", batch!.term_id);
  const { data: cards } = await q.order("published_at", { ascending: false }).limit(1);
  const card = cards?.[0];
  if (!card) return { ok: false, error: batch!.term_id ? "The result for that term has not been published yet. The PIN has not been used." : "No result has been published for this student yet. The PIN has not been used.", status: 400 };
  // Only now does the PIN count a use (and belong to this student).
  await svc.from("result_pins").update({ uses: pin!.uses + 1, student_id: student.id, first_used_at: pin!.first_used_at ?? now.toISOString(), last_used_at: now.toISOString() }).eq("id", pin!.id).eq("uses", pin!.uses);
  const term = [card.terms?.name, card.terms?.academic_sessions?.name].filter(Boolean).join(" ");
  return { ok: true, token: card.access_token, term, student: `${student.first_name} ${student.last_name}` };
}
