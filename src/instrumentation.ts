/** Runs once when the server starts: settings typed under other names count (lib/env-aliases.ts). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { applyEnvAliases } = await import("@/lib/env-aliases");
  for (const [name, from] of applyEnvAliases()) console.log(`settings: ${name} taken from ${from}`);
}
