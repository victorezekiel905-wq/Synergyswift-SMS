import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";

/** The public site's few menus. "Join a class" is for students with a lesson code: no account needed. */
const NAV: [string, string][] = [["/features", "Features"], ["/tour", "Take a tour"], ["/live/join", "Join a class"]];

/** The logo as on the brand sheet: the mark, then the name in Plex Serif. */
export function Wordmark({ onDark = false, small = false }: { onDark?: boolean; small?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <BrandMark className={small ? "h-6 w-6" : "h-8 w-8"} onDark={onDark} />
      <span className={`whitespace-nowrap font-serif font-semibold tracking-[-0.01em] ${small ? "text-[15px]" : "text-[17px]"} ${onDark ? "text-white" : "text-navy"}`}>Synergy Swift</span>
    </span>
  );
}

export function SiteHeader({ current }: { current?: string }) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-5 sm:gap-8 sm:px-8">
        <Link href="/" aria-label="Synergy Swift home" className="no-underline"><Wordmark /></Link>
        <nav aria-label="Main" className="hidden items-center gap-7 text-[13.5px] text-slate-600 lg:flex">
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} aria-current={current === href ? "page" : undefined}
              className={`no-underline hover:text-navy ${current === href ? "font-medium text-navy" : ""}`}>{label}</Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <Link href="/login" className="btn btn-ghost hidden px-3 text-[13.5px] no-underline sm:inline-flex">Sign in</Link>
          <Link href="/onboard" className="btn bg-navy px-4 text-[13.5px] text-white no-underline hover:bg-brand-900">Sign up</Link>
          {/* Phones: the same menus in a drawer that works without JavaScript. */}
          <details className="ss-menu group relative lg:hidden">
            <summary className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 [&::-webkit-details-marker]:hidden" aria-label="Menu">
              <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M3 6h14M3 10h14M3 14h14" className="group-open:hidden" /><path d="M5 5l10 10M15 5L5 15" className="hidden group-open:block" /></svg>
            </summary>
            <nav aria-label="Main" className="absolute right-0 top-11 w-56 rounded-lg border border-slate-200 bg-white p-1.5 text-sm shadow-pop">
              {[...NAV, ["/login", "Sign in"] as [string, string]].map(([href, label]) => (
                <Link key={href} href={href} className="block rounded-md px-3 py-2 text-slate-700 no-underline hover:bg-slate-50 hover:text-navy">{label}</Link>
              ))}
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  const cols: [string, [string, string][]][] = [
    ["Product", [["/features", "Features"], ["/tour", "Take a tour"], ["/demo", "Book a walk-through"]]],
    ["Schools", [["/onboard", "Sign up your school"], ["/login", "Sign in"]]],
    ["Students and parents", [["/live/join", "Join a class as a guest"], ["/student/join", "Student account"], ["/login", "Parent sign-in"]]]
  ];
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 text-[13px] sm:px-8 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <div>
          <Wordmark small />
          <p className="mt-4 max-w-xs leading-relaxed text-slate-500">School management and learning for primary and secondary schools.</p>
        </div>
        {cols.map(([title, links]) => (
          <div key={title}>
            <p className="font-medium text-slate-900">{title}</p>
            <ul className="mt-3 space-y-2 text-slate-500">{links.map(([href, label]) => <li key={label}><Link href={href} className="text-slate-500 no-underline hover:text-navy">{label}</Link></li>)}</ul>
          </div>
        ))}
      </div>
      <div className="border-t border-slate-200">
        <p className="mx-auto max-w-6xl px-5 py-6 text-[12px] text-slate-500 sm:px-8">© {new Date().getFullYear()} Synergy Swift Technologies Limited</p>
      </div>
    </footer>
  );
}

/** A section heading in the house style: a short muted label, then the serif title. */
export function SectionTitle({ label, title, text, onDark = false }: { label: string; title: string; text?: string; onDark?: boolean }) {
  return (
    <div className="max-w-2xl">
      <p className={`flex items-center gap-3 text-[13px] ${onDark ? "text-brass-300" : "text-brass-700"}`}><span aria-hidden className="h-px w-6 bg-current" />{label}</p>
      <h2 className={`mt-4 font-serif text-[30px] font-semibold leading-[1.15] tracking-[-0.015em] sm:text-[36px] ${onDark ? "text-white" : "text-navy"}`}>{title}</h2>
      {text && <p className={`mt-4 text-[16px] leading-relaxed ${onDark ? "text-white/70" : "text-slate-600"}`}>{text}</p>}
    </div>
  );
}
