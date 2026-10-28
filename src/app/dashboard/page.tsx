import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import MyExamTimetable from "@/components/exams/MyExamTimetable";
import NoticeBoard from "@/components/comms/NoticeBoard";
import MyTeaching from "@/components/portal/MyTeaching";

export default async function Dashboard() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await sb.from("users").select("id,tenant_id,role,full_name").eq("id", user.id).maybeSingle();
  if (!me) {
    const { data: state } = await sb.rpc("my_account_state");
    if (state?.state === "suspended" || state?.state === "paused" || state?.state === "deactivated") {
      return (
        <main className="mx-auto max-w-xl px-6 py-16 text-center">
          <h1 className="text-[26px] font-serif font-semibold tracking-[-0.01em]">{state.state === "paused" ? `${state.school} is closed for now` : state.state === "suspended" ? "School account suspended" : "Account deactivated"}</h1>
          <p className="mt-2 text-slate-600">{state.state === "deactivated" ? "Please contact your school office to restore access." : state.message || (state.state === "paused" ? "Please check back later or contact the school office." : `${state.school} is not available right now. Please contact the school office.`)}</p>
        </main>
      );
    }
    if (state?.state === "mfa_required") redirect("/account/security?required=school");
    const { data: platform } = await sb.rpc("platform_admin_state");
    if (platform === "mfa_required") redirect("/account/security?required=platform");
    redirect(platform === "ok" ? "/platform" : "/student/join");
  }
  if (me.role === "parent") redirect("/parent");
  if (me.role === "cashier") redirect("/school/shop");
  // School operations roles land on the school overview; teachers keep the teaching dashboard.
  if (!["student", "teacher", "it_admin"].includes(me.role)) redirect("/school");

  // Students have their own day page (timetable, homework, live lessons).
  if (me.role === "student") redirect("/student");

  // Teacher dashboard. Live lessons and games live in the live module (/live/teacher).
  const [{ data: devices }, { data: envEvents }] = await Promise.all([
    sb.from("devices").select("id,status,last_seen_at").limit(200),
    sb.from("environment_events").select("id,kind,severity,acknowledged,ts,students:users!environment_events_student_id_fkey(full_name)").order("ts", { ascending: false }).limit(10)
  ]);
  const online = (devices ?? []).filter((d: { status: string; last_seen_at: string | null }) => d.status === "active" && d.last_seen_at && Date.now() - new Date(d.last_seen_at).getTime() < 120_000).length;
  const critical = (envEvents ?? []).filter((e: { severity: string; acknowledged: boolean }) => e.severity === "critical" && !e.acknowledged).length;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-10">
      <header className="mb-8">
        <p className="text-[13px] text-slate-500">Dashboard</p>
        <h1 className="text-[26px] font-serif font-semibold tracking-[-0.01em]">Welcome back, {me.full_name.split(" ")[0]}</h1>
        <div className="mt-4 flex flex-wrap gap-2"><Link href="/school/results" className="btn btn-primary">Enter scores</Link><Link href="/teacher" className="btn btn-outline">My teaching day</Link><Link href="/exams" className="btn btn-outline">Exams</Link></div>
      </header>

      <NoticeBoard />
      <MyTeaching compact />
      <MyExamTimetable />

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "Live lessons", value: "Start", href: "/live/teacher/live" },
          { label: "My lessons", value: "Open", href: "/live/teacher/lessons" },
          { label: "Devices online", value: online, href: "/teacher/guard" },
          { label: "Alerts to check", value: critical, href: "/teacher/guard" }
        ].map(c => (
          <Link key={c.label} href={c.href} className="card px-4 py-3.5 transition-colors hover:border-slate-300">
            <p className="text-[13px] text-slate-500">{c.label}</p>
            <p className="mt-1 text-[26px] font-semibold leading-none tracking-tight tabular-nums">{c.value}</p>
          </Link>
        ))}
      </section>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-1 text-base font-semibold">Live lessons and games</h2>
          <p className="text-sm text-slate-600">Build a lesson with slides and activities, present it on the projector, and let the class answer on their phones. Students can join as guests with the code.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/live/teacher/lessons" className="btn btn-outline text-xs">My lessons</Link>
            <Link href="/live/teacher/live" className="btn btn-outline text-xs">Start a live lesson</Link>
            <Link href="/live/teacher/challenge" className="btn btn-outline text-xs">Games</Link>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="mb-3 text-base font-semibold">Recent device alerts</h2>
          {(envEvents ?? []).length === 0 && <p className="py-4 text-sm text-slate-400">No alerts yet.</p>}
          <ul className="divide-y divide-slate-100">
            {(envEvents ?? []).map((e: { id: string; kind: string; severity: string; acknowledged: boolean; ts: string; students: { full_name: string } | null }) => (
              <li key={e.id} className="flex items-center justify-between py-2.5 text-sm">
                <span>{e.students?.full_name ?? "Student"} · {e.kind}</span>
                <span className={"rounded px-1.5 py-0.5 text-[11.5px] font-medium ring-1 ring-inset " + (e.severity === "critical" ? "bg-rose-50 text-rose-800 ring-rose-600/20" : e.severity === "warn" ? "bg-amber-50 text-amber-800 ring-amber-600/25" : "bg-slate-50 text-slate-600 ring-slate-500/20")}>{e.severity}{e.acknowledged ? " · acked" : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
