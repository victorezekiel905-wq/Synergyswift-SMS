import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/auth";
import { clientIp } from "@/lib/net";
import { routePattern } from "@/lib/perf";
import { logError } from "@/lib/error-log";

export const dynamic = "force-dynamic";

const Body = z.object({ message: z.string().trim().min(1).max(500), path: z.string().max(500), stack: z.string().max(2000).nullish() });

// Each address may report at most 20 errors a minute (per server), so nobody can flood the log.
const seen = new Map<string, { n: number; at: number }>();

/**
 * A browser reports a crash on its page (components/ErrorReporter.tsx). No sign-in: errors happen on
 * the sign-in page too. Only the page pattern (ids removed), the message and the top of the stack are
 * kept, never who it was.
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers) ?? "unknown";
  const now = Date.now();
  const s = seen.get(ip);
  if (s && now - s.at < 60_000 && s.n >= 20) return new NextResponse(null, { status: 204 });
  seen.set(ip, s && now - s.at < 60_000 ? { n: s.n + 1, at: s.at } : { n: 1, at: now });
  if (seen.size > 5000) for (const [k, v] of seen) if (now - v.at > 60_000) seen.delete(k);

  const parsed = Body.safeParse(await readJson(req));
  if (parsed.success) await logError("browser", parsed.data.message, routePattern(parsed.data.path), parsed.data.stack ?? null);
  return new NextResponse(null, { status: 204 });
}
