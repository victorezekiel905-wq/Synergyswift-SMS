import { DEFAULT_SCALE, areaTitle, ratingShort, scaleKey, type ScaleItem } from "@/lib/traits";
import QrCode from "@/components/QrCode";
import { ordinal } from "@/lib/grading";

type Band = { grade: string; min_score: number; max_score: number; remark: string | null; grade_point?: number | null };
type Subject = {
  subject_id: string; subject: string; components: Record<string, number | null>; total: number | null; grade: string | null;
  remark: string | null; grade_point?: number | null; position: number | null; class_average: number | null; highest: number | null; lowest: number | null;
  comment?: string | null; effort?: string | null; target_grade?: string | null; predicted_grade?: string | null; predicted_score?: number | null;
  cumulative?: { totals: (number | null)[]; average: number | null } | null;
  own_parts?: { id: string; name: string; max_score: number }[];   // the subject teacher's own parts (9200)
};
export type ReportCard = {
  status: string; total: number | string | null; average: number | string | null; position: number | null; class_size: number | null;
  teacher_comment: string | null; principal_comment: string | null; published_at: string | null; kind?: string | null;
  data: {
    kind?: string; template?: "nigerian" | "british" | "american" | "early_years"; student_name?: string; admission_no?: string; class_name?: string; form_teacher?: string | null;
    term_label?: string; next_term_begins?: string | null; gpa?: number | null; days_present?: number | null; days_absent?: number | null; days_opened?: number | null;
    scheme?: { name?: string; pass_mark?: number; show_position?: boolean; show_class_average?: boolean; bands?: Band[] };
    components?: { id: string; name: string; max_score: number }[]; subjects?: Subject[];
    cumulative?: { terms: { id: string; label: string }[]; average: number | null; position: number | null } | null;
    traits?: { domain: string; name: string; rating: number | null }[];
    trait_scale?: ScaleItem[];
    // Preschool (early_years) cards: the checklist instead of subjects.
    areas?: { id: string; name: string; comment: string | null; typical: string | null; items: { text: string; rating: number | null }[] }[];
    ey_scale?: ScaleItem[];
    ey_options?: { show_key?: boolean };
  };
};
export type SchoolBrand = {
  school_name?: string | null; motto?: string | null; address?: string | null; phone?: string | null; email?: string | null; logo_url?: string | null;
  brand_color?: string | null; principal_name?: string | null; principal_signature_url?: string | null; stamp_url?: string | null; report_footer?: string | null;
};

const cell = "border border-slate-300 p-1.5";

/**
 * One printable report card in the school's chosen layout:
 *  - nigerian: assessment columns, total, grade, subject position, class average, remark
 *  - british:  attainment, effort, target and predicted grades, a comment per subject; no positions
 *  - american: percentage, letter grade, grade points and GPA
 *  - early_years: preschool areas of learning, what the child can do, a comment per area; no scores
 * Shared by the parent link (/r/…) and the whole-class print page.
 */
export default function ReportCardView({ card, school, studentPhoto, verifyUrl, verification, tenantName }: {
  card: ReportCard; school: SchoolBrand | null; studentPhoto?: string | null; verifyUrl?: string | null;
  verification?: "valid" | "changed" | "unsigned" | null; tenantName?: string | null;
}) {
  const d = card.data ?? {};
  const template = d.template ?? "nigerian";
  const early = template === "early_years";
  const midterm = (card.kind ?? d.kind) === "midterm";
  const comps = d.components ?? [];
  const subjects = (d.subjects ?? []).filter(s => s.total !== null);
  // Part columns (Nigerian layout): the school's parts; a subject with its own parts lists them across those columns.
  const anyOwn = subjects.some(s => s.own_parts?.length);
  const partCols = Math.max(1, comps.length);
  const showPos = Boolean(d.scheme?.show_position) && template !== "british";
  const showAvg = d.scheme?.show_class_average !== false;
  const cum = d.cumulative && d.cumulative.terms?.length > 1 ? d.cumulative : null;
  const color = /^#[0-9a-f]{6}$/i.test(school?.brand_color ?? "") ? school!.brand_color! : "#2f4f8f";
  const head = { background: color };

  return (
    <article className="mx-auto max-w-4xl bg-white p-4 text-slate-900 sm:p-8 print:p-0">
      {card.status !== "published" && (
        <p className="mb-4 rounded bg-amber-100 p-2 text-center text-sm font-semibold text-amber-900 print:hidden">PREVIEW: status is {card.status}. Parents cannot see this yet.</p>
      )}
      {verification === "changed" && (
        <p className="mb-4 rounded bg-rose-100 p-2 text-center text-sm font-semibold text-rose-900">These figures were changed after the school signed this report card. Ask the school to confirm them.</p>
      )}
      <header className="flex items-center gap-4 border-b-4 pb-4" style={{ borderColor: color }}>
        {school?.logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={school.logo_url} alt="" className="h-20 w-20 rounded object-contain" />
        )}
        <div className="flex-1 text-center">
          <h1 className="text-2xl font-bold uppercase tracking-wide" style={{ color }}>{school?.school_name ?? tenantName}</h1>
          {school?.motto && <p className="text-sm italic text-slate-600">{school.motto}</p>}
          {school?.address && <p className="text-xs text-slate-600">{school.address}{school.phone ? ` · ${school.phone}` : ""}{school.email ? ` · ${school.email}` : ""}</p>}
          <p className="mt-2 text-sm font-bold uppercase tracking-widest">{early ? "Early years report" : midterm ? "Mid-term progress report" : template === "american" ? "Report card" : template === "british" ? "School report" : "Report card"}: {d.term_label}</p>
        </div>
        {studentPhoto && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={studentPhoto} alt="" className="h-20 w-20 rounded object-cover" />
        )}
      </header>

      <section className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        <Info label="Name" value={d.student_name} />
        <Info label="Admission no" value={d.admission_no} />
        <Info label="Class" value={d.class_name} />
        {!(early && d.days_present == null) && <Info label={template === "british" ? "Attendance" : "Days present"} value={d.days_opened ? (template === "british" ? `${Math.round(((d.days_present ?? 0) / d.days_opened) * 100)}%` : `${d.days_present} of ${d.days_opened}`) : d.days_present ?? "—"} />}
        {!early && template !== "british" && <Info label="Total" value={card.total ?? "—"} />}
        {!early && <Info label="Average" value={card.average !== null ? `${card.average}%` : "—"} />}
        {showPos && !early && <Info label="Position" value={card.position ? `${ordinal(card.position)} of ${card.class_size}` : "—"} />}
        {(template === "american" || (d.gpa !== null && d.gpa !== undefined)) && <Info label="GPA" value={d.gpa ?? "—"} />}
        {cum && <Info label="Session average" value={cum.average !== null ? `${cum.average}%` : "—"} />}
        {cum && showPos && cum.position && <Info label="Session position" value={`${ordinal(cum.position)} of ${card.class_size}`} />}
        {d.form_teacher && <Info label={early ? "Class teacher" : template === "british" ? "Form tutor" : "Form teacher"} value={d.form_teacher} />}
      </section>

      {early && <EarlyYearsAreas areas={d.areas ?? []} scale={d.ey_scale ?? []} color={color} />}

      <div className={"mt-4 overflow-x-auto" + (early ? " hidden" : "")}>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-white" style={head}>
              <th className={cell + " text-left"}>Subject</th>
              {template === "nigerian" && (comps.length ? comps.map(c => <th key={c.id} className={cell + " text-center"}>{c.name}<div className="text-[10px] font-normal">/{c.max_score}</div></th>)
                : anyOwn && <th className={cell + " text-center"}>Parts</th>)}
              {template === "british" ? <>
                <th className={cell}>Attainment</th><th className={cell}>Grade</th><th className={cell}>Effort</th><th className={cell}>Target</th>{!midterm && <th className={cell}>Predicted</th>}
              </> : template === "american" ? <>
                <th className={cell}>%</th><th className={cell}>Grade</th><th className={cell}>Points</th>
              </> : <>
                <th className={cell}>Total</th><th className={cell}>Grade</th>
                {showPos && <th className={cell}>Pos</th>}
              </>}
              {showAvg && template !== "british" && <th className={cell}>Class avg</th>}
              {cum && template !== "british" && cum.terms.map(t => <th key={t.id} className={cell + " text-[11px]"}>{t.label}</th>)}
              {cum && <th className={cell + " text-[11px]"}>Session avg</th>}
              <th className={cell + " text-left"}>{template === "nigerian" ? "Remark" : "Comment"}</th>
            </tr>
          </thead>
          <tbody>
            {subjects.map(s => (
              <tr key={s.subject_id} className="odd:bg-slate-50">
                <td className={cell + " font-medium"}>{s.subject}</td>
                {template === "nigerian" && (s.own_parts?.length
                  ? <td colSpan={partCols} className={cell + " text-center text-[12px]"}>{s.own_parts.map(p => `${p.name} ${s.components?.[p.id] ?? "—"}/${p.max_score}`).join(" · ")}</td>
                  : comps.length ? comps.map(c => <td key={c.id} className={cell + " text-center tabular-nums"}>{s.components?.[c.id] ?? "—"}</td>)
                  : anyOwn && <td className={cell + " text-center"}>—</td>)}
                {template === "british" ? <>
                  <td className={cell + " text-center tabular-nums"}>{s.total}%</td>
                  <td className={cell + " text-center font-bold"}>{s.grade}</td>
                  <td className={cell + " text-center"}>{s.effort ?? "—"}</td>
                  <td className={cell + " text-center"}>{s.target_grade ?? "—"}</td>
                  {!midterm && <td className={cell + " text-center"}>{s.predicted_grade ?? "—"}</td>}
                </> : template === "american" ? <>
                  <td className={cell + " text-center tabular-nums"}>{s.total}</td>
                  <td className={cell + " text-center font-bold"}>{s.grade}</td>
                  <td className={cell + " text-center tabular-nums"}>{s.grade_point ?? "—"}</td>
                </> : <>
                  <td className={cell + " text-center font-bold tabular-nums"}>{s.total}</td>
                  <td className={cell + " text-center font-bold"}>{s.grade}</td>
                  {showPos && <td className={cell + " text-center"}>{ordinal(s.position)}</td>}
                </>}
                {showAvg && template !== "british" && <td className={cell + " text-center tabular-nums"}>{s.class_average ?? "—"}</td>}
                {cum && template !== "british" && cum.terms.map((t, i) => <td key={t.id} className={cell + " text-center tabular-nums"}>{s.cumulative?.totals?.[i] ?? "—"}</td>)}
                {cum && <td className={cell + " text-center font-semibold tabular-nums"}>{s.cumulative?.average ?? "—"}</td>}
                <td className={cell}>{template === "nigerian" ? s.remark : (s.comment || s.remark)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {Array.isArray(d.traits) && d.traits.some(t => t.rating !== null) && (
        <section className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          {[...new Set((d.traits ?? []).map(t => t.domain))].map(domain => {
            const rows = (d.traits ?? []).filter(t => t.domain === domain);
            if (!rows.some(t => t.rating !== null)) return null;
            return (
              <table key={domain} className="w-full border-collapse">
                <thead><tr><th className={cell + " text-left text-xs uppercase"}>{areaTitle(domain)}</th><th className={cell + " text-xs"}>Rating</th></tr></thead>
                <tbody>{rows.map(t => <tr key={t.name}><td className={cell}>{t.name}</td><td className={cell + " text-center font-semibold"}>{ratingShort(d.trait_scale ?? DEFAULT_SCALE, t.rating)}</td></tr>)}</tbody>
              </table>
            );
          })}
          <p className="text-xs text-slate-500 sm:col-span-2">{scaleKey(d.trait_scale ?? DEFAULT_SCALE)}</p>
        </section>
      )}

      <section className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
        <div className="rounded border border-slate-300 p-3">
          <p className="text-xs font-bold uppercase text-slate-500">{early ? "Class teacher's comment" : template === "british" ? "Form tutor's comment" : "Form teacher's comment"}</p>
          <p className="mt-1 min-h-[2.5rem]">{card.teacher_comment || "—"}</p>
        </div>
        <div className="rounded border border-slate-300 p-3">
          <p className="text-xs font-bold uppercase text-slate-500">{early ? "Head teacher's comment" : template === "british" ? "Head's comment" : "Principal's comment"}</p>
          <p className="mt-1 min-h-[2.5rem]">{card.principal_comment || "—"}</p>
          <div className="mt-2 flex items-end gap-3">
            {school?.principal_signature_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={school.principal_signature_url} alt="Principal's signature" className="h-10 max-w-[140px] object-contain" />
            )}
            {school?.stamp_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={school.stamp_url} alt="School stamp" className="h-14 w-14 object-contain opacity-80" />
            )}
          </div>
          {school?.principal_name && <p className="mt-1 text-xs text-slate-500">{school.principal_name}</p>}
        </div>
      </section>

      <section className="mt-4 flex flex-wrap items-end gap-4 text-xs text-slate-600">
        <div className="min-w-0 flex-1">
          {early ? (d.ey_options?.show_key !== false && (d.ey_scale ?? []).length > 0 && <>
            <p className="font-semibold">What the ratings mean</p>
            <p>{(d.ey_scale ?? []).map(s => `${s.short}: ${s.label}`).join(" · ")}. Children develop at different rates; this is a picture of where your child is now, not a test.</p>
          </>) : <>
            <p className="font-semibold">Grading key</p>
            <p>{(d.scheme?.bands ?? []).map(b => `${b.grade}: ${b.min_score}–${b.max_score}${b.remark ? ` (${b.remark})` : ""}${template === "american" && b.grade_point !== null && b.grade_point !== undefined ? ` = ${b.grade_point}` : ""}`).join(" · ")}</p>
          </>}
          {template === "british" && <p className="mt-1">Effort: 1 Excellent · 2 Good · 3 Satisfactory · 4 Cause for concern. Predicted grades are a forecast from this year&apos;s work so far.</p>}
          {midterm && <p className="mt-1">Mid-term figures cover only the assessments taken so far this term.</p>}
          {d.next_term_begins && <p className="mt-1">Next term begins: <b>{new Date(d.next_term_begins).toLocaleDateString(undefined, { dateStyle: "long" })}</b></p>}
          <p className="mt-1">Published {card.published_at ? new Date(card.published_at).toLocaleString() : "—"}</p>
          {school?.report_footer && <p className="mt-1 whitespace-pre-wrap">{school.report_footer}</p>}
        </div>
        {verifyUrl && card.status === "published" && (
          <div className="text-center">
            <QrCode value={verifyUrl} size={84} />
            <p className="mt-0.5 text-[10px]">{verification === "valid" ? "Signed by the school · scan to verify" : "Scan to view the school's copy"}</p>
          </div>
        )}
      </section>
    </article>
  );
}

/** Preschool: each area of learning, what the child can do, and the teacher's words. */
function EarlyYearsAreas({ areas, scale, color }: { areas: NonNullable<ReportCard["data"]["areas"]>; scale: ScaleItem[]; color: string }) {
  const word = (v: number | null) => (v == null ? "Not yet assessed" : scale.find(s => s.value === v)?.label ?? String(v));
  return (
    <section className="mt-4 grid gap-3 text-sm sm:grid-cols-2 print:grid-cols-2">
      {areas.map(a => (
        <div key={a.id} className="break-inside-avoid rounded border border-slate-300">
          <div className="flex items-baseline justify-between gap-2 px-3 py-1.5 text-white" style={{ background: color }}>
            <p className="font-semibold">{a.name}</p>
            {a.typical && <p className="text-xs opacity-90">Mostly: {a.typical}</p>}
          </div>
          <table className="w-full border-collapse">
            <tbody>
              {a.items.map(i => (
                <tr key={i.text} className="odd:bg-slate-50">
                  <td className="border-t border-slate-200 px-3 py-1">{i.text}</td>
                  <td className={"w-28 border-t border-slate-200 px-2 py-1 text-right text-xs font-semibold" + (i.rating == null ? " text-slate-400" : "")}>{word(i.rating)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {a.comment && <p className="border-t border-slate-200 px-3 py-2 text-[13px] italic text-slate-700">{a.comment}</p>}
        </div>
      ))}
    </section>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return <p><span className="text-xs uppercase text-slate-500">{label}: </span><b>{value}</b></p>;
}
