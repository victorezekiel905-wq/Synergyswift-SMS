import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { requirePlatformAdmin } from "@/lib/auth";
import { officeCheck } from "@/live/lib/lesson-import";
import { checkServiceKey } from "@/live/lib/supabase/service";
import { providerChain, generateJson, aiErrorMessage } from "@/lib/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Server check for the platform team (from SwiftCipher's super-admin page): does the
 * Supabase service key work, which AI services are set up, and can this server turn
 * PowerPoint into picture slides? ?run=1 also converts a tiny deck with LibreOffice and
 * asks the AI one tiny question, and times both. Keys are never shown.
 */
export async function GET(req: NextRequest) {
  const gate = await requirePlatformAdmin();
  if (gate instanceof NextResponse) return gate;
  const run = new URL(req.url).searchParams.get("run") === "1";
  const providers = providerChain().map(s => (s.kind === "openai" ? s.p.name : s.kind));
  const [key, office, ai] = await Promise.all([
    checkServiceKey(),
    run ? officeCheck() : Promise.resolve(null),
    run && providers.length ? testAi() : Promise.resolve(null)
  ]);
  return NextResponse.json({ key, office, ai: { providers, test: ai } });
}

/** One tiny request through the same path every AI feature uses (first service that answers). Not counted against any school. */
async function testAi() {
  const t0 = Date.now();
  try {
    const r = await generateJson({ task: "server_check", tenantId: null, userId: null, system: "Reply with JSON only.", prompt: 'Reply with {"ok": true}.',
      schema: z.object({ ok: z.boolean() }), maxTokens: 50, timeoutMs: 30_000 });
    return { ok: r.ok === true, seconds: Math.round((Date.now() - t0) / 100) / 10, error: null };
  } catch (e) {
    return { ok: false, seconds: Math.round((Date.now() - t0) / 100) / 10, error: aiErrorMessage(e).message };
  }
}
