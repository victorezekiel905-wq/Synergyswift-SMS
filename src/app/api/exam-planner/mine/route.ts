import { NextResponse } from "next/server";
import { requireCtx, jsonError } from "@/lib/auth";

/**
 * Published exam timetables for the signed-in person: a student's papers with
 * hall and seat, or a staff member's invigilation duties.
 */
export async function GET() {
  const ctx = await requireCtx(undefined, "exams");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const { data: series } = await ctx.sb.from("exam_series").select("id,name,starts_on,ends_on,sessions,status").eq("tenant_id", tid)
    .eq("status", "published").gte("ends_on", new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10)).order("starts_on");
  const ids = (series ?? []).map((s: any) => s.id);
  if (!ids.length) return NextResponse.json({ series: [], papers: [], duties: [] });

  if (ctx.roles.has("student")) {
    const { data: me } = await ctx.sb.from("students").select("id,class_group_id").eq("tenant_id", tid).eq("user_id", ctx.userId).maybeSingle();
    if (!me) return jsonError("your login is not linked to a student record", 404);
    const [{ data: papers }, { data: seats }] = await Promise.all([
      ctx.sb.from("exam_papers").select("id,series_id,title,duration_minutes,slot_date,slot_session,exam_id").in("series_id", ids).contains("class_group_ids", [me.class_group_id]).order("slot_date").order("slot_session"),
      ctx.sb.from("exam_seats").select("paper_id,label,exam_halls(name)").eq("student_id", me.id).in("series_id", ids)
    ]);
    const seatBy = new Map((seats ?? []).map((s: any) => [s.paper_id, { seat: s.label, hall: s.exam_halls?.name ?? null }]));
    return NextResponse.json({ series, papers: (papers ?? []).map((p: any) => ({ ...p, ...(seatBy.get(p.id) ?? { seat: null, hall: null }) })), duties: [] });
  }

  if (ctx.roles.has("parent")) {
    // RLS limits these reads to the parent's own children.
    const { data: kids } = await ctx.sb.from("students").select("id,first_name,class_group_id").eq("tenant_id", tid);
    const out: any[] = [];
    for (const k of kids ?? []) {
      if (!k.class_group_id) continue;
      const [{ data: papers }, { data: seats }] = await Promise.all([
        ctx.sb.from("exam_papers").select("id,series_id,title,duration_minutes,slot_date,slot_session").in("series_id", ids).contains("class_group_ids", [k.class_group_id]).order("slot_date").order("slot_session"),
        ctx.sb.from("exam_seats").select("paper_id,label,exam_halls(name)").eq("student_id", k.id).in("series_id", ids)
      ]);
      const seatBy = new Map((seats ?? []).map((s: any) => [s.paper_id, { seat: s.label, hall: s.exam_halls?.name ?? null }]));
      for (const p of papers ?? []) out.push({ ...p, id: `${k.id}-${p.id}`, title: `${k.first_name}: ${p.title}`, ...(seatBy.get(p.id) ?? { seat: null, hall: null }) });
    }
    out.sort((a, b) => `${a.slot_date}${a.slot_session}`.localeCompare(`${b.slot_date}${b.slot_session}`));
    return NextResponse.json({ series, papers: out, duties: [] });
  }

  const { data: duties } = await ctx.sb.from("exam_invigilations").select("series_id,slot_date,slot_session,chief,hall_id,exam_halls(name)")
    .eq("staff_user_id", ctx.userId).in("series_id", ids).order("slot_date").order("slot_session");
  return NextResponse.json({ series, papers: [], duties: (duties ?? []).map((d: any) => ({ ...d, hall: d.exam_halls?.name ?? null, exam_halls: undefined })) });
}
