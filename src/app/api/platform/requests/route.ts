import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { refreshTenantModules } from "@/lib/saas-server";
import { moduleLabel } from "@/lib/saas";
import { sendEmail } from "@/lib/messaging/providers";

/** Schools' requests to add or remove modules. */
export async function GET() {
  const gate = await requirePlatformAdmin();
  if (gate instanceof NextResponse) return gate;
  const svc = createServiceClient();
  const { data } = await svc.from("module_requests").select("*,tenants(name,slug),users:requested_by(full_name,email)").order("created_at", { ascending: false }).limit(300);
  return NextResponse.json(data ?? []);
}

const Patch = z.object({
  id: z.string().uuid(),
  status: z.enum(["done", "declined"]),
  reply: z.string().trim().max(500).nullish(),
  apply: z.boolean().default(true),           // done + apply: switch the module on/off for the school now
  expires_at: z.string().datetime({ offset: true }).nullish()
});

/** Answer a request. Accepting can switch the module straight away (as a platform override). */
export async function PATCH(req: NextRequest) {
  const gate = await requirePlatformAdmin("admin");
  if (gate instanceof NextResponse) return gate;
  const parsed = Patch.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => i.message).join("; "));
  const b = parsed.data;
  const svc = createServiceClient();
  const { data: r } = await svc.from("module_requests").select("*").eq("id", b.id).maybeSingle();
  if (!r) return jsonError("not found", 404);
  if (r.status !== "pending") return jsonError("this request was already answered");
  if (b.status === "done" && b.apply) {
    await svc.from("tenant_module_overrides").upsert({ tenant_id: r.tenant_id, module: r.module, mode: r.action === "add" ? "on" : "off", expires_at: b.expires_at ?? null,
      note: `school request${b.reply ? `: ${b.reply}` : ""}`.slice(0, 300), set_by: gate.userId, set_at: new Date().toISOString() });
    await refreshTenantModules(svc, r.tenant_id);
  }
  await svc.from("module_requests").update({ status: b.status, reply: b.reply ?? null, handled_by: gate.userId, handled_at: new Date().toISOString() }).eq("id", b.id);
  await svc.from("platform_audit_logs").insert({ actor_id: gate.userId, action: `module_request.${b.status}`, tenant_id: r.tenant_id, meta: { module: r.module, action: r.action, applied: b.status === "done" && b.apply } });
  if (r.requested_by) {
    const { data: u } = await svc.from("users").select("email,full_name").eq("id", r.requested_by).maybeSingle();
    if (u?.email) await sendEmail({ to: u.email, toName: u.full_name, fromName: "Synergy Swift",
      subject: `${moduleLabel(r.module)}: request ${b.status === "done" ? "done" : "declined"}`,
      text: `Your request to ${r.action === "add" ? "add" : "remove"} ${moduleLabel(r.module)} has been ${b.status === "done" ? "completed" : "declined"}.${b.reply ? `\n\n${b.reply}` : ""}` }).catch(() => null);
  }
  return NextResponse.json({ ok: true });
}
