import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/auth";
import { officeCheck } from "@/live/lib/lesson-import";
import { checkServiceKey } from "@/live/lib/supabase/service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Server check for the platform team (from SwiftCipher's super-admin page): does the
 * Supabase service key work, and can this server turn PowerPoint into picture slides?
 * ?run=1 converts a tiny deck with LibreOffice and times it. Keys are never shown.
 */
export async function GET(req: NextRequest) {
  const gate = await requirePlatformAdmin();
  if (gate instanceof NextResponse) return gate;
  const run = new URL(req.url).searchParams.get("run") === "1";
  const [key, office] = await Promise.all([checkServiceKey(), run ? officeCheck() : Promise.resolve(null)]);
  return NextResponse.json({ key, office });
}
