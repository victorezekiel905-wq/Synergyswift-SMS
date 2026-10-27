import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchAll } from "@/lib/results";
import { perfReport, DEFAULT_BUDGETS, type Budgets, type Sample } from "@/lib/perf";

export const dynamic = "force-dynamic";

/** Performance budgets (phase 14l): the last 7 days of page speed and slow database calls against the budgets. */
export async function GET() {
  const pa = await requirePlatformAdmin("support");
  if (pa instanceof NextResponse) return pa;
  const svc = createServiceClient();
  const { data: b } = await svc.from("platform_settings").select("value").eq("key", "perf.budgets").maybeSingle();
  const budgets: Budgets = { ...DEFAULT_BUDGETS, ...((b?.value as Partial<Budgets>) ?? {}) };
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const samples = await fetchAll<Sample>(() => svc.from("perf_samples").select("id,kind,name,path,value").gte("at", since).order("id")).catch(() => [] as Sample[]);
  return NextResponse.json({ budgets, ...perfReport(samples.slice(-100000), budgets), total: samples.length });
}

const Body = z.object({ LCP: z.number().min(500).max(10000), INP: z.number().min(50).max(2000), CLS: z.number().min(0.01).max(1), FCP: z.number().min(300).max(10000),
  TTFB: z.number().min(100).max(5000), slow_call: z.number().min(100).max(10000) });

export async function POST(req: NextRequest) {
  const pa = await requirePlatformAdmin("admin");
  if (pa instanceof NextResponse) return pa;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("check the numbers");
  const svc = createServiceClient();
  await svc.from("platform_settings").upsert({ key: "perf.budgets", value: parsed.data, updated_at: new Date().toISOString() });
  await svc.from("platform_audit_logs").insert({ actor_id: pa.userId, action: "perf.budgets_saved", meta: parsed.data });
  return NextResponse.json({ ok: true });
}
