/**
 * Settings typed on the hosting dashboard under a friendlier name still count:
 * "Service-Role-Key" fills SUPABASE_SERVICE_ROLE_KEY, "Gemini_API_Key" fills
 * GEMINI_API_KEY, and so on. Names are compared ignoring case, dashes and
 * underscores. The exact name always wins when it is set. Run once at server
 * start (src/instrumentation.ts), before any request reads the settings.
 */
const ALIASES: Record<string, string[]> = {
  SUPABASE_SERVICE_ROLE_KEY: ["servicerolekey", "supabasesecretkey", "supabaseservicekey", "secretkey", "servicekey"],
  GEMINI_API_KEY: ["geminikey", "geminiapi"],
  CANVA_CLIENT_ID: ["canvaid"],
  CANVA_CLIENT_SECRET: ["canvasecret"],
  PIXABAY_API_KEY: ["pixabayapi", "pixabaykey", "pixalbayapi", "pixalbayapikey", "pixalbaykey"]
};

const squash = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Fills each missing setting from a differently written one; returns which were filled, and from what. */
export function applyEnvAliases(env: Record<string, string | undefined> = process.env): [string, string][] {
  const filled: [string, string][] = [];
  for (const [name, also] of Object.entries(ALIASES)) {
    if (env[name]?.trim()) continue;
    const wanted = new Set([squash(name), ...also]);
    const from = Object.keys(env).find(k => k !== name && wanted.has(squash(k)) && env[k]?.trim());
    if (from) { env[name] = env[from]!.trim(); filled.push([name, from]); }
  }
  return filled;
}
