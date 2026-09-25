"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { rolesOf, type Me } from "@/components/ui";

type NavLink = { href: string; label: string; roles: string[]; module?: string };
type NavGroup = { title: string; links: NavLink[] };

const STAFF = ["teacher", "school_admin", "it_admin", "platform_admin", "principal", "bursar", "librarian", "hr_manager", "qa_officer", "gate_officer"];
const ADMIN = ["school_admin", "principal", "platform_admin"];
const TEACH = ["teacher", "school_admin", "principal"];

const GROUPS: NavGroup[] = [
  { title: "Home", links: [
    { href: "/dashboard", label: "Dashboard", roles: [...STAFF, "student"] },
    { href: "/school", label: "School overview", roles: STAFF },
    { href: "/student", label: "My exams & results", roles: ["student"] },
    { href: "/parent", label: "My children", roles: ["parent"] }
  ] },
  { title: "Academics", links: [
    { href: "/school/results", label: "Results & report cards", roles: STAFF.filter(r => !["gate_officer", "librarian", "bursar"].includes(r)), module: "results" },
    { href: "/exams", label: "Secure exams", roles: TEACH, module: "exams" },
    { href: "/teacher/studio", label: "Lesson studio", roles: TEACH, module: "lms" },
    { href: "/teacher/assess", label: "Assess", roles: TEACH, module: "lms" },
    { href: "/teacher/live", label: "Live class", roles: TEACH, module: "lms" },
    { href: "/teacher/challenge", label: "Challenge", roles: TEACH, module: "lms" },
    { href: "/teacher/classes", label: "LMS classes", roles: [...TEACH, "it_admin"], module: "lms" }
  ] },
  { title: "Students", links: [
    { href: "/school/students", label: "Students & parents", roles: STAFF, module: "sims" },
    { href: "/school/gate", label: "Sign in / out", roles: STAFF, module: "gate" },
    { href: "/school/pickup", label: "Pickup desk", roles: ["gate_officer", ...ADMIN], module: "pickup" },
    { href: "/school/messages", label: "Messages", roles: [...ADMIN, "it_admin"], module: "messaging" }
  ] },
  { title: "Operations", links: [
    { href: "/school/library", label: "Library", roles: STAFF, module: "library" },
    { href: "/school/requisitions", label: "Requisitions", roles: STAFF, module: "requisitions" },
    { href: "/school/hr", label: "HR & leave", roles: STAFF, module: "hr" },
    { href: "/school/qa", label: "Quality assurance", roles: ["qa_officer", ...ADMIN], module: "qa" },
    { href: "/teacher/guard", label: "Device guard", roles: [...TEACH, "it_admin"], module: "lms" },
    { href: "/teacher/insights", label: "Insights", roles: [...TEACH, "it_admin"], module: "lms" }
  ] },
  { title: "Administration", links: [
    { href: "/school/setup", label: "School setup", roles: ADMIN },
    { href: "/teacher/admin", label: "Policies & audit", roles: [...ADMIN, "it_admin"] },
    { href: "/teacher/billing", label: "Billing", roles: [...ADMIN, "it_admin"] }
  ] }
];

// Pages that render without the app chrome (public links, kiosk, exam lockdown).
const BARE = [/^\/login$/, /^\/signup$/, /^\/student\/join$/, /^\/r\//, /^\/g\//, /^\/exam\//, /^\/auth\//, /^\/school\/gate\/kiosk/];

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
    ? [{ title: "Platform", links: [{ href: "/platform", label: "Tenants", roles: [] }] }]
    : GROUPS.map(g => ({ ...g, links: g.links.filter(l => l.roles.some(r => roles.has(r)) && (!l.module || modules[l.module] !== false)) }))
        .filter(g => g.links.length);
  const suspended = me?.tenant?.status === "suspended";
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
