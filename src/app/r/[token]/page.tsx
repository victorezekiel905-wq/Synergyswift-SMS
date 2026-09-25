import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createServiceClient } from "@/lib/supabase/service";
import { ordinal } from "@/lib/grading";
import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Report card", robots: { index: false, follow: false } };

type Subject = {
  subject_id: string; subject: string; components: Record<string, number | null>; total: number | null; grade: string | null;
  remark: string | null; position: number | null; class_average: number | null; highest: number | null; lowest: number | null;
};

/**
 * Public, printable report card reached from the parent's WhatsApp / email
 * link. The 48-hex token is the only key; only PUBLISHED cards of ACTIVE
 * schools render. Staff can preview drafts while signed in via the same URL.
 */
export default async function ReportCardPage({ params }: { params: { token: string } }) {
  if (!/^[0-9a-f]{32,128}$/i.test(params.token)) notFound();
  const svc = createServiceClient();
  const { data: card } = await svc.from("report_cards")
    .select("*,tenants(status,name),students(first_name,last_name,other_names,admission_no,photo_url,gender,date_of_birth)")
    .eq("access_token", params.token).maybeSingle();
  if (!card || card.tenants?.status !== "active") notFound();

  if (card.status !== "published") {
    // Drafts are only visible to signed-in staff of the same school.
    const { createClient } = await import("@/lib/supabase/server");
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    const { data: me } = user ? await sb.from("users").select("tenant_id,role").eq("id", user.id).maybeSingle() : { data: null };
    if (!me || me.tenant_id !== card.tenant_id || ["student", "parent"].includes(me.role)) notFound();
  }
  const { data: school } = await svc.from("tenant_settings").select("*").eq("tenant_id", card.tenant_id).maybeSingle();

  const d = card.data ?? {};
  const comps: { id: string; name: string; max_score: number }[] = d.components ?? [];
  const subjects: Subject[] = (d.subjects ?? []).filter((s: Subject) => s.total !== null);
  const showPos = Boolean(d.scheme?.show_position);
  const showAvg = d.scheme?.show_class_average !== false;
  const color = /^#[0-9a-f]{6}$/i.test(school?.brand_color ?? "") ? school!.brand_color : "#1d5ddb";
  const st = card.students;

  return (
    <main className="mx-auto max-w-4xl bg-white p-4 text-slate-900 sm:p-8 print:p-0">
      {card.status !== "published" && (
        <p className="mb-4 rounded bg-amber-100 p-2 text-center text-sm font-semibold text-amber-900 print:hidden">PREVIEW: status is {card.status}. Parents cannot see this yet.</p>
      )}
      <header className="flex items-center gap-4 border-b-4 pb-4" style={{ borderColor: color }}>
        {school?.logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={school.logo_url} alt="" className="h-20 w-20 rounded object-contain" />
        )}
        <div className="flex-1 text-center">
          <h1 className="text-2xl font-black uppercase tracking-wide" style={{ color }}>{school?.school_name ?? card.tenants?.name}</h1>
          {school?.motto && <p className="text-sm italic text-slate-600">{school.motto}</p>}
          {school?.address && <p className="text-xs text-slate-600">{school.address}{school.phone ? ` · ${school.phone}` : ""}{school.email ? ` · ${school.email}` : ""}</p>}
          <p className="mt-2 text-sm font-bold uppercase tracking-widest">Report card: {d.term_label}</p>
        </div>
        {st?.photo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={st.photo_url} alt="" className="h-20 w-20 rounded object-cover" />
        )}
      </header>

      <section className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        <Info label="Name" value={d.student_name} />
        <Info label="Admission no" value={d.admission_no} />
        <Info label="Class" value={d.class_name} />
        <Info label="Days present" value={d.days_present ?? "—"} />
        <Info label="Total" value={card.total ?? "—"} />
        <Info label="Average" value={card.average !== null ? `${card.average}%` : "—"} />
        {showPos && <Info label="Position" value={card.position ? `${ordinal(card.position)} of ${card.class_size}` : "—"} />}
        {d.gpa !== null && d.gpa !== undefined && <Info label="GPA" value={d.gpa} />}
      </section>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-white" style={{ background: color }}>
              <th className="border border-slate-300 p-1.5 text-left">Subject</th>
              {comps.map(c => <th key={c.id} className="border border-slate-300 p-1.5 text-center">{c.name}<div className="text-[10px] font-normal">/{c.max_score}</div></th>)}
              <th className="border border-slate-300 p-1.5">Total</th>
              <th className="border border-slate-300 p-1.5">Grade</th>
              {showPos && <th className="border border-slate-300 p-1.5">Pos</th>}
              {showAvg && <th className="border border-slate-300 p-1.5">Class avg</th>}
              <th className="border border-slate-300 p-1.5 text-left">Remark</th>
            </tr>
          </thead>
          <tbody>
            {subjects.map(s => (
              <tr key={s.subject_id} className="odd:bg-slate-50">
                <td className="border border-slate-300 p-1.5 font-medium">{s.subject}</td>
                {comps.map(c => <td key={c.id} className="border border-slate-300 p-1.5 text-center tabular-nums">{s.components?.[c.id] ?? "—"}</td>)}
                <td className="border border-slate-300 p-1.5 text-center font-bold tabular-nums">{s.total}</td>
                <td className="border border-slate-300 p-1.5 text-center font-bold">{s.grade}</td>
                {showPos && <td className="border border-slate-300 p-1.5 text-center">{ordinal(s.position)}</td>}
                {showAvg && <td className="border border-slate-300 p-1.5 text-center tabular-nums">{s.class_average ?? "—"}</td>}
                <td className="border border-slate-300 p-1.5">{s.remark}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
        <div className="rounded border border-slate-300 p-3">
          <p className="text-xs font-bold uppercase text-slate-500">Form teacher&apos;s comment</p>
          <p className="mt-1 min-h-[2.5rem]">{card.teacher_comment || "—"}</p>
        </div>
        <div className="rounded border border-slate-300 p-3">
          <p className="text-xs font-bold uppercase text-slate-500">Principal&apos;s comment</p>
          <p className="mt-1 min-h-[2.5rem]">{card.principal_comment || "—"}</p>
          {school?.principal_name && <p className="mt-2 text-xs text-slate-500">{school.principal_name}</p>}
        </div>
      </section>

      <section className="mt-4 text-xs text-slate-600">
        <p className="font-semibold">Grading key</p>
        <p>{(d.scheme?.bands ?? []).map((b: { grade: string; min_score: number; max_score: number; remark: string | null }) => `${b.grade}: ${b.min_score}–${b.max_score}${b.remark ? ` (${b.remark})` : ""}`).join(" · ")}</p>
        {d.next_term_begins && <p className="mt-1">Next term begins: <b>{new Date(d.next_term_begins).toLocaleDateString(undefined, { dateStyle: "long" })}</b></p>}
        <p className="mt-1">Published {card.published_at ? new Date(card.published_at).toLocaleString() : "—"}</p>
      </section>
      <div className="mt-6 text-center print:hidden"><PrintButton /></div>
    </main>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return <p><span className="text-xs uppercase text-slate-500">{label}: </span><b>{value}</b></p>;
}
