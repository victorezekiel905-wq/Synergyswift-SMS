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

  if (me.role === "student") {
    const { data: memberships } = await sb
      .from("class_members").select("class_id,classes(id,name,join_code)").eq("user_id", user.id);
    const classIds = (memberships ?? [])
      .map((m: { classes: { id: string } | null }) => m.classes?.id)
      .filter(Boolean) as string[];
    const { data: sessions } = classIds.length
      ? await sb.from("class_sessions")
          .select("id,mode,join_code,state,started_at,classes(name)")
          .in("class_id", classIds).in("state", ["scheduled", "live"])
          .order("created_at", { ascending: false }).limit(10)
      : { data: [] };
    const { data: myAnswers } = await sb
      .from("activity_responses").select("id,correct,awarded").eq("student_id", user.id).limit(500);

    const correct = (myAnswers ?? []).filter((a: { correct: boolean }) => a.correct).length;
    return (
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-10">
        <header className="mb-8">
          <p className="text-[13px] text-slate-500">Dashboard</p>
          <h1 className="text-[26px] font-serif font-semibold tracking-[-0.01em]">Welcome back, {me.full_name.split(" ")[0]}</h1>
          <Link href="/student" className="btn btn-primary mt-4">Go to my school</Link>
        </header>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="card px-4 py-3.5"><p className="text-[13px] text-slate-500">Classes</p><p className="mt-1 text-[26px] font-semibold leading-none tracking-tight tabular-nums">{memberships?.length ?? 0}</p></div>
          <div className="card px-4 py-3.5"><p className="text-[13px] text-slate-500">Answers submitted</p><p className="mt-1 text-[26px] font-semibold leading-none tracking-tight tabular-nums">{(myAnswers ?? []).length}</p></div>
          <div className="card px-4 py-3.5"><p className="text-[13px] text-slate-500">Accuracy</p><p className="mt-1 text-[26px] font-semibold leading-none tracking-tight tabular-nums">{(myAnswers ?? []).length ? Math.round((correct / (myAnswers ?? []).length) * 100) : 0}%</p></div>
        </section>

        <section className="card mt-6 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Your live sessions</h2>
            <Link href="/student/join" className="btn btn-primary text-xs">+ Join a class</Link>
          </div>
          {(sessions ?? []).length === 0 && <p className="py-6 text-center text-sm text-slate-400">No upcoming sessions.</p>}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {(sessions ?? []).map((s: { id: string; mode: string; join_code: string; state: string; classes: { name: string } | null }) => (
              <div key={s.id} className={s.state === "live" ? "rounded-lg border border-brand-200 bg-brand-50 p-4" : "rounded-lg border border-slate-200 p-4"}>
                <div className="flex items-center justify-between">
                  <p className="font-semibold">{s.classes?.name ?? "Class"}</p>
                  <span className={"rounded-full px-2 py-0.5 text-xs " + (s.state === "live" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600")}>{s.state}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">Mode: {s.mode} · Code: {s.join_code}</p>
                {s.state === "live" && <Link href={`/student/live/${s.id}`} className="btn btn-primary mt-3 w-full text-xs">Open lesson</Link>}
              </div>
            ))}
          </div>
        </section>
      </main>
    );
  }

  // Teacher / admin dashboard
  const [{ data: classes }, { data: lessons }, { data: sessions }, { data: devices }, { data: envEvents }] = await Promise.all([
    sb.from("classes").select("id,name,join_code").order("created_at", { ascending: false }).limit(10),
    sb.from("lessons").select("id,title,status").order("created_at", { ascending: false }).limit(10),
    sb.from("class_sessions").select("id,state,join_code,started_at,classes(name)").order("created_at", { ascending: false }).limit(10),
    sb.from("devices").select("id,status,last_seen_at").limit(200),
    sb.from("environment_events").select("id,severity,acknowledged,ts,students:users!environment_events_student_id_fkey(full_name)").order("ts", { ascending: false }).limit(10)
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

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {[
          { label: "Classes", value: classes?.length ?? 0, href: "/teacher/classes" },
          { label: "Lessons", value: lessons?.length ?? 0, href: "/teacher/studio" },
          { label: "Sessions", value: sessions?.length ?? 0, href: "/teacher/live" },
          { label: "Devices online", value: online, href: "/teacher/guard" },
          { label: "Alerts to check", value: critical, href: "/teacher/live" }
        ].map(c => (
          <Link key={c.label} href={c.href} className="card px-4 py-3.5 transition-colors hover:border-slate-300">
            <p className="text-[13px] text-slate-500">{c.label}</p>
            <p className="mt-1 text-[26px] font-semibold leading-none tracking-tight tabular-nums">{c.value}</p>
          </Link>
        ))}
      </section>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-3 text-base font-semibold">Recent sessions</h2>
          {(sessions ?? []).length === 0 && <p className="py-4 text-sm text-slate-400">No sessions yet. Start one from Live class.</p>}
          <ul className="divide-y divide-slate-100">
            {(sessions ?? []).map((s: { id: string; state: string; join_code: string; started_at: string | null; classes: { name: string } | null }) => (
              <li key={s.id} className="flex items-center justify-between py-2.5 text-sm">
                <span>{s.classes?.name ?? "Class"} <span className="font-mono text-xs text-slate-400">{s.join_code}</span></span>
                <span className={"rounded px-1.5 py-0.5 text-[11.5px] font-medium ring-1 ring-inset " + (s.state === "live" ? "bg-emerald-50 text-emerald-800 ring-emerald-600/20" : "bg-slate-50 text-slate-600 ring-slate-500/20")}>{s.state}</span>
              </li>
            ))}
          </ul>
          <Link href="/teacher/live" className="btn btn-ghost mt-3 w-full text-xs">Open Live class</Link>
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
