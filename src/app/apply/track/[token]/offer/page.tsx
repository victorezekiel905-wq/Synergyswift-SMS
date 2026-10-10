"use client";
import { use, useEffect, useRef, useState } from "react";
import { useApi, send, fmtDate, money } from "@/components/ui";

type Data = {
  letter: { subject: string; body: string; issued_at: string; expires_on: string }; status: string; expired: boolean; accepted_at: string | null; signer_name: string | null; signature: string | null;
  letter_hash: string; acceptance_fee: number; acceptance_paid: boolean; currency: string; child: string; application_no: string;
  school: { name: string; logo_url: string | null; brand_color: string | null; address: string | null; phone: string | null; email: string | null; principal_signature_url: string | null; stamp_url: string | null };
};

/** Offer letter with online acceptance: the parent reads it, types their name and signs with a finger or mouse. */
export default function OfferPage(props: { params: Promise<{ token: string }> }) {
  const { token } = use(props.params);
  const { data, error, reload } = useApi<Data>(`/api/apply/track/${token}/offer`);
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio; c.height = c.offsetHeight * ratio;
    ctx.scale(ratio, ratio); ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#0f172a";
  }, [data]);
  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };

  if (error) return <main className="mx-auto max-w-2xl p-6"><p className="rounded-lg bg-slate-100 p-4">{error}</p></main>;
  if (!data) return <main className="p-10 text-center text-sm text-slate-500">Loading…</main>;
  const color = data.school.brand_color ?? "#1d5ddb";
  const signed = data.status !== "offered";
  return (
    <main className="mx-auto max-w-2xl bg-white p-4 sm:p-8 print:p-0">
      <header className="mb-4 flex items-center gap-3 border-b-4 pb-3" style={{ borderColor: color }}>
        {data.school.logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.school.logo_url} alt="" className="h-16 w-16 object-contain" />
        )}
        <div><p className="text-xl font-bold" style={{ color }}>{data.school.name}</p><p className="text-xs text-slate-600">{data.school.address}{data.school.phone ? ` · ${data.school.phone}` : ""}</p></div>
      </header>
      <p className="text-right text-sm text-slate-600">{fmtDate(data.letter.issued_at)} · Ref {data.application_no}</p>
      <h1 className="mt-3 text-lg font-bold">{data.letter.subject}</h1>
      <div className="mt-3 whitespace-pre-wrap font-serif leading-relaxed">{data.letter.body}</div>
      <div className="mt-4 flex items-end gap-4">
        {data.school.principal_signature_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.school.principal_signature_url} alt="Principal's signature" className="h-12 object-contain" />
        )}
        {data.school.stamp_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.school.stamp_url} alt="School stamp" className="h-16 w-16 object-contain opacity-80" />
        )}
      </div>
      {Number(data.acceptance_fee) > 0 && <p className="mt-4 rounded bg-amber-50 p-3 text-sm">Acceptance fee: <b>{money(data.acceptance_fee, data.currency)}</b> ({data.acceptance_paid ? "paid" : "payable after signing, from your application page"}).</p>}

      <section className="mt-6 rounded-lg border-2 p-4" style={{ borderColor: color }}>
        <h2 className="font-semibold">Acceptance</h2>
        {signed ? (
          data.accepted_at ? (<>
            <p className="text-sm">Accepted by <b>{data.signer_name}</b> on {fmtDate(data.accepted_at, true)}.</p>
            {data.signature && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.signature} alt={`Signature of ${data.signer_name}`} className="mt-2 h-20 rounded border border-slate-200 bg-white" />
            )}
            <p className="mt-1 text-[11px] text-slate-500">Letter fingerprint {data.letter_hash.slice(0, 16)}…</p>
          </>) : <p className="text-sm">This offer is {data.status}.</p>
        ) : data.expired ? <p className="text-sm text-rose-700">This offer expired on {fmtDate(data.letter.expires_on)}. Please contact the school.</p> : (
          <form className="space-y-3" onSubmit={async e => {
            e.preventDefault();
            if (!drawn) return setErr("Please sign in the box.");
            setBusy(true); setErr(null);
            const r = await send<{ acceptance_fee_due: boolean }>(`/api/apply/track/${token}/offer`, { signer_name: name, signature: canvas.current!.toDataURL("image/png"), letter_hash: data.letter_hash, agree });
            setBusy(false);
            if (!r.ok) return setErr(r.error);
            if (r.data.acceptance_fee_due) window.location.href = `/apply/track/${token}`; else reload();
          }}>
            <p className="text-sm">On behalf of {data.child}, I accept this offer and its terms.</p>
            <label className="block"><span className="label">Your full name</span><input className="input" required minLength={3} value={name} onChange={e => setName(e.target.value)} autoComplete="name" /></label>
            <div>
              <span className="label">Your signature</span>
              <canvas ref={canvas} className="h-32 w-full touch-none rounded border border-slate-300 bg-white" aria-label="Signature box: draw your signature"
                onPointerDown={e => { drawing.current = true; e.currentTarget.setPointerCapture(e.pointerId); const [x, y] = pos(e); const c = e.currentTarget.getContext("2d")!; c.beginPath(); c.moveTo(x, y); }}
                onPointerMove={e => { if (!drawing.current) return; const [x, y] = pos(e); const c = e.currentTarget.getContext("2d")!; c.lineTo(x, y); c.stroke(); setDrawn(true); }}
                onPointerUp={() => { drawing.current = false; }} />
              <button type="button" className="mt-1 text-xs text-slate-500 underline" onClick={() => { const c = canvas.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); setDrawn(false); }}>Clear</button>
            </div>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={agree} onChange={e => setAgree(e.target.checked)} required /> I have read the letter and agree that this electronic signature has the same effect as signing on paper.</label>
            {err && <p role="alert" className="text-sm text-rose-600">{err}</p>}
            <div className="flex flex-wrap gap-2">
              <button className="btn text-white" style={{ background: color }} disabled={busy}>{busy ? "Saving…" : "Sign and accept"}</button>
              <button type="button" className="btn btn-ghost" onClick={async () => {
                const reason = prompt("Decline the offer? You can tell us why (optional):");
                if (reason === null) return;
                const r = await send(`/api/apply/track/${token}`, { action: "decline_offer", reason: reason || null });
                if (r.ok) reload(); else setErr(r.error);
              }}>Decline</button>
            </div>
            <p className="text-[11px] text-slate-500">We record your name, the time, your IP address and browser with the exact letter you signed.</p>
          </form>
        )}
      </section>
      <div className="mt-4 flex justify-between text-sm print:hidden"><a className="text-brand-700 underline" href={`/apply/track/${token}`}>← Application page</a><button className="underline" onClick={() => window.print()}>Print / save as PDF</button></div>
    </main>
  );
}
