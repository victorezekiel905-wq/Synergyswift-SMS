"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { reloadOnceForStaleBuild, isStaleBuildError } from "@/lib/client-errors";

/** A page that failed in the browser: reload after a new version, otherwise say what went wrong and offer to try again. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [reloading, setReloading] = useState(false);
  useEffect(() => {
    console.error(error);
    if (reloadOnceForStaleBuild(error)) setReloading(true);
  }, [error]);
  if (reloading || isStaleBuildError(error)) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16 text-center">
        <h1 className="text-xl font-semibold">Synergy Swift was just updated</h1>
        <p className="mt-2 text-sm text-slate-600">Loading the new version…</p>
        <button className="btn btn-primary mt-5" onClick={() => window.location.reload()}>Reload now</button>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <h1 className="text-xl font-semibold">Something went wrong on this page</h1>
      <p className="mt-2 text-sm text-slate-600">Your work saved before this is safe. Try again; if it keeps happening, send the school office (or Synergy Swift) the line below.</p>
      <p className="mt-3 break-words rounded-md bg-slate-100 p-3 font-mono text-xs text-slate-700">{error.message || "Unknown error"}{error.digest ? ` · ref ${error.digest}` : ""}</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <button className="btn btn-primary" onClick={() => reset()}>Try again</button>
        <button className="btn btn-outline" onClick={() => window.location.reload()}>Reload the page</button>
        <Link href="/dashboard" className="btn btn-ghost">Go to my dashboard</Link>
      </div>
    </main>
  );
}
