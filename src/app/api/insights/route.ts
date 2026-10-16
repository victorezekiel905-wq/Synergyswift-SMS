import { NextRequest, NextResponse } from "next/server";
import { requireCtx, ROLES, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { summariseBy, crossTab, valueAdded, BY, type ByKey } from "@/lib/insights";
import { termsInOrder, resultRows, studentHistory, valueAddedPairs, financeInsights, admissionsInsights, type Scope } from "@/lib/insights-server";

export const dynamic = "force-dynamic";

const LEADERS = [...ROLES.admin, "qa_officer"];
const ADMISSIONS = [...ROLES.admin, "admissions_officer"];

/**
 * Analytics. ?view=
 *   academic       results by class, subject, teacher, year group, gender or student (?by=) for a term; teachers see their own classes and subjects
 *   student        one student's results across terms (?student_id=)
 *   value_added    progress against prediction by teacher or class (leaders only)
 *   finance        fees billed and collected over the year (bursary and leaders)
 *   admissions     applications over the year (admissions and leaders)
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "analytics");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url).searchParams;
  const view = u.get("view") ?? "academic";
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  const leader = hasAny(ctx, LEADERS);
  const access = {
    academic: leader || ctx.roles.has("teacher"), value_added: leader,
    finance: hasAny(ctx, ROLES.finance), admissions: hasAny(ctx, ADMISSIONS), census: hasAny(ctx, ROLES.admin)
  };

  if (view === "access") return NextResponse.json({ access });
  if (view === "finance") {
    if (!access.finance) return jsonError("forbidden", 403);
    const terms = await termsInOrder(svc, tid);
    const current = terms.find(t => t.is_current) ?? terms[terms.length - 1] ?? null;
    return NextResponse.json({ access, term: current ? `${current.name} ${current.session}`.trim() : null, ...(await financeInsights(svc, tid, ctx.tenant.timezone, current?.id ?? null)) });
  }
  if (view === "admissions") {
    if (!access.admissions) return jsonError("forbidden", 403);
    return NextResponse.json({ access, ...(await admissionsInsights(svc, tid, ctx.tenant.timezone)) });
  }
  if (!access.academic) return NextResponse.json({ access });

  // Teachers see the classes and subjects they teach, and their form class.
  let scope: Scope = null;
  if (!leader) {
    const { data: form } = await svc.from("class_groups").select("id").eq("tenant_id", tid).eq("form_teacher_id", ctx.userId);
    scope = { teacherId: ctx.userId, formClassIds: (form ?? []).map((c: any) => c.id) };
  }

  const terms = await termsInOrder(svc, tid);
  const termId = u.get("term_id") && terms.some(t => t.id === u.get("term_id")) ? u.get("term_id")! : (terms.find(t => t.is_current) ?? terms[terms.length - 1])?.id;
  const termList = terms.map(t => ({ id: t.id, label: `${t.name} ${t.session}`.trim() })).reverse();

  if (view === "student") {
    const sid = u.get("student_id");
    if (!sid) return jsonError("student_id is required");
    if (scope && termId) {
      const mine = await resultRows(svc, tid, termId, scope);
      if (!mine.some(r => r.student_id === sid)) return jsonError("you can see results only for students you teach", 403);
    }
    const { data: s } = await svc.from("students").select("id,first_name,last_name,other_names,admission_no,class_groups(name)").eq("tenant_id", tid).eq("id", sid).maybeSingle();
    if (!s) return jsonError("not found", 404);
    return NextResponse.json({ access, student: { id: s.id, name: `${s.first_name} ${s.last_name}`, admission_no: s.admission_no, class_name: (s as any).class_groups?.name ?? null }, history: await studentHistory(svc, tid, sid) });
  }
  if (!termId) return NextResponse.json({ access, terms: [], term_id: null });

  const { data: scheme } = await svc.from("grading_schemes").select("pass_mark").eq("tenant_id", tid).eq("is_default", true).maybeSingle();
  const passMark = Number(scheme?.pass_mark ?? 40);

  if (view === "value_added") {
    if (!access.value_added) return jsonError("forbidden", 403);
    const by = u.get("by") === "class" ? "class" : "teacher";
    const { previous, pairs } = await valueAddedPairs(svc, tid, termId, by);
    const { groups, fits } = valueAdded(pairs);
    const subjects = new Map(pairs.map(p => [p.subject_id, p.subject]));
    return NextResponse.json({ access, terms: termList, term_id: termId, previous, by, groups, pairs: pairs.length,
      subjects: Object.entries(fits).map(([id, f]) => ({ subject: subjects.get(id) ?? "", n: f.n, slope: Math.round(f.slope * 100) / 100, r2: Math.round(f.r2 * 100) / 100 })) });
  }

  const by = (u.get("by") ?? "class") as ByKey;
  if (!(by in BY)) return jsonError("unknown grouping");
  let rows = await resultRows(svc, tid, termId, scope);
  const cg = u.get("class_group_id");
  const classes = [...new Map(rows.filter(r => r.class_group_id).map(r => [r.class_group_id!, r.class_name])).entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (cg) rows = rows.filter(r => r.class_group_id === cg);
  return NextResponse.json({
    access, terms: termList, term_id: termId, by, scope: scope ? "mine" : "school", classes, pass_mark: passMark,
    overall: summariseBy(rows, () => ["all", "All"], passMark)[0] ?? null,
    stats: summariseBy(rows, BY[by], passMark).slice(0, 500),
    cross: crossTab(rows, "subject", cg ? "student" : "class")
  });
}
