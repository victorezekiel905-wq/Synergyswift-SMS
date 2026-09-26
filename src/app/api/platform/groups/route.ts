import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";

/** Platform: school groups (a proprietor with several branches). */
export async function GET() {
  const gate = await requirePlatformAdmin();
  if (gate instanceof NextResponse) return gate;
  const svc = createServiceClient();
  const [{ data: groups }, { data: admins }, { data: tenants }] = await Promise.all([
    svc.from("tenant_groups").select("*").order("name"),
    svc.from("group_admins").select("group_id,user_id"),
    svc.from("tenants").select("id,name,group_id").order("name")
  ]);
  const emails = new Map<string, string>();
  for (const a of admins ?? []) {
    const { data } = await svc.auth.admin.getUserById(a.user_id);
    if (data?.user?.email) emails.set(a.user_id, data.user.email);
  }
  return NextResponse.json({
    groups: (groups ?? []).map((g: any) => ({ ...g, admins: (admins ?? []).filter((a: any) => a.group_id === g.id).map((a: any) => ({ user_id: a.user_id, email: emails.get(a.user_id) ?? a.user_id })),
      schools: (tenants ?? []).filter((t: any) => t.group_id === g.id) })),
    tenants: tenants ?? []
  });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), name: z.string().trim().min(2).max(120) }),
  z.object({ action: z.literal("assign"), tenant_id: z.string().uuid(), group_id: z.string().uuid().nullable() }),
  z.object({ action: z.literal("add_admin"), group_id: z.string().uuid(), email: z.string().trim().email() }),
  z.object({ action: z.literal("remove_admin"), group_id: z.string().uuid(), user_id: z.string().uuid() })
]);

export async function POST(req: NextRequest) {
  const gate = await requirePlatformAdmin();
  if (gate instanceof NextResponse) return gate;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => i.message).join("; "));
  const b = parsed.data;
  const svc = createServiceClient();
  const audit = (action: string, meta: Record<string, unknown>) => svc.from("platform_audit_logs").insert({ actor_id: gate.userId, action, meta });
  if (b.action === "create") {
    const { data, error } = await svc.from("tenant_groups").insert({ name: b.name }).select("id").single();
    if (error) return jsonError(error.message);
    await audit("group.created", { name: b.name });
    return NextResponse.json(data, { status: 201 });
  }
  if (b.action === "assign") {
    const { error } = await svc.from("tenants").update({ group_id: b.group_id }).eq("id", b.tenant_id);
    if (error) return jsonError(error.message);
    await audit("group.assigned", { tenant_id: b.tenant_id, group_id: b.group_id });
    return NextResponse.json({ ok: true });
  }
  if (b.action === "remove_admin") {
    await svc.from("group_admins").delete().eq("group_id", b.group_id).eq("user_id", b.user_id);
    return NextResponse.json({ ok: true });
  }
  // add_admin: the proprietor gets a sign-in link; they need no school profile.
  const email = b.email.toLowerCase();
  let link = await svc.auth.admin.generateLink({ type: "invite", email, options: { redirectTo: `${appUrl(req)}/auth/welcome?next=/group` } });
  if (link.error) link = await svc.auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo: `${appUrl(req)}/auth/welcome?next=/group` } });
  if (link.error || !link.data?.user?.id) return jsonError(link.error?.message ?? "could not create the login");
  await svc.from("group_admins").upsert({ group_id: b.group_id, user_id: link.data.user.id });
  await audit("group.admin_added", { group_id: b.group_id, email });
  return NextResponse.json({ ok: true, action_link: link.data.properties?.action_link ?? null });
}
