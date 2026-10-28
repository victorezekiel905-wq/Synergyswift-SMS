/**
 * USSD menus for parents (phase 14q), the data part: what each screen says for
 * one child, from the school's records. A school that sells result PINs keeps
 * that: results need a PIN, checked and counted exactly as on the web results
 * checker, with tries limited per phone. Fee and result links follow by SMS.
 */
import { createHash } from "crypto";
import { pinDecision, TRIES } from "@/lib/result-pins";
import { pinHash } from "@/lib/result-pins-server";
import { localDate } from "@/lib/staff-time";
import { sendSms, smsConfigured } from "@/lib/messaging/providers";
import { money } from "@/lib/notify";
import type { UssdChild, UssdData, ResultReply } from "@/lib/ussd";

const phoneKey = (phone: string) => `ussd:${createHash("sha256").update(`ussd:${phone.replace(/\D/g, "").slice(-10)}`).digest("hex").slice(0, 24)}`;
const time = (iso: string, tz: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz }).replace(" ", "");
const dayStart = (date: string) => `${date}T00:00:00Z`;

async function sms(phone: string, text: string) {
  if (smsConfigured()) await sendSms({ to: phone.replace(/\D/g, ""), text }).catch(() => null);
}

export function ussdData(svc: any, base: string): UssdData {
  return {
    async children(phone) {
      const { data } = await svc.rpc("ussd_children", { p_digits: phone });
      return (data ?? []).map((r: any) => ({ tenantId: r.tenant_id, guardianId: r.guardian_id, studentId: r.student_id, firstName: r.first_name, lastName: r.last_name,
        className: r.class_name, timezone: r.timezone, school: r.school_name })) as UssdChild[];
    },

    async result(c, pin, phone): Promise<ResultReply> {
      const now = new Date();
      const { count: batches } = await svc.from("result_pin_batches").select("id", { count: "exact", head: true }).eq("tenant_id", c.tenantId);
      let termId: string | null = null;
      let usePin: { id: string; uses: number; first_used_at: string | null } | null = null;
      if ((batches ?? 0) > 0) {
        if (!pin) return { kind: "need_pin" };
        const key = phoneKey(phone);
        const since = new Date(now.getTime() - TRIES.windowMin * 60_000).toISOString();
        const { count } = await svc.from("result_pin_tries").select("id", { count: "exact", head: true }).eq("key", key).gte("at", since);
        if ((count ?? 0) >= 5) return { kind: "error", text: "Too many tries. Wait 15 minutes, then dial again." };
        await svc.from("result_pin_tries").insert({ key });
        const { data: p } = await svc.from("result_pins").select("id,status,uses,student_id,batch_id,first_used_at").eq("tenant_id", c.tenantId).eq("pin_hash", pinHash(c.tenantId, pin)).maybeSingle();
        const { data: b } = p ? await svc.from("result_pin_batches").select("max_uses,expires_on,term_id").eq("id", p.batch_id).maybeSingle() : { data: null };
        const d = pinDecision(p, b, c.studentId, localDate(now, c.timezone));
        if (!d.ok) return { kind: "error", text: d.error };
        termId = b!.term_id; usePin = p;
      }
      let q = svc.from("report_cards").select("average,position,class_size,access_token,terms(name,academic_sessions(name))").eq("tenant_id", c.tenantId).eq("student_id", c.studentId).eq("status", "published").eq("kind", "term");
      if (termId) q = q.eq("term_id", termId);
      const { data: cards } = await q.order("published_at", { ascending: false }).limit(1);
      const card = cards?.[0];
      if (!card) return { kind: "error", text: `No result has been published for ${c.firstName} yet.${usePin ? " Your PIN was not used." : ""}` };
      // Only now does the PIN count a use (and belong to this child).
      if (usePin) await svc.from("result_pins").update({ uses: usePin.uses + 1, student_id: c.studentId, first_used_at: usePin.first_used_at ?? now.toISOString(), last_used_at: now.toISOString() }).eq("id", usePin.id).eq("uses", usePin.uses);
      const term = [card.terms?.name, card.terms?.academic_sessions?.name].filter(Boolean).join(" ");
      await sms(phone, `${c.firstName}'s ${term} report card: ${base}/r/${card.access_token}`);
      const pos = card.position && card.class_size ? `, position ${card.position} of ${card.class_size}` : "";
      return { kind: "done", text: `${c.firstName}, ${term}: average ${Number(card.average ?? 0).toFixed(1)}${pos}. The full report card link is on its way by SMS.` };
    },

    async fees(c, phone) {
      const { data: inv } = await svc.from("fee_invoices").select("total,amount_paid,due_date,pay_token,status").eq("tenant_id", c.tenantId).eq("student_id", c.studentId).not("status", "in", "(paid,void)");
      const { data: st } = await svc.from("tenant_settings").select("currency").eq("tenant_id", c.tenantId).maybeSingle();
      const open = (inv ?? []).map((i: any) => ({ ...i, owed: Math.max(0, Number(i.total) - Number(i.amount_paid ?? 0)) })).filter((i: any) => i.owed > 0.005)
        .sort((a: any, b: any) => String(a.due_date ?? "").localeCompare(String(b.due_date ?? "")));
      const total = open.reduce((s: number, i: any) => s + i.owed, 0);
      if (!total) return `${c.firstName} owes nothing. Thank you.`;
      const cur = st?.currency ?? "NGN";
      const due = open[0].due_date ? `, due ${new Date(`${open[0].due_date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}` : "";
      if (open[0].pay_token && smsConfigured()) {
        await sms(phone, `Pay ${c.firstName}'s school fees (${money(total, cur)}): ${base}/pay/${open[0].pay_token}`);
        return `${c.firstName}: fees balance ${money(total, cur)}${due}. A payment link is on its way by SMS.`;
      }
      return `${c.firstName}: fees balance ${money(total, cur)}${due}. Pay in the parent app or at the school.`;
    },

    async attendance(c) {
      const today = localDate(new Date(), c.timezone);
      const [{ data: mark }, { data: gate }] = await Promise.all([
        svc.from("class_attendance").select("status").eq("tenant_id", c.tenantId).eq("student_id", c.studentId).eq("date", today).maybeSingle(),
        svc.from("gate_events").select("direction,at").eq("tenant_id", c.tenantId).eq("student_id", c.studentId).gte("at", dayStart(today)).order("at").limit(20)
      ]);
      const ins = (gate ?? []).filter((g: any) => g.direction === "in"), outs = (gate ?? []).filter((g: any) => g.direction === "out");
      const parts: string[] = [];
      if (ins.length) parts.push(`arrived ${time(ins[0].at, c.timezone)}`);
      if (outs.length && (!ins.length || outs[outs.length - 1].at > ins[ins.length - 1].at)) parts.push(`left ${time(outs[outs.length - 1].at, c.timezone)}`);
      const reg = mark?.status ? `Register: ${mark.status}.` : "The register is not taken yet.";
      return `${c.firstName} today: ${parts.length ? `${parts.join(", ")}. ` : ""}${reg}`;
    },

    async bus(c) {
      const today = localDate(new Date(), c.timezone);
      const { data: ev } = await svc.from("transport_events").select("kind,stop_name,at,transport_routes(name)").eq("tenant_id", c.tenantId).eq("student_id", c.studentId)
        .gte("at", dayStart(today)).order("at", { ascending: false }).limit(1);
      const e = ev?.[0];
      if (!e) return `${c.firstName} has not been on a school bus today.`;
      const route = e.transport_routes?.name ? ` (${e.transport_routes.name})` : "";
      return e.kind === "boarded"
        ? `${c.firstName} boarded the bus${route} at ${time(e.at, c.timezone)}${e.stop_name ? `, ${e.stop_name}` : ""}.`
        : `${c.firstName} got off the bus${route} at ${time(e.at, c.timezone)}${e.stop_name ? `, ${e.stop_name}` : ""}.`;
    }
  };
}
