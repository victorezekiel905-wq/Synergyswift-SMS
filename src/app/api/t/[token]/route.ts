import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { jsonError, readJson } from "@/lib/auth";
import { appUrl } from "@/lib/school";
import { replyToTicket, CrmError } from "@/lib/community-server";
import { STATUS_LABEL, type TicketStatus } from "@/lib/community";

export const dynamic = "force-dynamic";

async function load(token: string) {
  if (!/^[0-9a-f]{32}$/i.test(token)) return null;
  const svc = createServiceClient();
  const { data: t } = await svc.from("tickets").select("id,tenant_id,ticket_no,kind,subject,body,status,created_at,resolved_at,satisfaction,satisfaction_note,guardian_id,guardians(full_name),tenants(name,status)")
    .eq("token", token).maybeSingle();
  if (!t || t.tenants?.status !== "active") return null;
  return { svc, t };
}

/** A family's view of their complaint or request: status and the public conversation (never internal notes). */
export async function GET(_req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const r = await load((await props.params).token);
  if (!r) return jsonError("This link is not valid.", 404);
  const { svc, t } = r;
  const [{ data: messages }, { data: s }] = await Promise.all([
    svc.from("ticket_messages").select("id,author,body,created_at,users:author_id(full_name)").eq("ticket_id", t.id).eq("internal", false).neq("author", "system").order("created_at"),
    svc.from("tenant_settings").select("school_name,logo_url,brand_color,phone").eq("tenant_id", t.tenant_id).maybeSingle()
  ]);
  return NextResponse.json({
    ticket: { ticket_no: t.ticket_no, kind: t.kind, subject: t.subject, body: t.body, status: t.status, status_label: STATUS_LABEL[t.status as TicketStatus], created_at: t.created_at,
      resolved_at: t.resolved_at, satisfaction: t.satisfaction, name: t.guardians?.full_name ?? null },
    messages: (messages ?? []).map((m: any) => ({ id: m.id, author: m.author, body: m.body, created_at: m.created_at, name: m.author === "staff" ? (m.users?.full_name ?? "School") : null })),
    school: { name: s?.school_name ?? t.tenants?.name, logo_url: s?.logo_url ?? null, brand_color: s?.brand_color ?? null, phone: s?.phone ?? null }
  });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reply"), body: z.string().trim().min(1).max(3000) }),
  z.object({ action: z.literal("rate"), satisfaction: z.number().int().min(1).max(5), note: z.string().trim().max(1000).nullish() })
]);

export async function POST(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const r = await load((await props.params).token);
  if (!r) return jsonError("This link is not valid.", 404);
  const { svc, t } = r;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => i.message).join("; "));
  const b = parsed.data;
  if (b.action === "rate") {
    if (!["resolved", "closed"].includes(t.status)) return jsonError("you can rate this once it is resolved");
    const { error } = await svc.from("tickets").update({ satisfaction: b.satisfaction, satisfaction_note: b.note ?? null, status: "closed", closed_at: new Date().toISOString() }).eq("id", t.id);
    if (error) return jsonError(error.message);
    await svc.from("ticket_messages").insert({ tenant_id: t.tenant_id, ticket_id: t.id, author: "system", body: `Family rated the outcome ${b.satisfaction}/5${b.note ? `: ${b.note}` : ""}.`, internal: true });
    return NextResponse.json({ ok: true });
  }
  const { count } = await svc.from("ticket_messages").select("id", { count: "exact", head: true }).eq("ticket_id", t.id).eq("author", "family").gte("created_at", new Date(Date.now() - 3600_000).toISOString());
  if ((count ?? 0) >= 15) return jsonError("too many messages in the last hour; please try again later", 429);
  try {
    return NextResponse.json(await replyToTicket(svc, { tenantId: t.tenant_id, ticketId: t.id, author: "family", authorName: t.guardians?.full_name ?? "Family", body: b.body, baseUrl: appUrl(req) }));
  } catch (e) {
    return e instanceof CrmError ? jsonError(e.message, e.status) : jsonError((e as Error).message);
  }
}
