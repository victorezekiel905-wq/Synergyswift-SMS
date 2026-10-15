import { NextRequest, NextResponse } from "next/server";
import { requireCtx, ROLES, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { lessonWindow } from "@/lib/learning";
import { POINTS } from "@/lib/lms";
import { zoomCreds, zoomStartUrl } from "@/lib/zoom";

export const dynamic = "force-dynamic";

/**
 * Join an online lesson: records that the student joined (the teacher sees
 * it) and sends them to the meeting. The teacher who set up a Zoom lesson is
 * sent to the host link so the meeting starts with them in charge.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(undefined, "lms");
  const back = (msg: string) => NextResponse.redirect(new URL(`/student/learn?notice=${encodeURIComponent(msg)}`, req.url), 303);
  if (ctx instanceof NextResponse) return NextResponse.redirect(new URL("/login", req.url), 303);
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return back("That lesson link is not valid.");
  const { data: l } = await ctx.sb.from("online_lessons").select("id,tenant_id,join_url,starts_at,duration_min,status,created_by,class_group_id,provider,external_id").eq("tenant_id", ctx.tenant.id).eq("id", id).maybeSingle();
  if (!l) return back("That lesson is not for your class.");
  if (l.status === "cancelled") return back("That lesson was cancelled.");
  const svc = createServiceClient();
  if (hasAny(ctx, ROLES.staff)) {
    if (l.created_by === ctx.userId && l.provider === "zoom" && l.external_id) {
      const z = await zoomCreds(svc, ctx.tenant.id);
      const fresh = z ? await zoomStartUrl(z.creds, l.external_id).catch(() => null) : null;
      const { data: host } = fresh ? { data: null } : await svc.from("online_lesson_hosts").select("start_url").eq("lesson_id", l.id).maybeSingle();
      if (fresh || host?.start_url) return NextResponse.redirect(fresh ?? host!.start_url, 303);
    }
    return NextResponse.redirect(l.join_url, 303);
  }
  const w = lessonWindow(l.starts_at, l.duration_min);
  if (w === "upcoming") return back("This lesson opens 15 minutes before it starts.");
  if (w === "ended") return back("This lesson has finished.");
  const { data: st } = await svc.from("students").select("id,class_group_id").eq("tenant_id", ctx.tenant.id).eq("user_id", ctx.userId).maybeSingle();
  if (!st || st.class_group_id !== l.class_group_id) return back("That lesson is not for your class.");
  await svc.from("online_lesson_joins").upsert({ lesson_id: l.id, user_id: ctx.userId, tenant_id: ctx.tenant.id, student_id: st.id }, { onConflict: "lesson_id,user_id", ignoreDuplicates: true });
  await svc.from("learning_activity").upsert({ tenant_id: ctx.tenant.id, student_id: st.id, kind: "lesson", points: POINTS.lesson, ref_id: l.id }, { onConflict: "student_id,kind,ref_id", ignoreDuplicates: true });
  return NextResponse.redirect(l.join_url, 303);
}
