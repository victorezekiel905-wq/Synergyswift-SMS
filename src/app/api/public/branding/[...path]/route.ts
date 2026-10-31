import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

// Only images uploaded through /api/school/branding: <school>/branding/<kind>-<24 hex>.<ext>.
const PATH = /^[0-9a-f-]{36}\/branding\/(logo|signature|stamp)-[0-9a-f]{24}\.(png|jpg|webp)$/;
const TYPE: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

/**
 * A school's logo, principal's signature or stamp, for report cards, emails and payment
 * pages (no sign-in needed; the names are long and random).
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ path: string[] }> }) {
  const path = (await props.params).path.join("/");
  if (!PATH.test(path)) return new NextResponse("Not found", { status: 404 });
  const { data, error } = await createServiceClient().storage.from("school-assets").download(path);
  if (error || !data) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(await data.arrayBuffer(), { headers: {
    "Content-Type": TYPE[path.split(".").pop()!], "Cache-Control": "public, max-age=86400, immutable",
    "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'"
  } });
}
