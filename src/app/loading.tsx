/** Shown at once while a page that is built on the server (the dashboard, for example) is being prepared. */
export default function Loading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-live="polite">
      <span className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-brand-600" aria-hidden />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
