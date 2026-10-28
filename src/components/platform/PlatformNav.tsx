"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/platform/centre", label: "Overview" },
  { href: "/platform", label: "Schools" },
  { href: "/platform/codes", label: "Onboarding codes" },
  { href: "/platform/signups", label: "Sign-ups" },
  { href: "/platform/sales", label: "Sales & customers" },
  { href: "/platform/billing", label: "Billing & requests" },
  { href: "/platform/plans", label: "Plans & prices" },
  { href: "/platform/team", label: "Platform team" },
  { href: "/platform/groups", label: "School groups" }
];

/** Sections of the Synergy Swift platform console. */
export default function PlatformNav() {
  const path = usePathname();
  const active = (h: string) => (h === "/platform" ? path === "/platform" || /^\/platform\/[0-9a-f-]{36}/.test(path) || path === "/platform/new" : path.startsWith(h));
  return (
    <nav className="mb-6 flex flex-wrap gap-1 border-b border-slate-200" aria-label="Platform">
      {LINKS.map(l => (
        <Link key={l.href} href={l.href} aria-current={active(l.href) ? "page" : undefined}
          className={"-mb-px border-b-2 px-3 py-2 text-sm " + (active(l.href) ? "border-brand-600 font-semibold text-slate-900" : "border-transparent text-slate-600 hover:text-slate-900")}>{l.label}</Link>
      ))}
    </nav>
  );
}
