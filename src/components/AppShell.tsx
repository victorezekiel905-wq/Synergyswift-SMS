"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Icon, rolesOf, type Me } from "@/components/ui";
import SearchPalette from "@/components/SearchPalette";

type NavLink = { href: string; label: string; roles: string[]; module?: string };
type NavGroup = { title: string; links: NavLink[] };

const STAFF = ["teacher", "school_admin", "it_admin", "platform_admin", "principal", "bursar", "librarian", "hr_manager", "qa_officer", "gate_officer",
  "transport_officer", "hostel_warden", "nurse", "admissions_officer", "cashier", "counsellor"];
const ADMIN = ["school_admin", "principal", "platform_admin"];
const TEACH = ["teacher", "school_admin", "principal"];
const FINANCE = ["bursar", ...ADMIN];
const ACADEMIC = STAFF.filter(r => !["gate_officer", "librarian", "bursar", "transport_officer", "nurse", "admissions_officer", "hostel_warden", "cashier", "counsellor"].includes(r));
const PASTORAL = [...TEACH, "counsellor"];

const GROUPS: NavGroup[] = [
  { title: "Home", links: [
    { href: "/dashboard", label: "Dashboard", roles: [...STAFF, "student"] },
    { href: "/school", label: "School overview", roles: STAFF.filter(r => r !== "cashier") },
    { href: "/school/inbox", label: "Parent messages", roles: STAFF.filter(r => r !== "cashier"), module: "inbox" },
    { href: "/student", label: "My school", roles: ["student"] },
    { href: "/student/practice", label: "Past-question practice", roles: ["student"], module: "exams" },
    { href: "/forums", label: "Discussions", roles: [...STAFF, "student"], module: "lms" },
    { href: "/parent", label: "My children", roles: ["parent"] }
  ] },
  { title: "Teaching", links: [
    { href: "/school/attendance", label: "Class register", roles: TEACH, module: "attendance" },
    { href: "/school/results", label: "Results & report cards", roles: ACADEMIC, module: "results" },
    { href: "/school/schemes", label: "Schemes of work", roles: [...TEACH, "qa_officer"], module: "lesson_notes" },
    { href: "/school/lesson-notes", label: "Lesson notes", roles: [...TEACH, "qa_officer"], module: "lesson_notes" },
    { href: "/school/homework", label: "Homework", roles: TEACH, module: "homework" },
    { href: "/school/timetable", label: "Timetable", roles: STAFF, module: "timetable" },
    { href: "/school/cover", label: "Cover", roles: TEACH, module: "cover" },
    { href: "/exams", label: "Secure exams", roles: TEACH, module: "exams" },
    { href: "/exams/bank", label: "Question bank", roles: TEACH, module: "exams" },
    { href: "/school/exam-planner", label: "Exam planner", roles: TEACH, module: "exams" },
    { href: "/teacher/studio", label: "Lesson studio", roles: TEACH, module: "lms" },
    { href: "/teacher/assess", label: "Assess", roles: TEACH, module: "lms" },
    { href: "/teacher/live", label: "Live class", roles: TEACH, module: "lms" },
    { href: "/teacher/challenge", label: "Challenge", roles: TEACH, module: "lms" },
    { href: "/teacher/classes", label: "LMS classes", roles: [...TEACH, "it_admin"], module: "lms" }
  ] },
  { title: "Students", links: [
    { href: "/school/students", label: "Students & parents", roles: STAFF, module: "sims" },
    { href: "/school/analytics", label: "Early warning", roles: [...PASTORAL, "qa_officer"], module: "analytics" },
    { href: "/school/sen", label: "SEN register", roles: PASTORAL, module: "sims" },
    { href: "/school/certificates", label: "Certificates", roles: ADMIN, module: "sims" },
    { href: "/school/behaviour", label: "Behaviour & houses", roles: [...PASTORAL, "hostel_warden"], module: "behaviour" },
    { href: "/school/health", label: "Health & sick bay", roles: ["nurse", "hostel_warden", ...PASTORAL], module: "health" },
    { href: "/school/gate", label: "Sign in / out", roles: STAFF, module: "gate" },
    { href: "/school/pickup", label: "Pickup desk", roles: ["gate_officer", ...ADMIN], module: "pickup" },
    { href: "/school/transport", label: "School buses", roles: ["transport_officer", ...TEACH], module: "transport" },
    { href: "/school/hostel", label: "Boarding & exeat", roles: ["hostel_warden", ...ADMIN], module: "hostel" }
  ] },
  { title: "Parents", links: [
    { href: "/school/messages", label: "Messages", roles: [...ADMIN, "it_admin"], module: "messaging" },
    { href: "/school/events", label: "Events & trips", roles: STAFF, module: "events" },
    { href: "/school/meetings", label: "Parent meetings", roles: TEACH, module: "meetings" },
    { href: "/school/admissions", label: "Admissions", roles: ["admissions_officer", ...ADMIN], module: "admissions" },
    { href: "/school/community", label: "Families & community", roles: [...ADMIN, "bursar"], module: "community" },
    { href: "/school/support", label: "Complaints & requests", roles: STAFF.filter(r => r !== "cashier"), module: "community" }
  ] },
  { title: "Finance", links: [
    { href: "/school/fees", label: "Fees & payments", roles: FINANCE, module: "fees" },
    { href: "/school/shop", label: "Tuck shop & wallets", roles: ["cashier", ...FINANCE], module: "wallet" },
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
    { href: "/school/security", label: "Security & sign-in", roles: ADMIN },
    { href: "/school/consent", label: "Consent & privacy", roles: ADMIN },
    { href: "/school/data", label: "Import & export", roles: [...ADMIN, "it_admin"] },
    { href: "/school/audit", label: "Change history", roles: ADMIN },
    { href: "/account/security", label: "Account security", roles: [...STAFF, "parent", "student"] },
    { href: "/school/rollover", label: "Promote students", roles: ADMIN, module: "sims" },
    { href: "/teacher/admin", label: "Policies & audit", roles: [...ADMIN, "it_admin"] },
    { href: "/teacher/billing", label: "Billing", roles: [...ADMIN, "it_admin"] }
  ] }
];

// Pages that render without the app chrome (public links, kiosk, exam lockdown).
const BARE = [/^\/login$/, /^\/signup$/, /^\/student\/join$/, /^\/r\//, /^\/g\//, /^\/exam\//, /^\/auth\//, /^\/school\/gate\/kiosk/, /^\/pay\//, /^\/apply\//, /^\/enquire\//, /^\/visit\//, /^\/entrance\//, /^\/t\//, /^\/s\//, /^\/unsubscribe\//, /^\/alumni\//, /^\/v\//, /\/print$/, /\/transcript$/];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const [idleWarn, setIdleWarn] = useState(false);
  const lastActive = useRef(Date.now());
  const bare = BARE.some(r => r.test(pathname));

  useEffect(() => {
    if (bare) return;
    fetch("/api/me").then(r => r.json()).then(async (j: Me) => {
      setMe(j);
      const state = j.account?.state;
      // A second factor is required before this account can see anything.
      if ((j.platform_mfa || state === "mfa_required") && !pathname.startsWith("/account/security")) {
        router.replace(`/account/security?required=${j.platform_mfa ? "platform" : "school"}`);
        return;
      }
      if (state === "password_expired" && !pathname.startsWith("/account/security")) { router.replace("/account/security?required=password"); return; }
      if (state === "alumni") { router.replace("/alumni/me"); return; }
      if (state === "sso_required" || state === "session_expired") {
        await createClient().auth.signOut();
        router.replace(`/login?error=${state}`);
        return;
      }
      if (pathname === "/") {
        if (j.platform) router.replace("/platform");
        else if (j.group && !j.profile) router.replace("/group");
        else if (j.profile) router.replace("/dashboard");
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bare]);
  useEffect(() => setOpen(false), [pathname]);
  // Keep the session's access grant fresh while the page is open (schools that restrict staff access).
  useEffect(() => {
    if (bare || !me?.profile) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") fetch("/api/me").catch(() => {}); }, 5 * 60_000);
    return () => clearInterval(t);
  }, [bare, me?.profile]);
  // Sign out after the school's idle time, with a one-minute warning.
  const idle = me?.prefs?.idle_minutes ?? 0;
  useEffect(() => {
    if (bare || !idle) return;
    const touch = () => { lastActive.current = Date.now(); setIdleWarn(false); };
    const events = ["mousemove", "keydown", "pointerdown", "scroll", "touchstart"];
    events.forEach(e => window.addEventListener(e, touch, { passive: true }));
    const t = setInterval(async () => {
      const left = idle * 60_000 - (Date.now() - lastActive.current);
      if (left <= 0) {
        clearInterval(t);
        await createClient().auth.signOut();
        router.replace("/login?error=idle");
      } else setIdleWarn(left <= 60_000);
    }, 10_000);
    return () => { clearInterval(t); events.forEach(e => window.removeEventListener(e, touch)); };
  }, [bare, idle, router]);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]);

  if (bare) return <>{children}</>;
  if (me?.account?.state === "access_restricted") return <AccessBlocked message={me.account.message ?? null} device={(me.account as { device?: string | null }).device ?? null} />;

  async function signOut() {
    let unsent = 0;
    try { unsent = JSON.parse(localStorage.getItem("educlass:register-queue") ?? "[]").length; } catch { /* storage blocked */ }
    if (unsent && !confirm(`${unsent} register${unsent === 1 ? " has" : "s have"} not been sent yet. Signing out deletes ${unsent === 1 ? "it" : "them"} from this device. Sign out anyway?`)) return;
    await createClient().auth.signOut();
    // Class lists and unsent registers kept for offline use belong to this user only.
    try { Object.keys(localStorage).filter(k => k.startsWith("educlass:")).forEach(k => localStorage.removeItem(k)); } catch { /* storage blocked */ }
    router.push("/login");
    router.refresh();
  }

  const roles = rolesOf(me);
  const modules = me?.tenant?.modules ?? {};
  const groups: NavGroup[] = me?.platform
    ? [{ title: "Platform", links: [{ href: "/platform", label: "Schools", roles: [] }, { href: "/platform/groups", label: "School groups", roles: [] }, { href: "/account/security", label: "Account security", roles: [] }] }]
    : me?.group && !me.profile
    ? [{ title: "Group", links: [{ href: "/group", label: "All branches", roles: [] }] }]
    : GROUPS.map(g => ({ ...g, links: g.links.filter(l => l.roles.some(r => roles.has(r)) && (!l.module || modules[l.module] !== false)) }))
        .filter(g => g.links.length);
  const closedState = me?.account?.state === "paused" || me?.account?.state === "suspended" ? me.account.state : me?.tenant?.status !== "active" && me?.tenant ? me.tenant.status : null;
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
            <button className="btn btn-ghost px-2 py-1 lg:hidden" onClick={() => setOpen(o => !o)} aria-label="Toggle navigation" aria-expanded={open}><Icon name="menu" className="h-5 w-5" /></button>
            <Link href={me?.platform ? "/platform" : "/dashboard"} className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-600 text-sm font-black text-white">E</span>
              <span className="text-sm font-bold">{me?.tenant?.name ?? (me?.platform ? "Platform console" : "EduClass Fusion")}</span>
            </Link>
          </div>
          <div className="flex items-center gap-3">
            {me?.profile && <SearchPalette pages={groups.flatMap(g => g.links)} />}
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
        {open && <div className="fixed inset-0 z-10 bg-slate-900/30 lg:hidden" aria-hidden onClick={() => setOpen(false)} />}
        <aside className={(open ? "fixed inset-y-0 left-0 z-20 block pt-16 shadow-xl" : "hidden") + " w-60 shrink-0 overflow-y-auto border-r border-slate-200 bg-white px-2 py-5 lg:sticky lg:top-[53px] lg:block lg:h-[calc(100vh-53px)] lg:pt-5"}>
          {nav}
        </aside>
        <div className="min-w-0 flex-1">
          {idleWarn && <div role="alert" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">You will be signed out in a minute because of inactivity. Move the mouse or press a key to stay signed in.</div>}
          {me?.prefs?.password_days_left != null && me.prefs.password_days_left <= 7 && me.prefs.password_days_left >= 0 && (
            <div role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">Your password expires in {me.prefs.password_days_left} day{me.prefs.password_days_left === 1 ? "" : "s"}. <Link href="/account/security#password" className="font-semibold underline">Change it now</Link></div>
          )}
          {closedState && (
            <div role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
              {closedState === "paused" ? "This school is closed for now." : "This school account is suspended."} {me?.account?.message ?? "Contact the school office."}
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}

/** Shown instead of the app when a school only lets staff in from its network or approved devices. */
function AccessBlocked({ message, device }: { message: string | null; device: string | null }) {
  return (
    <main className="mx-auto max-w-md px-6 py-20 text-center">
      <h1 className="text-xl font-semibold">Access restricted</h1>
      <p className="mt-2 text-slate-600">{message ?? "Your school restricts where staff pages can be opened."}</p>
      {device === "pending" && <p className="mt-2 text-sm text-slate-500">Your school admin can approve this device under Security &amp; sign-in. Then press Try again.</p>}
      <div className="mt-6 flex justify-center gap-2">
        <button className="btn btn-primary" onClick={() => window.location.reload()}>Try again</button>
        <button className="btn btn-outline" onClick={async () => { await createClient().auth.signOut(); window.location.href = "/login"; }}>Sign out</button>
      </div>
    </main>
  );
}
