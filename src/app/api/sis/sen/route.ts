import { NextResponse } from "next/server";
import { requireCtx, ROLES } from "@/lib/auth";
import { studentName } from "@/lib/school";
import { iepReviewState, targetProgress, SEN_AREAS, SEN_STATUS } from "@/lib/sis";

export const dynamic = "force-dynamic";

/** The SEN register: every child with a profile, their plan and when it is next reviewed. Shows what row-level security allows. */
export async function GET() {
  const ctx = await requireCtx(ROLES.staff, "sims");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const [{ data: profiles, error }, { data: ieps }] = await Promise.all([
    ctx.sb.from("sen_profiles").select("student_id,status,areas,needs,extra_time_pct,arrangements,updated_at,coordinator:coordinator_id(full_name),students(first_name,last_name,other_names,admission_no,status,class_groups(name))")
      .eq("tenant_id", tid).neq("status", "closed").limit(5000),
    ctx.sb.from("ieps").select("*,iep_targets(progress)").eq("tenant_id", tid).eq("status", "active").limit(5000)
  ]);
  // Phase 14h: family engagement (unread notes from families and children; empty before migration 6700).
  const { data: unreadNotes } = await ctx.sb.from("sen_home_notes").select("student_id,kind,created_at").eq("tenant_id", tid).neq("author_kind", "staff").is("read_by_staff_at", null).limit(5000);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  type Row = { student_id: string; name: string; admission_no: string; class_name: string | null; status: string; areas: string[]; needs: string[]; extra_time_pct: number; arrangements: string[]; coordinator: string | null;
    plan: { id: string; title: string; review_on: string | null; review: string; total: number; achieved: number; on_track: number; pct: number | null; agreed: boolean } | null;
    family: { unread: number; meeting_requested: boolean } };
  const items: Row[] = (profiles ?? []).filter((p: any) => p.students?.status === "active").map((p: any): Row => {
    const plan = (ieps ?? []).find((i: any) => i.student_id === p.student_id);
    return {
      student_id: p.student_id, name: studentName(p.students), admission_no: p.students.admission_no, class_name: p.students.class_groups?.name ?? null,
      status: p.status, areas: p.areas, needs: p.needs, extra_time_pct: p.extra_time_pct, arrangements: p.arrangements, coordinator: p.coordinator?.full_name ?? null,
      plan: plan ? { id: plan.id, title: plan.title, review_on: plan.review_on, review: iepReviewState(plan.review_on, plan.status), ...targetProgress(plan.iep_targets ?? []), agreed: Boolean(plan.parent_agreed_at) } : null,
      family: { unread: (unreadNotes ?? []).filter((n: any) => n.student_id === p.student_id).length,
        meeting_requested: (unreadNotes ?? []).some((n: any) => n.student_id === p.student_id && n.kind === "meeting_request") }
    };
  }).sort((a: Row, b: Row) => (a.class_name ?? "").localeCompare(b.class_name ?? "") || a.name.localeCompare(b.name));
  const count = (k: string) => items.filter(i => i.status === k).length;
  return NextResponse.json({
    items,
    summary: { total: items.length, monitoring: count("monitoring"), sen_support: count("sen_support"), ehcp: count("ehcp"),
      with_plan: items.filter(i => i.plan).length, reviews_due: items.filter(i => i.plan && ["due_soon", "overdue"].includes(i.plan.review)).length,
      by_area: Object.keys(SEN_AREAS).map(k => ({ key: k, label: SEN_AREAS[k], count: items.filter(i => i.areas.includes(k)).length })) },
    status_label: SEN_STATUS
  });
}
