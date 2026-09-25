import { NextResponse } from "next/server";
import { requireCtx, jsonError } from "@/lib/auth";

/** The signed-in student's published report cards (RLS hides drafts). */
export async function GET() {
  const ctx = await requireCtx(["student"], "results");
  if (ctx instanceof NextResponse) return ctx;
  const { data: me } = await ctx.sb.from("students").select("id").eq("tenant_id", ctx.tenant.id).eq("user_id", ctx.userId).maybeSingle();
  if (!me) return jsonError("your login is not linked to a student record", 404);
  const { data, error } = await ctx.sb.from("report_cards").select("id,average,position,class_size,published_at,access_token,data")
    .eq("tenant_id", ctx.tenant.id).eq("student_id", me.id).eq("status", "published").order("published_at", { ascending: false });
  if (error) return jsonError(error.message);
  return NextResponse.json((data ?? []).map((r: any) => ({
    id: r.id, term: r.data?.term_label, class_name: r.data?.class_name, average: r.average,
    position: r.data?.scheme?.show_position ? r.position : null, class_size: r.class_size,
    published_at: r.published_at, access_token: r.access_token
  })));
}
