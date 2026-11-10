"use client";
import { useState } from "react";
import { send } from "@/components/ui";
import { formatCode, isCodeShape, cleanCode } from "@/lib/sign-up-codes";

/** A parent adds another child with that child's parent code from the school (migration 9600). */
export default function AddChild({ onAdded }: { onAdded?: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <section className="card space-y-3 p-5">
      <div>
        <h2 className="font-semibold">Add a child</h2>
        <p className="mt-1 text-sm text-slate-600">Type the parent code the school gave you for the child (8 letters and numbers). Their results, attendance and fees then show on your page.</p>
      </div>
      <form className="flex flex-wrap gap-2" onSubmit={async e => {
        e.preventDefault();
        if (!isCodeShape(code)) { setMsg({ ok: false, text: "A parent code has 8 letters and numbers, like ABCD-EFGH." }); return; }
        setBusy(true); setMsg(null);
        const r = await send<{ already: boolean; name: string | null }>("/api/parent/children", { code: cleanCode(code) });
        setBusy(false);
        if (!r.ok) { setMsg({ ok: false, text: r.error ?? "Please try again." }); return; }
        setMsg({ ok: true, text: r.data.already ? `${r.data.name ?? "This child"} is already on your page.` : `${r.data.name ?? "Your child"} is now on your page.` });
        setCode("");
        if (!r.data.already) { onAdded?.(); setTimeout(() => window.location.reload(), 1200); }
      }}>
        <input className="input w-44 text-center font-mono uppercase tracking-[0.2em]" placeholder="ABCD-EFGH" maxLength={9} value={code} autoComplete="off" spellCheck={false}
          onChange={e => setCode(formatCode(e.target.value))} aria-label="Parent code" />
        <button className="btn btn-primary" disabled={busy}>{busy ? "Adding…" : "Add child"}</button>
      </form>
      {msg && <p role="status" className={"text-sm " + (msg.ok ? "text-emerald-700" : "text-rose-600")}>{msg.text}</p>}
    </section>
  );
}
