import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buildSebConfig } from "@/lib/exams/seb";
import { appUrl } from "@/lib/school";

export const dynamic = "force-dynamic";

/**
 * Public: Safe Exam Browser downloads this .seb file (no cookies), so it only
 * contains the start URL and lockdown options, never questions or keys.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return new NextResponse("not found", { status: 404 });
  const svc = createServiceClient();
  const { data: exam } = await svc.from("exams").select("id,title,status,settings,tenants(status)").eq("id", params.id).maybeSingle();
  if (!exam || exam.status === "draft" || exam.tenants?.status !== "active") return new NextResponse("not found", { status: 404 });
  const base = appUrl(req);
  const xml = buildSebConfig({
    startUrl: `${base}/exam/${exam.id}`,
    quitUrl: `${base}/exam/${exam.id}/done`,
    title: exam.title,
    quit_password: exam.settings?.quit_password,
    allow_spellcheck: exam.settings?.allow_spellcheck,
    allow_downloads_uploads: true
  });
  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/seb",
      "Content-Disposition": `attachment; filename="exam-${exam.id.slice(0, 8)}.seb"`,
      "Cache-Control": "no-store"
    }
  });
}
