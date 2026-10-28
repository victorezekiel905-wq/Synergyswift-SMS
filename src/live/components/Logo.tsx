import Link from "next/link";
import { cn } from "@/live/lib/utils";
import { BrandMark } from "@/components/BrandMark";

/** The Synergy Swift mark, shared with the rest of the platform. */
export function LogoMark({ className, onDark = false }: { className?: string; onDark?: boolean }) {
  return <BrandMark className={cn("h-8 w-8", className)} onDark={onDark} />;
}

export function Logo({ href = "/", compact = false, onDark = false, className, wordmarkClassName }: {
  href?: string; compact?: boolean; onDark?: boolean; className?: string;
  /** e.g. hide the word on the narrowest phones, where the header buttons need the room. */
  wordmarkClassName?: string;
}) {
  return (
    <Link href={href} className={cn("flex items-center gap-2.5 no-underline", onDark ? "text-white hover:text-white" : "text-ink-900 hover:text-ink-900", className)} aria-label="Synergy Swift home">
      <LogoMark onDark={onDark} />
      {!compact && <span className={cn("font-display text-[17px] font-extrabold tracking-tight", wordmarkClassName)}>Synergy Swift</span>}
    </Link>
  );
}
