import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticate, listResource, apiError } from "@/lib/open-api-server";
import { paging, hasScope } from "@/lib/open-api";
import { syncLeadFromApplication } from "@/lib/admissions-crm";
import { notifyApplicant } from "@/lib/admissions";
import { appUrl } from "@/lib/school";

export const dynamic = "force-dynamic";

/** GET /api/v1/<resource>?limit=&offset=&…filters — see /api/v1 for the full description. */
export async function GET(req: NextRequest, props: { params: Promise<{ resource: string }> }) {
  const c = await authenticate(req.headers);
  if (c instanceof NextResponse) return c;
  const { resource } = await props.params;
  const u = new URL(req.url).searchParams;
  const args = { ...Object.fromEntries(u.entries()), ...paging(u) };
  try {
    const { data, total } = await listResource(c, resource, args);
    return NextResponse.json({ data, paging: { limit: args.limit, offset: args.offset, total } }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return apiError((e as Error).message, (e as { status?: number }).status ?? 400);
  }
}

const Application = z.object({
  first_name: z.string().trim().min(1).max(60), last_name: z.string().trim().min(1).max(60), other_names: z.string().trim().max(80).nullish(),
  gender: z.enum(["male", "female", "other"]).nullish(), date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  applying_for: z.string().trim().min(1).max(60), previous_school: z.string().trim().max(120).nullish(),
  guardian_name: z.string().trim().min(2).max(120), guardian_phone: z.string().trim().min(7).max(30), guardian_email: z.string().trim().email().nullish(),
  guardian_relation: z.string().trim().max(30).default("parent"), address: z.string().trim().max(300).nullish(), notes: z.string().trim().max(1000).nullish(),
  consent: z.literal(true, { errorMap: () => ({ message: "consent must be true: the family agreed to the school's privacy notice" }) })
});

/** POST /api/v1/applications — an application from the school's own website form. */
export async function POST(req: NextRequest, props: { params: Promise<{ resource: string }> }) {
  const c = await authenticate(req.headers);
  if (c instanceof NextResponse) return c;
  const { resource } = await props.params;
  if (resource !== "applications") return apiError("only applications can be created", 405);
  if (!hasScope(c.scopes, "applications:write")) return apiError("this key does not have the applications:write scope", 403);
  const parsed = Application.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "), 422);
  const { consent: _c, ...row } = parsed.data;
  const { count } = await c.svc.from("applications").select("id", { count: "exact", head: true }).eq("tenant_id", c.tenantId)
    .eq("guardian_phone", row.guardian_phone).gte("created_at", new Date(Date.now() - 86400_000).toISOString());
  if ((count ?? 0) >= 5) return apiError("too many applications from this phone number today", 429);
  const { data: no } = await c.svc.rpc("next_doc_no", { p_tenant: c.tenantId, p_kind: "app" });
  const { data: app, error } = await c.svc.from("applications").insert({ ...row, tenant_id: c.tenantId, application_no: no, source: "website", utm: { utm_source: "api" } }).select("*").single();
  if (error) return apiError(error.message, 400);
  await syncLeadFromApplication(c.svc, app).catch(() => null);
  await notifyApplicant(c.svc, app, appUrl(req)).catch(() => null);
  return NextResponse.json({ data: { id: app.id, application_no: app.application_no, status: app.status, tracking_url: `${appUrl(req)}/apply/track/${app.tracking_token}` } }, { status: 201 });
}
