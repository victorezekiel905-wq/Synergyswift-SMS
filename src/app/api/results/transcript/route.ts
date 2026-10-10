import { NextRequest, NextResponse } from "next/server";
import { requireCtx, ROLES, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { studentName } from "@/lib/school";

/**
 * Academic transcript: every end-of-term result for one student, grouped by
 * session, with per-subject term totals and session averages. Staff see all
 * compiled terms; with ?published=1 (and always for the student and their
 * parents) only published report cards are used.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(undefined, "results");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url);
  const studentId = u.searchParams.get("student_id");
  if (!studentId) return jsonError("student_id is required");
  const tid = ctx.tenant.id;
  const staff = hasAny(ctx, ROLES.staff);
  // RLS decides who may read this student (staff, the student, their guardians).
  const { data: student } = await ctx.sb.from("students").select("id,first_name,last_name,other_names,admission_no,date_of_birth,gender,photo_url,class_groups(name)")
    .eq("tenant_id", tid).eq("id", studentId).maybeSingle();
  if (!student) return jsonError("student not found", 404);
  const publishedOnly = !staff || u.searchParams.get("published") === "1";

  const svc = createServiceClient();
  let q = svc.from("report_cards").select("term_id,status,total,average,position,class_size,data,terms(name,position,starts_on,session_id,academic_sessions(name,starts_on))")
    .eq("tenant_id", tid).eq("student_id", studentId).eq("kind", "term");
  if (publishedOnly) q = q.eq("status", "published");
  const [{ data: cards }, { data: school }] = await Promise.all([q, svc.from("tenant_settings").select("*").eq("tenant_id", tid).maybeSingle()]);

  type Row = { subject: string; totals: Record<string, { total: number | null; grade: string | null }> };
  type Session = { id: string; name: string; starts_on: string | null; terms: { id: string; name: string; position: number }[]; rows: Map<string, Row>; averages: Record<string, number | null> };
  const sessions = new Map<string, Session>();
  for (const c of cards ?? []) {
    const t: any = c.terms;
    if (!t) continue;
    const sid: string = t.session_id;
    const s: Session = sessions.get(sid) ?? { id: sid, name: t.academic_sessions?.name ?? "", starts_on: t.academic_sessions?.starts_on ?? t.starts_on, terms: [], rows: new Map(), averages: {} };
    s.terms.push({ id: c.term_id, name: t.name, position: t.position });
    s.averages[c.term_id] = c.average === null ? null : Number(c.average);
    for (const sub of c.data?.subjects ?? []) {
      if (sub.total === null || sub.total === undefined) continue;
      const row: Row = s.rows.get(sub.subject_id) ?? { subject: sub.subject, totals: {} };
      row.totals[c.term_id] = { total: Number(sub.total), grade: sub.grade ?? null };
      s.rows.set(sub.subject_id, row);
    }
    sessions.set(sid, s);
  }
  const out = [...sessions.values()].sort((a, b) => String(a.starts_on ?? a.name).localeCompare(String(b.starts_on ?? b.name))).map(s => {
    s.terms.sort((a, b) => a.position - b.position);
    const subjects = [...s.rows.values()].sort((a, b) => a.subject.localeCompare(b.subject)).map(r => {
      const vals = Object.values(r.totals).map(v => v.total).filter((v): v is number => v !== null);
      return { ...r, session_average: vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null };
    });
    const avgs = Object.values(s.averages).filter((v): v is number => v !== null);
    return { id: s.id, name: s.name, terms: s.terms, subjects, term_averages: s.averages,
      session_average: avgs.length ? Math.round((avgs.reduce((a, b) => a + b, 0) / avgs.length) * 10) / 10 : null };
  });
  const all = out.map(s => s.session_average).filter((v): v is number => v !== null);
  return NextResponse.json({
    student: { name: studentName(student), admission_no: student.admission_no, date_of_birth: student.date_of_birth, gender: student.gender,
      photo_url: student.photo_url, class_name: (student as any).class_groups?.name ?? null },
    school, sessions: out, overall_average: all.length ? Math.round((all.reduce((a, b) => a + b, 0) / all.length) * 10) / 10 : null,
    published_only: publishedOnly, generated_at: new Date().toISOString()
  });
}
