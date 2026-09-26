"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { rolesOf, type Me } from "@/components/ui";

type NavLink = { href: string; label: string; roles: string[]; module?: string };
type NavGroup = { title: string; links: NavLink[] };

const STAFF = ["teacher", "school_admin", "it_admin", "platform_admin", "principal", "bursar", "librarian", "hr_manager", "qa_officer", "gate_officer",
  "transport_officer", "hostel_warden", "nurse", "admissions_officer"];
const ADMIN = ["school_admin", "principal", "platform_admin"];
const TEACH = ["teacher", "school_admin", "principal"];
const FINANCE = ["bursar", ...ADMIN];
const ACADEMIC = STAFF.filter(r => !["gate_officer", "librarian", "bursar", "transport_officer", "nurse", "admissions_officer", "hostel_warden"].includes(r));

const GROUPS: NavGroup[] = [
  { title: "Home", links: [
    { href: "/dashboard", label: "Dashboard", roles: [...STAFF, "student"] },
    { href: "/school", label: "School overview", roles: STAFF },
    { href: "/student", label: "My school", roles: ["student"] },
    { href: "/parent", label: "My children", roles: ["parent"] }
  ] },
  { title: "Teaching", links: [
    { href: "/school/attendance", label: "Class register", roles: TEACH, module: "attendance" },
    { href: "/school/results", label: "Results & report cards", roles: ACADEMIC, module: "results" },
    { href: "/school/lesson-notes", label: "Lesson notes", roles: [...TEACH, "qa_officer"], module: "lesson_notes" },
    { href: "/school/homework", label: "Homework", roles: TEACH, module: "homework" },
    { href: "/school/timetable", label: "Timetable", roles: STAFF, module: "timetable" },
    { href: "/exams", label: "Secure exams", roles: TEACH, module: "exams" },
    { href: "/teacher/studio", label: "Lesson studio", roles: TEACH, module: "lms" },
    { href: "/teacher/assess", label: "Assess", roles: TEACH, module: "lms" },
    { href: "/teacher/live", label: "Live class", roles: TEACH, module: "lms" },
    { href: "/teacher/challenge", label: "Challenge", roles: TEACH, module: "lms" },
    { href: "/teacher/classes", label: "LMS classes", roles: [...TEACH, "it_admin"], module: "lms" }
  ] },
  { title: "Students", links: [
    { href: "/school/students", label: "Students & parents", roles: STAFF, module: "sims" },
    { href: "/school/analytics", label: "Early warning", roles: [...TEACH, "qa_officer"], module: "analytics" },
    { href: "/school/behaviour", label: "Behaviour & houses", roles: [...TEACH, "hostel_warden"], module: "behaviour" },
    { href: "/school/health", label: "Health & sick bay", roles: ["nurse", "hostel_warden", ...TEACH], module: "health" },
    { href: "/school/gate", label: "Sign in / out", roles: STAFF, module: "gate" },
    { href: "/school/pickup", label: "Pickup desk", roles: ["gate_officer", ...ADMIN], module: "pickup" },
    { href: "/school/transport", label: "School buses", roles: ["transport_officer", ...TEACH], module: "transport" },
    { href: "/school/hostel", label: "Boarding & exeat", roles: ["hostel_warden", ...ADMIN], module: "hostel" }
  ] },
  { title: "Parents", links: [
    { href: "/school/messages", label: "Messages", roles: [...ADMIN, "it_admin"], module: "messaging" },
    { href: "/school/events", label: "Events & trips", roles: STAFF, module: "events" },
    { href: "/school/meetings", label: "Parent meetings", roles: TEACH, module: "meetings" },
    { href: "/school/admissions", label: "Admissions", roles: ["admissions_officer", ...ADMIN], module: "admissions" }
  ] },
  { title: "Finance", links: [
    { href: "/school/fees", label: "Fees & payments", roles: FINANCE, module: "fees" },
    { href: "/school/finance", label: "Accounts & stock", roles: STAFF, module: "inventory" },
    { href: "/school/payroll", label: "Payroll & payslips", roles: STAFF, module: "payroll" },
    { href: "/school/requisitions", label: "Requisitions", roles: STAFF, module: "requisitions" }
  ] },
  { title: "Operations", links: [
    { href: "/school/hr", label: "HR & leave", roles: STAFF, module: "hr" },
    { href: "/school/library", label: "Library", roles: STAFF, module: "library" },
    { href: "/school/visitors", label: "Visitors", roles: ["gate_officer", ...ADMIN], module: "visitors" },
    { href: "/school/qa", label: "Quality assurance", roles: ["qa_officer", ...ADMIN], module: "qa" },
    { href: "/teacher/guard", label: "Device guard", roles: [...TEACH, "it_admin"], module: "lms" },
    { href: "/teacher/insights", label: "Insights", roles: [...TEACH, "it_admin"], module: "lms" }
  ] },
  { title: "Administration", links: [
    { href: "/school/setup", label: "School setup", roles: ADMIN },
    { href: "/school/rollover", label: "Promote students", roles: ADMIN, module: "sims" },
    { href: "/teacher/admin", label: "Policies & audit", roles: [...ADMIN, "it_admin"] },
    { href: "/teacher/billing", label: "Billing", roles: [...ADMIN, "it_admin"] }
  ] }
];

// Pages that render without the app chrome (public links, kiosk, exam lockdown).
const BARE = [/^\/login$/, /^\/signup$/, /^\/student\/join$/, /^\/r\//, /^\/g\//, /^\/exam\//, /^\/auth\//, /^\/school\/gate\/kiosk/, /^\/pay\//, /^\/apply\//];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const bare = BARE.some(r => r.test(pathname));

  useEffect(() => {
    if (bare) return;
    fetch("/api/me").then(r => r.json()).then((j: Me) => {
      setMe(j);
      if (pathname === "/") {
        if (j.platform) router.replace("/platform");
        else if (j.group && !j.profile) router.replace("/group");
        else if (j.profile) router.replace("/dashboard");
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bare]);
  useEffect(() => setOpen(false), [pathname]);

  if (bare) return <>{children}</>;

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const roles = rolesOf(me);
  const modules = me?.tenant?.modules ?? {};
  const groups: NavGroup[] = me?.platform
    ? [{ title: "Platform", links: [{ href: "/platform", label: "Schools", roles: [] }, { href: "/platform/groups", label: "School groups", roles: [] }] }]
    : me?.group && !me.profile
    ? [{ title: "Group", links: [{ href: "/group", label: "All branches", roles: [] }] }]
    : GROUPS.map(g => ({ ...g, links: g.links.filter(l => l.roles.some(r => roles.has(r)) && (!l.module || modules[l.module] !== false)) }))
        .filter(g => g.links.length);
  const suspended = me?.tenant?.status === "suspended" || me?.account?.state === "suspended";
  const isActive = (href: string) => pathname === href || (href !== "/school" && href !== "/dashboard" && pathname.startsWith(href + "/")) || (href === "/school" && pathname === "/school");

  const nav = (
    <nav aria-label="Main" className="space-y-5">
      {groups.map(g => (
        <div key={g.title}>
          <p className="mb-1 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">{g.title}</p>
          <ul className="space-y-0.5">
            {g.links.map(l => (
              <li key={l.href}>
                <Link href={l.href} aria-current={isActive(l.href) ? "page" : undefined}
                  className={"block rounded-md px-3 py-1.5 text-sm " + (isActive(l.href) ? "bg-brand-50 font-semibold text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900")}>
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex items-center justify-between gap-4 px-4 py-2.5">
          <div className="flex items-center gap-3">
            <button className="btn btn-ghost px-2 py-1 lg:hidden" onClick={() => setOpen(o => !o)} aria-label="Toggle navigation" aria-expanded={open}>☰</button>
            <Link href={me?.platform ? "/platform" : "/dashboard"} className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-600 text-sm font-black text-white">E</span>
              <span className="text-sm font-bold">{me?.tenant?.name ?? (me?.platform ? "Platform console" : "EduClass Fusion")}</span>
            </Link>
          </div>
          <div className="flex items-center gap-3">
            {me?.profile && (
              <span className="hidden text-xs text-slate-500 sm:block">
                {me.profile.full_name} <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] uppercase">{me.profile.role.replace(/_/g, " ")}</span>
              </span>
            )}
            <button onClick={signOut} className="btn btn-ghost text-xs">Sign out</button>
          </div>
        </div>
      </header>
      <div className="flex">
        <aside className={(open ? "fixed inset-y-0 left-0 z-20 block pt-16" : "hidden") + " w-60 shrink-0 overflow-y-auto border-r border-slate-200 bg-white px-2 py-5 lg:sticky lg:top-[53px] lg:block lg:h-[calc(100vh-53px)] lg:pt-5"}>
          {nav}
        </aside>
        <div className="min-w-0 flex-1">
          {suspended && (
            <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800">
              This school account is suspended. Contact your provider to restore access.
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
