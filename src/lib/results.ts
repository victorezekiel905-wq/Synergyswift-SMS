/**
 * Server-side result compilation for one class group and term: loads data,
 * runs the pure grading engine, and writes report_cards rows.
 */
import { computeClassResults } from "./grading";
import { schemeFor, termLabel, studentName } from "./school";

export async function compileClassResults(sb: any, tenantId: string, termId: string, classGroupId: string, opts: { force?: boolean } = {}) {
  const scheme = await schemeFor(sb, tenantId, classGroupId);
  if (!scheme) throw new Error("no grading scheme configured");

  const [{ data: students }, { data: offerings }, { data: group }, { data: term }] = await Promise.all([
    sb.from("students").select("id,first_name,last_name,other_names,admission_no")
      .eq("tenant_id", tenantId).eq("class_group_id", classGroupId).eq("status", "active"),
    sb.from("subject_offerings").select("subject_id,subjects(id,name)").eq("tenant_id", tenantId).eq("class_group_id", classGroupId),
    sb.from("class_groups").select("id,name,level").eq("tenant_id", tenantId).eq("id", classGroupId).maybeSingle(),
    sb.from("terms").select("id,starts_on,ends_on,next_term_begins").eq("tenant_id", tenantId).eq("id", termId).maybeSingle()
  ]);
  if (!group) throw new Error("class group not found");
  if (!term) throw new Error("term not found");
  const studentIds: string[] = (students ?? []).map((s: { id: string }) => s.id);
  if (!studentIds.length) return { computed: 0, skipped_published: 0 };

  const { data: scores } = await sb.from("score_entries").select("student_id,subject_id,component_id,score")
    .eq("tenant_id", tenantId).eq("term_id", termId).in("student_id", studentIds);

  let subjects = (offerings ?? []).filter((o: any) => o.subjects).map((o: any) => ({ id: o.subjects.id, name: o.subjects.name }));
  if (!subjects.length) {
    // No offerings configured: fall back to subjects that actually have scores.
    const ids = [...new Set((scores ?? []).map((s: any) => s.subject_id))];
    if (ids.length) {
      const { data } = await sb.from("subjects").select("id,name").eq("tenant_id", tenantId).in("id", ids);
      subjects = data ?? [];
    }
  }
  subjects.sort((a: any, b: any) => a.name.localeCompare(b.name));

  const results = computeClassResults({ studentIds, subjects, scores: scores ?? [], scheme });

  // Attendance for the term: distinct days with a sign-in.
  const present = new Map<string, number>();
  if (term.starts_on) {
    const end = term.ends_on ? `${term.ends_on}T23:59:59Z` : new Date().toISOString();
    const { data: ev } = await sb.from("gate_events").select("student_id,at")
      .eq("tenant_id", tenantId).eq("direction", "in").in("student_id", studentIds)
      .gte("at", `${term.starts_on}T00:00:00Z`).lte("at", end).limit(100000);
    const days = new Map<string, Set<string>>();
    for (const e of ev ?? []) {
      if (!days.has(e.student_id)) days.set(e.student_id, new Set());
      days.get(e.student_id)!.add(String(e.at).slice(0, 10));
    }
    days.forEach((v, k) => present.set(k, v.size));
  }
  // The class register is the official record when it has been taken: it wins over gate sign-ins.
  const register = new Map<string, { present: number; absent: number; opened: number }>();
  if (term.starts_on) {
    const { data: att } = await sb.from("class_attendance").select("student_id,status").eq("tenant_id", tenantId).in("student_id", studentIds)
      .gte("date", term.starts_on).lte("date", term.ends_on ?? new Date().toISOString().slice(0, 10)).limit(200000);
    for (const a of att ?? []) {
      const m = register.get(a.student_id) ?? { present: 0, absent: 0, opened: 0 };
      m.opened++;
      if (a.status === "present" || a.status === "late") m.present++; else if (a.status === "absent") m.absent++;
      register.set(a.student_id, m);
    }
  }
  // Character and skills ratings for the report card.
  const { data: traitDefs } = await sb.from("trait_definitions").select("id,domain,name,position").eq("tenant_id", tenantId).order("position");
  const { data: traitRows } = (traitDefs ?? []).length
    ? await sb.from("trait_ratings").select("student_id,trait_id,rating").eq("term_id", termId).in("student_id", studentIds)
    : { data: [] };

  const { data: existing } = await sb.from("report_cards").select("student_id,status").eq("tenant_id", tenantId).eq("term_id", termId).in("student_id", studentIds);
  const published = new Set((existing ?? []).filter((r: any) => r.status === "published").map((r: any) => r.student_id));
  const label = await termLabel(sb, tenantId, termId);
  const byId = new Map((students ?? []).map((s: any) => [s.id, s]));

  const rows = results
    .filter(r => opts.force || !published.has(r.student_id))
    .map(r => ({
      tenant_id: tenantId, term_id: termId, student_id: r.student_id, class_group_id: classGroupId,
      total: r.total, average: r.average, position: r.position, class_size: r.class_size,
      computed_at: new Date().toISOString(),
      data: {
        student_name: studentName(byId.get(r.student_id) as any),
        admission_no: (byId.get(r.student_id) as any)?.admission_no,
        class_name: group.name, term_label: label,
        next_term_begins: term.next_term_begins,
        scheme: { name: scheme.name, pass_mark: scheme.pass_mark, show_position: scheme.show_position,
          show_class_average: scheme.show_class_average, bands: scheme.bands },
        components: scheme.components.map(c => ({ id: c.id, name: c.name, max_score: c.max_score, weight: c.weight })),
        subjects: r.subjects, gpa: r.gpa, subjects_taken: r.subjects_taken, subjects_passed: r.subjects_passed,
        days_present: register.has(r.student_id) ? register.get(r.student_id)!.present : term.starts_on ? present.get(r.student_id) ?? 0 : null,
        days_absent: register.get(r.student_id)?.absent ?? null,
        days_opened: register.get(r.student_id)?.opened ?? null,
        traits: (traitDefs ?? []).map((t: any) => ({ domain: t.domain, name: t.name,
          rating: (traitRows ?? []).find((x: any) => x.student_id === r.student_id && x.trait_id === t.id)?.rating ?? null }))
      }
    }));
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await sb.from("report_cards").upsert(rows.slice(i, i + 200), { onConflict: "term_id,student_id" });
    if (error) throw new Error(error.message);
  }
  return { computed: rows.length, skipped_published: results.length - rows.length };
}
