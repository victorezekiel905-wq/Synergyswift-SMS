"use client";
import { use, useState } from "react";
import { useApi, send, Alert, Loading, fmtDate } from "@/components/ui";
import SignaturePad from "@/components/SignaturePad";

type Data = {
  school: { school_name: string | null; logo_url: string | null; brand_color: string | null } | null; consent: string;
  request: { title: string; kind: string; body: string; due_on: string | null; status: string; fingerprint: string; document: { title: string; url: string | null } | null };
  signer: { name: string; status: string; signed_at: string | null; typed_name: string | null; child: string | null };
};

/** The private page where someone reads a form or contract and signs it (or declines). */
export default function SignPage(props: { params: Promise<{ token: string }> }) {
  const { token } = use(props.params);
  const { data, error, reload } = useApi<Data>(`/api/sign/${token}`);
  const [name, setName] = useState("");
  const [png, setPng] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (error) return <main className="mx-auto max-w-2xl p-6"><Alert>{error}</Alert></main>;
  if (!data) return <Loading />;
  const r = data.request, s = data.signer;
  const color = data.school?.brand_color ?? "#2f4f8f";
  const open = r.status === "open" && ["pending", "viewed"].includes(s.status);
  async function submit(body: Record<string, unknown>) {
    setBusy(true); setMsg(null);
    const res = await send(`/api/sign/${token}`, body);
    setBusy(false);
    if (!res.ok) setMsg(res.error); else reload();
  }
  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <header className="mb-5 flex items-center gap-3 rounded-xl p-4 text-white" style={{ background: color }}>
        {data.school?.logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.school.logo_url} alt="" className="h-10 w-10 rounded bg-white object-contain p-1" />
        )}
        <div><p className="font-bold">{data.school?.school_name ?? "School"}</p><p className="text-sm opacity-90">For {s.name}{s.child ? `, about ${s.child}` : ""}</p></div>
      </header>
      <article className="card space-y-3 p-5">
        <h1 className="text-[22px] font-serif font-semibold tracking-[-0.01em]">{r.title}</h1>
        {r.due_on && open && <p className="text-sm text-slate-500">Please sign by {fmtDate(r.due_on)}.</p>}
        {r.body && <div className="whitespace-pre-wrap text-sm leading-relaxed">{r.body}</div>}
        {r.document && <p className="text-sm">Attached: {r.document.url ? <a className="text-brand-700 underline" href={r.document.url} target="_blank" rel="noreferrer">{r.document.title}</a> : r.document.title} (read it before signing)</p>}
      </article>

      <section className="card mt-4 space-y-3 p-5">
        {msg && <Alert>{msg}</Alert>}
        {s.status === "signed" ? <Alert tone="green">Signed by {s.typed_name} on {fmtDate(s.signed_at, true)}. Thank you; you can close this page.</Alert>
          : s.status === "declined" ? <Alert tone="amber">You declined to sign. The school has been told.</Alert>
          : s.status === "not_needed" ? <Alert tone="green">Another parent has already signed this. Nothing more is needed.</Alert>
          : r.status === "cancelled" ? <Alert tone="amber">The school cancelled this request.</Alert>
          : r.status === "completed" ? <Alert tone="green">This has been completed.</Alert>
          : declining ? (
            <div className="space-y-2">
              <label className="block text-sm">Why are you not signing? (the school will see this)<textarea className="input mt-1" rows={3} value={reason} onChange={e => setReason(e.target.value)} /></label>
              <div className="flex gap-2"><button className="btn btn-outline" disabled={busy || reason.trim().length < 2} onClick={() => submit({ action: "decline", reason })}>Decline to sign</button>
                <button className="btn btn-ghost" onClick={() => setDeclining(false)}>Back</button></div>
            </div>
          ) : (
            <div className="space-y-3">
              <label className="block text-sm font-medium">Type your full name<input className="input mt-1" value={name} onChange={e => setName(e.target.value)} placeholder={s.name} autoComplete="name" /></label>
              <SignaturePad onChange={setPng} />
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={agree} onChange={e => setAgree(e.target.checked)} /><span>{data.consent}</span></label>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-primary" disabled={busy || !agree || name.trim().length < 2} onClick={() => submit({ action: "sign", agree, typed_name: name, signature_png: png })}>{busy ? "Signing…" : "Sign"}</button>
                <button className="btn btn-ghost" onClick={() => setDeclining(true)}>I do not want to sign</button>
              </div>
              <p className="text-xs text-slate-500">The time, your device and this document’s fingerprint ({r.fingerprint.slice(0, 16)}…) are recorded with your signature.</p>
            </div>
          )}
      </section>
    </main>
  );
}
