/** Runs once when the server starts: settings typed under other names count (lib/env-aliases.ts). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { applyEnvAliases } = await import("@/lib/env-aliases");
  for (const [name, from] of applyEnvAliases()) console.log(`settings: ${name} taken from ${from}`);
}

/**
 * Every crash in a page or API route on the server goes to the platform's error log (lib/error-log.ts),
 * grouped by kind; the platform admins are emailed the first time a kind appears.
 */
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routePath?: string; routeType?: string }
) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { logError } = await import("@/lib/error-log");
    const e = err as { message?: string; stack?: string; digest?: string };
    await logError("server", e?.message ?? String(err), `${request.method} ${context?.routePath ?? request.path.split("?")[0]}`, e?.stack ?? e?.digest ?? null);
  } catch { /* never fail the request because of logging */ }
}
