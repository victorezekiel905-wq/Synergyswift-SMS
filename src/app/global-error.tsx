"use client";
import { useEffect } from "react";
import { reloadOnceForStaleBuild, isStaleBuildError } from "@/lib/client-errors";

/** The last line of defence (the app's frame itself failed): plain markup, no app styles needed. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); reloadOnceForStaleBuild(error); }, [error]);
  const stale = isStaleBuildError(error);
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#f8fafc", color: "#0f172a", margin: 0 }}>
        <main style={{ maxWidth: 520, margin: "0 auto", padding: "64px 24px" }}>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>{stale ? "Synergy Swift was just updated" : "Something went wrong"}</h1>
          <p style={{ fontSize: 14, color: "#475569" }}>{stale ? "Loading the new version…" : "Try again. If it keeps happening, send Synergy Swift the line below."}</p>
          {!stale && <p style={{ fontFamily: "monospace", fontSize: 12, background: "#f1f5f9", padding: 12, borderRadius: 6, wordBreak: "break-word" }}>{error.message || "Unknown error"}{error.digest ? ` · ref ${error.digest}` : ""}</p>}
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            {!stale && <button onClick={() => reset()} style={{ padding: "8px 14px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#0f172a", color: "#fff" }}>Try again</button>}
            <button onClick={() => window.location.reload()} style={{ padding: "8px 14px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff" }}>Reload the page</button>
          </div>
        </main>
      </body>
    </html>
  );
}
