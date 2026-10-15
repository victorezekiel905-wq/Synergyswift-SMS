import { NextRequest, NextResponse } from "next/server";
import { requireCtx, ROLES } from "@/lib/auth";

/** Comments on one submission (?sub=), for the marking view. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "homework");
  if (ctx instanceof NextResponse) return ctx;
  const sub = new URL(req.url).searchParams.get("sub") ?? "";
  const { data } = await ctx.sb.from("submission_annotations").select("id,kind,start_offset,end_offset,quote,file_index,x,y,comment,author_id")
    .eq("tenant_id", ctx.tenant.id).eq("submission_id", sub).order("created_at");
  return NextResponse.json({ items: data ?? [] });
}
