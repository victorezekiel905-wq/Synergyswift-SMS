"use client";
import Link from "next/link";
import { useApi, Page, PageHeader, Stat, Alert } from "@/components/ui";

type Overview = {
  school: string; term: string | null; roles: string[];
  counts: Record<string, number>;
};

const QUICK: { href: string; label: string; desc: string; roles?: string[] }[] = [
  { href: "/school/results", label: "Enter scores", desc: "Score sheets, compile and publish report cards" },
  { href: "/school/gate", label: "Sign in / out", desc: "Gate kiosk, today's log, staff sign-in" },
  { href: "/school/students", label: "Students & parents", desc: "Records, guardians, portal links, import" },
  { href: "/exams", label: "Secure exams", desc: "Build, proctor and mark exams" },
  { href: "/school/pickup", label: "Pickup desk", desc: "Verify parent pickup codes" },
  { href: "/school/library", label: "Library", desc: "Catalogue, issue and return" },
  { href: "/school/requisitions", label: "Requisitions", desc: "Request and approve purchases" },
  { href: "/school/hr", label: "HR & leave", desc: "Staff records, roles and leave" },
  { href: "/school/qa", label: "Quality assurance", desc: "Observations and school-health indicators" },
  { href: "/school/messages", label: "Messages", desc: "Broadcast to parents, delivery log" }
];

export default function SchoolHome() {
  const { data, error } = useApi<Overview>("/api/school/overview");
  const c = data?.counts ?? {};
  return (
    <Page wide>
      <PageHeader eyebrow={data?.term ?? "No current term set"} title={data?.school ?? "School"}
        subtitle="Live numbers from sign-in, results, approvals and messaging." />
      {error && <Alert>{error}</Alert>}
      {data && !data.term && (
        <div className="mb-5"><Alert tone="amber">No current term is set. Go to <Link className="font-semibold underline" href="/school/setup">School setup</Link> to create a session and mark a term as current.</Alert></div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Stat label="Students" value={c.students ?? "…"} />
        <Stat label="On site now" value={c.students_on_site ?? "…"} hint="students signed in" tone="good" />
        <Stat label="Staff on site" value={c.staff_on_site ?? "…"} hint={`of ${c.staff ?? 0} staff`} />
        <Stat label="Late today" value={c.late_today ?? "…"} tone={(c.late_today ?? 0) > 0 ? "warn" : undefined} />
        <Stat label="Open exams" value={c.open_exams ?? "…"} />
        <Stat label="Report cards out" value={c.published_report_cards ?? "…"} />
        <Stat label="Pending requisitions" value={c.pending_requisitions ?? "…"} tone={(c.pending_requisitions ?? 0) > 0 ? "warn" : undefined} />
        <Stat label="Pending leave" value={c.pending_leave ?? "…"} tone={(c.pending_leave ?? 0) > 0 ? "warn" : undefined} />
        <Stat label="Guardians" value={c.guardians ?? "…"} />
        <Stat label="Classes" value={c.class_groups ?? "…"} />
        <Stat label="Failed messages" value={c.failed_messages ?? "…"} tone={(c.failed_messages ?? 0) > 0 ? "bad" : "good"} />
      </div>
      <h2 className="mb-3 mt-8 text-lg font-semibold">Go to</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {QUICK.map(q => (
          <Link key={q.href} href={q.href} className="card block p-4 transition hover:border-brand-300 hover:shadow">
            <p className="font-semibold">{q.label}</p>
            <p className="mt-0.5 text-sm text-slate-500">{q.desc}</p>
          </Link>
        ))}
      </div>
    </Page>
  );
}
