/**
 * Server-side result compilation for one class group and term: loads data,
 * runs the pure grading engine, and writes report_cards rows.
 */
import { traitScale } from "./traits";
import { computeClassResults, midtermScheme, projectScore, cumulativeResults, gradeFor } from "./grading";
import { schemeFor, termLabel, studentName } from "./school";
import { signPublishedCards } from "./report-sign";

const PAGE = 1000;

/**
 * Reads every row of a query. Supabase returns at most 1000 rows per request
 * (the API's "max rows" setting, which .limit() cannot raise), so a big class
 * would otherwise lose scores silently. `build` must order by a unique key.
 */
export async function fetchAll<T>(build: () => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

export type CardKind = "term" | "midterm";

export async function compileClassResults(sb: any, tenantId: string, termId: string, classGroupId: string, opts: { force?: boolean; kind?: CardKind } = {}) {
  const kind: CardKind = opts.kind ?? "term";
  const fullScheme = await schemeFor(sb, tenantId, classGroupId);
  if (!fullScheme) throw new Error("no grading scheme configured");
  const scheme = kind === "midterm" ? midtermScheme(fullScheme) : fullScheme;
  if (!scheme) throw new Error("mark which assessments count for mid-term reports under School setup → Grading first");

  const [{ data: students }, { data: offerings }, { data: group }, { data: term }] = await Promise.all([
    sb.from("students").select("id,first_name,last_name,other_names,admission_no")
      .eq("tenant_id", tenantId).eq("class_group_id", classGroupId).eq("status", "active"),
    sb.from("subject_offerings").select("subject_id,subjects(id,name)").eq("tenant_id", tenantId).eq("class_group_id", classGroupId),
    sb.from("class_groups").select("id,name,level,form_teacher_id,users!class_groups_form_teacher_id_fkey(full_name)").eq("tenant_id", tenantId).eq("id", classGroupId).maybeSingle(),
    sb.from("terms").select("id,session_id,position,starts_on,ends_on,next_term_begins").eq("tenant_id", tenantId).eq("id", termId).maybeSingle()
  ]);
  if (!group) throw new Error("class group not found");
  if (!term) throw new Error("term not found");
  const studentIds: string[] = (students ?? []).map((s: { id: string }) => s.id);
  if (!studentIds.length) return { computed: 0, skipped_published: 0 };

  const componentIds = new Set(scheme.components.map(c => c.id));
  const scores = (await fetchAll<{ student_id: string; subject_id: string; component_id: string; score: number | null }>(() =>
    sb.from("score_entries").select("id,student_id,subject_id,component_id,score")
      .eq("tenant_id", tenantId).eq("term_id", termId).in("student_id", studentIds).order("id")))
    .filter(s => componentIds.has(s.component_id));

  let subjects = (offerings ?? []).filter((o: any) => o.subjects).map((o: any) => ({ id: o.subjects.id, name: o.subjects.name }));
  if (!subjects.length) {
    // No offerings configured: fall back to subjects that actually have scores.
    const ids = [...new Set(scores.map(s => s.subject_id))];
    if (ids.length) {
      const { data } = await sb.from("subjects").select("id,name").eq("tenant_id", tenantId).in("id", ids);
      subjects = data ?? [];
    }
  }
  subjects.sort((a: any, b: any) => a.name.localeCompare(b.name));

  const results = computeClassResults({ studentIds, subjects, scores, scheme });
  const d = scheme.decimals ?? 1;

  // Attendance for the term: distinct days with a sign-in.
  const present = new Map<string, number>();
  if (term.starts_on) {
    const end = term.ends_on ? `${term.ends_on}T23:59:59Z` : new Date().toISOString();
    const ev = await fetchAll<{ student_id: string; at: string }>(() => sb.from("gate_events").select("id,student_id,at")
      .eq("tenant_id", tenantId).eq("direction", "in").in("student_id", studentIds)
      .gte("at", `${term.starts_on}T00:00:00Z`).lte("at", end).order("id"));
    const days = new Map<string, Set<string>>();
    for (const e of ev) {
      if (!days.has(e.student_id)) days.set(e.student_id, new Set());
      days.get(e.student_id)!.add(String(e.at).slice(0, 10));
    }
    days.forEach((v, k) => present.set(k, v.size));
  }
  // The class register is the official record when it has been taken: it wins over gate sign-ins.
  const register = new Map<string, { present: number; absent: number; opened: number }>();
  if (term.starts_on) {
    const att = await fetchAll<{ student_id: string; status: string }>(() => sb.from("class_attendance").select("id,student_id,status")
      .eq("tenant_id", tenantId).in("student_id", studentIds)
      .gte("date", term.starts_on).lte("date", term.ends_on ?? new Date().toISOString().slice(0, 10)).order("id"));
    for (const a of att) {
      const m = register.get(a.student_id) ?? { present: 0, absent: 0, opened: 0 };
      m.opened++;
      if (a.status === "present" || a.status === "late") m.present++; else if (a.status === "absent") m.absent++;
      register.set(a.student_id, m);
    }
  }
  // Character and skills ratings for the report card.
  const { data: traitDefs } = await sb.from("trait_definitions").select("id,domain,name,position").eq("tenant_id", tenantId).order("position");
  // The school's own rating scale, kept with each card so old cards still read right if it changes (8400).
  const { data: traitSettings } = await sb.from("tenant_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
  const scale = traitScale(traitSettings);
  const traitRows = (traitDefs ?? []).length
    ? await fetchAll<{ student_id: string; trait_id: string; rating: number }>(() => sb.from("trait_ratings").select("student_id,trait_id,rating")
        .eq("term_id", termId).in("student_id", studentIds).order("student_id").order("trait_id"))
    : [];

  // Per-subject comments, effort, targets and teacher predictions.
  const subjectNotes = await fetchAll<{ student_id: string; subject_id: string; comment: string | null; effort: string | null; target_grade: string | null; predicted_grade: string | null }>(() =>
    sb.from("report_subject_comments").select("student_id,subject_id,comment,effort,target_grade,predicted_grade")
      .eq("term_id", termId).in("student_id", studentIds).order("student_id").order("subject_id"));
  const noteBy = new Map(subjectNotes.map(n => [`${n.student_id}|${n.subject_id}`, n]));

  // Earlier end-of-term cards: for the session's cumulative results and for predicted scores.
  const history = kind === "term"
    ? await fetchAll<{ student_id: string; term_id: string; data: any; terms: { session_id: string; position: number; starts_on: string | null; name: string } | null }>(() =>
        sb.from("report_cards").select("id,student_id,term_id,data,terms(session_id,position,starts_on,name)")
          .eq("tenant_id", tenantId).eq("kind", "term").neq("term_id", termId).in("student_id", studentIds).order("id"))
    : [];
  const orderKey = (t: { starts_on: string | null; position: number } | null) => `${t?.starts_on ?? "9999"}|${String(t?.position ?? 0).padStart(3, "0")}`;
  history.sort((a, b) => orderKey(a.terms).localeCompare(orderKey(b.terms)));
  const pastTotals = new Map<string, number[]>();   // student|subject → totals, oldest first
  for (const h of history) for (const s of h.data?.subjects ?? []) {
    if (s.total === null || s.total === undefined) continue;
    const k = `${h.student_id}|${s.subject_id}`;
    pastTotals.set(k, [...(pastTotals.get(k) ?? []), Number(s.total)].slice(-6));
  }

  let cumulative: ReturnType<typeof cumulativeResults> | null = null;
  let sessionTerms: { id: string; label: string }[] = [];
  if (kind === "term" && fullScheme.show_cumulative) {
    const { data: terms } = await sb.from("terms").select("id,name,position,starts_on").eq("tenant_id", tenantId).eq("session_id", term.session_id).order("position");
    const upto = (terms ?? []).filter((t: any) => t.position <= term.position);
    if (upto.length > 1) {
      sessionTerms = upto.map((t: any) => ({ id: t.id, label: t.name }));
      const totals = new Map<string, Map<string, Map<string, number | null>>>();
      for (const sid of studentIds) totals.set(sid, new Map());
      for (const h of history) {
        if (!upto.some((t: any) => t.id === h.term_id)) continue;
        totals.get(h.student_id)?.set(h.term_id, new Map((h.data?.subjects ?? []).map((s: any) => [s.subject_id, s.total ?? null])));
      }
      for (const r of results) totals.get(r.student_id)!.set(termId, new Map(r.subjects.map(s => [s.subject_id, s.total])));
      cumulative = cumulativeResults({ terms: sessionTerms, totals, studentIds, decimals: d });
    }
  }

  const { data: existing } = await sb.from("report_cards").select("id,student_id,status").eq("tenant_id", tenantId).eq("term_id", termId).eq("kind", kind).in("student_id", studentIds);
  const published = new Set((existing ?? []).filter((r: any) => r.status === "published").map((r: any) => r.student_id));
  const baseLabel = await termLabel(sb, tenantId, termId);
  const label = kind === "midterm" ? `${baseLabel} (mid-term)` : baseLabel;
  const byId = new Map((students ?? []).map((s: any) => [s.id, s]));

  const rows = results
    .filter(r => opts.force || !published.has(r.student_id))
    .map(r => {
      const cum = cumulative?.get(r.student_id);
      return {
        tenant_id: tenantId, term_id: termId, student_id: r.student_id, class_group_id: classGroupId, kind,
        total: r.total, average: r.average, position: r.position, class_size: r.class_size,
        computed_at: new Date().toISOString(),
        data: {
          kind, template: fullScheme.template,
          student_name: studentName(byId.get(r.student_id) as any),
          admission_no: (byId.get(r.student_id) as any)?.admission_no,
          class_name: group.name, form_teacher: (group as any).users?.full_name ?? null, term_label: label,
          next_term_begins: term.next_term_begins,
          scheme: { name: fullScheme.name, pass_mark: scheme.pass_mark, show_position: scheme.show_position,
            show_class_average: fullScheme.show_class_average, bands: scheme.bands },
          components: scheme.components.map(c => ({ id: c.id, name: c.name, max_score: c.max_score, weight: c.weight })),
          subjects: r.subjects.map(s => {
            const note = noteBy.get(`${r.student_id}|${s.subject_id}`);
            const past = pastTotals.get(`${r.student_id}|${s.subject_id}`) ?? [];
            const projected = kind === "term" && s.total !== null ? projectScore([...past, s.total], d) : null;
            return {
              ...s,
              comment: note?.comment ?? null, effort: note?.effort ?? null, target_grade: note?.target_grade ?? null,
              predicted_grade: note?.predicted_grade ?? (projected === null ? null : gradeFor(projected, scheme.bands)?.grade ?? null),
              predicted_score: projected,
              cumulative: cum?.subjects[s.subject_id] ?? null
            };
          }),
          gpa: r.gpa, subjects_taken: r.subjects_taken, subjects_passed: r.subjects_passed,
          cumulative: cum ? { terms: sessionTerms, average: cum.average, position: fullScheme.show_position ? cum.position : null } : null,
          days_present: register.has(r.student_id) ? register.get(r.student_id)!.present : term.starts_on ? present.get(r.student_id) ?? 0 : null,
          days_absent: register.get(r.student_id)?.absent ?? null,
          days_opened: register.get(r.student_id)?.opened ?? null,
          trait_scale: kind === "midterm" ? undefined : scale,
          traits: kind === "midterm" ? [] : (traitDefs ?? []).map((t: any) => ({ domain: t.domain, name: t.name,
            rating: traitRows.find(x => x.student_id === r.student_id && x.trait_id === t.id)?.rating ?? null }))
        }
      };
    });
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await sb.from("report_cards").upsert(rows.slice(i, i + 200), { onConflict: "term_id,student_id,kind" });
    if (error) throw new Error(error.message);
  }
  // Published cards that were recomputed (admins only) need a fresh signature.
  if (opts.force && published.size) {
    await signPublishedCards(sb, tenantId, (existing ?? []).filter((e: any) => e.status === "published").map((e: any) => e.id));
  }
  return { computed: rows.length, skipped_published: results.length - rows.length };
}
