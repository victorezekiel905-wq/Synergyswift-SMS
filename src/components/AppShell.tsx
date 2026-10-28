"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Icon, rolesOf, type Me } from "@/components/ui";
import SearchPalette from "@/components/SearchPalette";
import { EmergencyBanner } from "@/components/comms/NoticeBoard";
import NativeBridge, { forgetDevice } from "@/components/NativeBridge";
import { claimDevice } from "@/components/offline";

import { NAV, PLATFORM_NAV, visibleNav, bottomBar, type NavGroup } from "@/lib/nav";
import SideNav, { BottomBar } from "@/components/SideNav";
import { BrandMark } from "@/components/BrandMark";

// Pages that render without the app chrome (public links, kiosk, exam lockdown).
const BARE = [/^\/sign\//, /^\/login$/, /^\/signup$/, /^\/onboard$/, /^\/how-it-works$/, /^\/billing\//, /^\/student\/join$/, /^\/r\//, /^\/g\//, /^\/exam\//, /^\/auth\//, /^\/school\/gate\/kiosk/, /^\/school\/gate\/clock-code/, /^\/clock$/, /^\/results\/check\//, /^\/p\/[0-9a-f]{40}$/,/^\/school\/elections\/[^/]+\/kiosk/, /^\/demo$/, /^\/give\//, /^\/pay\//, /^\/apply\//, /^\/careers\//, /^\/enquire\//, /^\/visit\//, /^\/entrance\//, /^\/t\//, /^\/s\//, /^\/unsubscribe\//, /^\/alumni\//, /^\/v\//, /^\/n\//, /\/print$/, /\/transcript$/,
  // Live lessons: the projector view, students in a lesson or game, and guests joining by code are full screen.
  /^\/live\/present\//, /^\/live\/student\/(live|game)\//, /^\/live\/guest\//, /^\/live\/join/];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const [idleWarn, setIdleWarn] = useState(false);
  const lastActive = useRef(Date.now());
  // The public home page has its own header; signed-in visitors are sent on to their dashboard.
  const landing = pathname === "/";
  const bare = landing || BARE.some(r => r.test(pathname));
  // Lite mode (set on My learning) is kept per device.
  useEffect(() => { try { document.documentElement.dataset.lite = localStorage.getItem("ecf-lite") === "1" ? "1" : ""; } catch { /* storage unavailable */ } }, []);

  useEffect(() => {
    if (bare && !landing) return;
    fetch("/api/me").then(r => r.json()).catch(() => ({})).then(async (j: Me) => {
      // Design review builds show the shell with a sample head teacher.
      if (process.env.NEXT_PUBLIC_DESIGN_PREVIEW === "1" && pathname.startsWith("/design-preview") && !j?.profile) { setMe(PREVIEW_ME); return; }
      setMe(j);
      if (j.user?.id) claimDevice(j.user.id);
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
    // This device stops getting the person's notifications.
    await forgetDevice();
    await createClient().auth.signOut();
    // Class lists, unsent registers and saved copies kept for offline use belong to this user only.
    try { Object.keys(localStorage).filter(k => k.startsWith("educlass:")).forEach(k => localStorage.removeItem(k)); } catch { /* storage blocked */ }
    router.push("/login");
    router.refresh();
  }

  const roles = rolesOf(me);
  const modules = me?.tenant?.modules ?? {};
  const groups: NavGroup[] = me?.platform
    ? PLATFORM_NAV
    : me?.group && !me.profile
    ? [{ id: "group", title: "Group", links: [{ href: "/group", label: "All branches", roles: [] }] }]
    : visibleNav(roles, modules, NAV);
  const closedState = me?.account?.state === "paused" || me?.account?.state === "suspended" ? me.account.state : me?.tenant?.status !== "active" && me?.tenant ? me.tenant.status : null;
  const nav = <SideNav groups={groups} path={pathname} userKey={me?.user?.id ?? "anon"} />;
  const quick = me?.profile && !me.platform ? bottomBar(roles, modules) : [];
  const initials = (me?.profile?.full_name ?? "").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join("");

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="flex h-14 items-center justify-between gap-4 px-4 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <button className="btn btn-ghost -ml-1.5 px-2 py-1.5 lg:hidden" onClick={() => setOpen(o => !o)} aria-label="Toggle navigation" aria-expanded={open}><Icon name="menu" className="h-5 w-5" /></button>
            <Link href={me?.platform ? "/platform" : "/dashboard"} className="flex min-w-0 items-center gap-2.5">
              <Monogram />
              <span className="truncate text-[15px] font-semibold tracking-tight text-slate-900">{me?.tenant?.name ?? (me?.platform ? "Synergy Swift platform" : "Synergy Swift")}</span>
            </Link>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            {me?.profile && <SearchPalette pages={groups.flatMap(g => g.links)} />}
            {me?.profile && (
              <span className="hidden items-center gap-2.5 sm:flex">
                <span className="text-right leading-tight">
                  <span className="block text-[13px] font-medium text-slate-800">{me.profile.full_name}</span>
                  <span className="block text-xs capitalize text-slate-500">{me.profile.role.replace(/_/g, " ")}</span>
                </span>
                <span aria-hidden className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700 ring-1 ring-inset ring-slate-200">{initials || "·"}</span>
              </span>
            )}
            <button onClick={signOut} className="btn btn-ghost px-2.5 text-[13px] text-slate-600" title="Sign out"><Icon name="logout" className="h-4 w-4" /><span className="hidden md:inline">Sign out</span></button>
          </div>
        </div>
      </header>
      <div className="flex">
        {open && <div className="fixed inset-0 z-10 bg-slate-950/30 lg:hidden" aria-hidden onClick={() => setOpen(false)} />}
        <aside className={(open ? "fixed inset-y-0 left-0 z-20 block pt-[72px] shadow-pop" : "hidden") + " w-60 shrink-0 overflow-y-auto border-r border-slate-200 bg-white px-2.5 pb-24 pt-5 lg:sticky lg:pb-5 lg:top-14 lg:block lg:h-[calc(100vh-3.5rem)] lg:pt-6"}>
          {nav}
        </aside>
        <div className="min-w-0 flex-1">
          {me?.profile && !me.platform && <EmergencyBanner />}
          {idleWarn && <div role="alert" className="border-b border-amber-200 bg-amber-50 px-5 py-2.5 text-[13px] text-amber-950">You will be signed out in a minute because of inactivity. Move the mouse or press a key to stay signed in.</div>}
          {me?.prefs?.password_days_left != null && me.prefs.password_days_left <= 7 && me.prefs.password_days_left >= 0 && (
            <div role="status" className="border-b border-amber-200 bg-amber-50 px-5 py-2.5 text-[13px] text-amber-950">Your password expires in {me.prefs.password_days_left} day{me.prefs.password_days_left === 1 ? "" : "s"}. <Link href="/account/security#password" className="font-semibold underline">Change it now</Link></div>
          )}
          {closedState && (
            <div role="status" className="border-b border-amber-200 bg-amber-50 px-5 py-2.5 text-[13px] text-amber-950">
              {closedState === "paused" ? "This school is closed for now." : "This school account is suspended."} {me?.account?.message ?? "Contact the school office."}
            </div>
          )}
          <div className={quick.length ? "pb-16 lg:pb-0" : ""}>{children}</div>
          <NativeBridge enabled={Boolean(me?.profile)} />
          <BottomBar items={quick} path={pathname} onMenu={() => setOpen(true)} />
        </div>
      </div>
    </div>
  );
}

const PREVIEW_ME = {
  user: { id: "preview", email: "head@example.com" }, platform: false, is_guardian: false,
  profile: { id: "preview", tenant_id: "preview", full_name: "Folake Adebayo", role: "principal", extra_roles: [] },
  tenant: { id: "preview", name: "Greenfield College", status: "active", modules: {} }
} as Me;

/** The product mark (see BrandMark). `solid` for the 16 px sizes. */
export function Monogram({ size = "h-8 w-8", solid = false }: { size?: string; solid?: boolean }) {
  return <BrandMark className={size} solid={solid} />;
}

/** Shown instead of the app when a school only lets staff in from its network or approved devices. */
function AccessBlocked({ message, device }: { message: string | null; device: string | null }) {
  return (
    <main className="mx-auto max-w-md px-6 py-20 text-center">
      <h1 className="text-[22px] font-serif font-semibold tracking-[-0.01em]">Access restricted</h1>
      <p className="mt-2 text-slate-600">{message ?? "Your school restricts where staff pages can be opened."}</p>
      {device === "pending" && <p className="mt-2 text-sm text-slate-500">Your school admin can approve this device under Security &amp; sign-in. Then press Try again.</p>}
      <div className="mt-6 flex justify-center gap-2">
        <button className="btn btn-primary" onClick={() => window.location.reload()}>Try again</button>
        <button className="btn btn-outline" onClick={async () => { await createClient().auth.signOut(); window.location.href = "/login"; }}>Sign out</button>
      </div>
    </main>
  );
}
