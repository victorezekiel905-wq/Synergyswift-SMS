import Link from "next/link";
import { Monogram } from "@/components/AppShell";
import { OTP_TYPES, safeNext, type OtpType } from "@/lib/auth-mail";

export const dynamic = "force-dynamic";

const COPY: Record<OtpType, { title: string; button: string }> = {
  signup: { title: "Confirm your email", button: "Confirm my email" },
  magiclink: { title: "Confirm your email", button: "Continue" },
  recovery: { title: "Reset your password", button: "Choose a new password" },
  invite: { title: "Set up your account", button: "Set up my account" },
  email_change: { title: "Confirm your new email", button: "Confirm my new email" }
};

/**
 * Where links in sign-in emails land. The one-time token is only spent when the
 * person presses the button: mail scanners that open links do not use it up.
 */
export default async function ConfirmPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const p = await searchParams;
  const type = (OTP_TYPES as string[]).includes(p.type ?? "") ? (p.type as OtpType) : null;
  const ok = Boolean(type && p.token_hash && /^[A-Za-z0-9_-]{10,200}$/.test(p.token_hash));
  const c = type ? COPY[type] : COPY.signup;
  return (
    <main className="mx-auto flex min-h-screen max-w-[400px] flex-col px-5 py-10 sm:py-16">
      <Link href="/" className="flex items-center gap-2.5 self-start"><Monogram /><span className="text-[15px] font-semibold tracking-tight">Synergy Swift</span></Link>
      <h1 className="mt-14 font-serif text-[30px] font-semibold leading-tight tracking-[-0.01em]">{c.title}</h1>
      {ok ? (
        <form method="post" action="/api/auth/confirm" className="card mt-7 space-y-5 p-6">
          <input type="hidden" name="token_hash" value={p.token_hash} />
          <input type="hidden" name="type" value={type!} />
          <input type="hidden" name="next" value={safeNext(p.next)} />
          <p className="text-[15px] text-slate-600 sm:text-sm">Press the button to carry on. The link works once.</p>
          <button className="btn btn-primary w-full">{c.button}</button>
        </form>
      ) : (
        <div className="card mt-7 space-y-3 p-6 text-sm text-slate-600">
          <p>This link is not complete. Open it again from the email, or ask for a new one from the sign-in page.</p>
          <Link href="/login" className="font-medium text-brand-600">Go to sign in</Link>
        </div>
      )}
    </main>
  );
}
