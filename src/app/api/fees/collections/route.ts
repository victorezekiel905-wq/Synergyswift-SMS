import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { notifyContact, money } from "@/lib/notify";
import { admissionNote } from "@/lib/messaging/notices";
import { loadCollections } from "@/lib/collections-server";

export const dynamic = "force-dynamic";

/**
 * Fee collections (phase 14g-2): every family that owes, with promises to pay, the last contact,
 * escalation and the next step; record a contact or a promise, send a reminder, set the level.
 */
export async function GET() {
  const ctx = await requireCtx(ROLES.finance, "fees");
  if (ctx instanceof NextResponse) return ctx;
  try {
    const [data, { data: s }] = await Promise.all([loadCollections(createServiceClient(), ctx.tenant.id), ctx.sb.from("tenant_settings").select("currency").eq("tenant_id", ctx.tenant.id).maybeSingle()]);
    return NextResponse.json({ ...data, currency: s?.currency ?? "NGN" });
  } catch (e) { return jsonError((e as Error).message); }
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("promise"), guardian_id: z.string().uuid(), amount: z.number().positive().max(1e10), promised_by: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    student_ids: z.array(z.string().uuid()).max(20).default([]), note: z.string().trim().max(1000).nullish() }),
  z.object({ action: z.literal("cancel_promise"), id: z.string().uuid() }),
  z.object({ action: z.literal("contact"), guardian_id: z.string().uuid(), kind: z.enum(["call", "whatsapp", "sms", "email", "meeting", "visit", "note"]), body: z.string().trim().min(1).max(4000),
    follow_up_at: z.string().datetime({ offset: true }).nullish() }),
  z.object({ action: z.literal("level"), guardian_id: z.string().uuid(), level: z.number().int().min(0).max(4), owner_id: z.string().uuid().nullish(),
    next_action_at: z.string().datetime({ offset: true }).nullish(), note: z.string().trim().max(1000).nullish() }),
  z.object({ action: z.literal("remind"), guardian_id: z.string().uuid() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.finance, "fees");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const guardian = async (id: string) => (await ctx.sb.from("guardians").select("id,full_name,phone,email,whatsapp_phone").eq("tenant_id", tid).eq("id", id).maybeSingle()).data as any;
  const now = new Date().toISOString();
  switch (b.action) {
    case "promise": {
      if (!(await guardian(b.guardian_id))) return jsonError("family not found", 404);
      if (b.promised_by < now.slice(0, 10)) return jsonError("The promised date can't be in the past.");
      await ctx.sb.from("fee_promises").update({ status: "cancelled", settled_at: now }).eq("tenant_id", tid).eq("guardian_id", b.guardian_id).eq("status", "open");
      const { error } = await ctx.sb.from("fee_promises").insert({ tenant_id: tid, guardian_id: b.guardian_id, amount: b.amount, promised_by: b.promised_by, student_ids: b.student_ids, note: b.note ?? null, created_by: ctx.userId });
      if (error) return jsonError(error.message);
      const { data: s } = await ctx.sb.from("tenant_settings").select("currency").eq("tenant_id", tid).maybeSingle();
      await ctx.sb.from("crm_interactions").insert({ tenant_id: tid, guardian_id: b.guardian_id, kind: "note", actor_id: ctx.userId, occurred_at: now,
        body: `Promised to pay ${money(b.amount, s?.currency ?? "NGN")} by ${b.promised_by}.${b.note ? ` ${b.note}` : ""}` });
      return NextResponse.json({ ok: true });
    }
    case "cancel_promise": {
      const { error } = await ctx.sb.from("fee_promises").update({ status: "cancelled", settled_at: now }).eq("tenant_id", tid).eq("id", b.id).eq("status", "open");
      return error ? jsonError(error.message) : NextResponse.json({ ok: true });
    }
    case "contact": {
      if (!(await guardian(b.guardian_id))) return jsonError("family not found", 404);
      const { error } = await ctx.sb.from("crm_interactions").insert({ tenant_id: tid, guardian_id: b.guardian_id, kind: b.kind === "note" ? "note" : b.kind, body: b.body,
        follow_up_at: b.follow_up_at ?? null, actor_id: ctx.userId, occurred_at: now });
      return error ? jsonError(error.message) : NextResponse.json({ ok: true });
    }
    case "level": {
      const { error } = await ctx.sb.from("fee_collection_cases").upsert({ tenant_id: tid, guardian_id: b.guardian_id, level: b.level, owner_id: b.owner_id ?? null,
        next_action_at: b.next_action_at ?? null, note: b.note ?? null, updated_at: now }, { onConflict: "tenant_id,guardian_id" });
      return error ? jsonError(error.message) : NextResponse.json({ ok: true });
    }
    case "remind": {
      const g = await guardian(b.guardian_id);
      if (!g) return jsonError("family not found", 404);
      const svc = createServiceClient();
      const all = await loadCollections(svc, tid);
      const f = all.families.find(x => x.guardian_id === b.guardian_id);
      if (!f) return jsonError("This family owes nothing.");
      const { data: s } = await ctx.sb.from("tenant_settings").select("currency").eq("tenant_id", tid).maybeSingle();
      const cur = s?.currency ?? "NGN";
      const sent = await notifyContact(svc, { tenantId: tid, name: g.full_name, email: g.email, phone: g.whatsapp_phone ?? g.phone, kind: "fees", refId: g.id,
        build: br => admissionNote(br, { name: g.full_name, subject: "School fees reminder",
          lines: [`The school fees balance for ${f.children.map(c => c.name.split(" ")[0]).join(" and ")} is ${money(f.balance, cur)}${f.oldest_due ? `, due since ${new Date(`${f.oldest_due}T12:00:00Z`).toLocaleDateString("en-GB", { dateStyle: "long" })}` : ""}.`,
            "You can pay online with the link below, or speak to the bursar if you would like to agree a payment date."],
          link: f.pay_token ? `${appUrl(req)}/pay/${f.pay_token}` : null, linkLabel: "Pay now" }) });
      await ctx.sb.from("crm_interactions").insert({ tenant_id: tid, guardian_id: g.id, kind: "whatsapp", actor_id: ctx.userId, occurred_at: now, body: `Fees reminder sent (${money(f.balance, cur)}).` });
      const { data: c } = await ctx.sb.from("fee_collection_cases").select("level").eq("tenant_id", tid).eq("guardian_id", g.id).maybeSingle();
      if (!c || c.level < 1) await ctx.sb.from("fee_collection_cases").upsert({ tenant_id: tid, guardian_id: g.id, level: 1, updated_at: now }, { onConflict: "tenant_id,guardian_id" });
      return NextResponse.json({ ok: true, messages_queued: sent });
    }
  }
}
