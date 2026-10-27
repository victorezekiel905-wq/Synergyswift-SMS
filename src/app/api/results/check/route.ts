import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { clientIp } from "@/lib/net";
import { checkResult } from "@/lib/result-pins-server";

export const dynamic = "force-dynamic";

const Body = z.object({ school: z.string().trim().min(2).max(80), admission_no: z.string().trim().min(1).max(40), pin: z.string().trim().min(8).max(30) });

/** The public result checker (phase 14l): no sign-in, a scratch-card PIN instead. Unknown schools are "not found". */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("Enter the admission number and the PIN from the card.");
  const r = await checkResult(createServiceClient(), { slug: parsed.data.school, admissionNo: parsed.data.admission_no, pin: parsed.data.pin, ip: clientIp(req.headers) ?? "unknown" });
  if (!r.ok) return jsonError(r.error, r.status);
  return NextResponse.json({ url: `/r/${r.token}`, term: r.term, student: r.student });
}

/** GET ?school= : the school's name and logo for the checker page. */
export async function GET(req: NextRequest) {
  const slug = (new URL(req.url).searchParams.get("school") ?? "").toLowerCase().slice(0, 80);
  const svc = createServiceClient();
  const { data: t } = slug ? await svc.from("tenants").select("id,name,status").eq("slug", slug).maybeSingle() : { data: null };
  if (!t || t.status !== "active") return jsonError("not found", 404);
  const { data: s } = await svc.from("tenant_settings").select("*").eq("tenant_id", t.id).maybeSingle();
  return NextResponse.json({ school: { name: s?.school_name ?? t.name, logo_url: s?.logo_url ?? null, brand_color: s?.brand_color ?? null } });
}
