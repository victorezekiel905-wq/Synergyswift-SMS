import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { routePattern } from "@/lib/perf";

export const dynamic = "force-dynamic";
const Body = z.object({ name: z.enum(["LCP", "INP", "CLS", "FCP", "TTFB"]), value: z.number().min(0).max(120_000), rating: z.enum(["good", "needs-improvement", "poor"]).nullish(), path: z.string().max(500) });

/** Page-speed numbers from browsers (phase 14l). No sign-in; only the page pattern and the number are kept. */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new NextResponse(null, { status: 204 });
  const b = parsed.data;
  await createServiceClient().from("perf_samples").insert({ kind: "vital", name: b.name, value: b.value, rating: b.rating ?? null, path: routePattern(b.path) }).then(() => null, () => null);
  return new NextResponse(null, { status: 204 });
}
