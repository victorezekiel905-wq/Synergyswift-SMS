"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Providers switched on in Supabase Auth, e.g. NEXT_PUBLIC_SSO_PROVIDERS=google,azure
const ENABLED = (process.env.NEXT_PUBLIC_SSO_PROVIDERS ?? "").split(",").map(s => s.trim()).filter(p => p === "google" || p === "azure") as ("google" | "azure")[];
export const ssoEnabled = ENABLED.length > 0;

/** Google Workspace and Microsoft 365 sign-in, for the providers this deployment has set up. */
export default function SsoButtons() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!ENABLED.length) return null;

  async function signIn(provider: "google" | "azure") {
    setBusy(provider); setError(null);
    const sb = createClient();
    const { error: authError } = await sb.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/dashboard`, scopes: provider === "azure" ? "email" : undefined }
    });
    if (authError) { setError(authError.message); setBusy(null); }
  }

  return (
    <div className="space-y-2">
      <div className={`grid gap-2 ${ENABLED.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
        {ENABLED.includes("google") && <button type="button" className="btn btn-outline" disabled={!!busy} onClick={() => signIn("google")}>{busy === "google" ? "Opening…" : "Continue with Google"}</button>}
        {ENABLED.includes("azure") && <button type="button" className="btn btn-outline" disabled={!!busy} onClick={() => signIn("azure")}>{busy === "azure" ? "Opening…" : "Continue with Microsoft"}</button>}
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}
