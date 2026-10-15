"use client";
import { use, useEffect, useState } from "react";
import { useApi } from "@/components/ui";
import QrCode from "@/components/QrCode";

type Data = {
  certificate: { kind: string; serial_no: string; issued_on: string; title: string; body: string; student: string | null; admission_no: string | null;
    signer_name: string | null; signer_title: string | null; status: string; revoked_reason: string | null };
  genuine: boolean; altered: boolean;
  school: { name: string; motto: string | null; address: string | null; logo_url: string | null; brand_color: string | null; signature_url: string | null; stamp_url: string | null };
};
const long = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

/** A certificate as printed, with a banner saying whether it is genuine. The QR code on it leads back here. */
export default function CertificatePage(props: { params: Promise<{ token: string }> }) {
  const { token } = use(props.params);
  const { data, error } = useApi<Data>(`/api/v/${token}`);
  const [url, setUrl] = useState("");
  useEffect(() => setUrl(window.location.href.split("?")[0]), []);
  if (error) return <main className="mx-auto max-w-xl p-6"><p className="rounded-lg bg-rose-50 p-4 text-rose-800">{error} It may have been mistyped, or it is not a certificate from this system.</p></main>;
  if (!data) return <main className="p-10 text-center text-sm text-slate-500">Checking…</main>;
  const c = data.certificate, s = data.school;
  const color = s.brand_color ?? "#1d5ddb";
  const award = ["award", "attendance", "participation", "completion", "custom"].includes(c.kind);
  return (
    <main className="mx-auto max-w-4xl p-4 print:p-0">
      <div className={"mb-4 rounded-lg p-3 text-sm print:hidden " + (data.genuine ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-900")} role="status">
        {data.genuine ? <><b>Genuine.</b> This certificate was issued by {s.name} and has not been changed.</>
          : c.status === "revoked" ? <><b>Revoked.</b> {s.name} has withdrawn this certificate{c.revoked_reason ? `: ${c.revoked_reason}` : ""}.</>
          : <><b>Warning.</b> These details do not match what {s.name} issued. Do not rely on this certificate; contact the school.</>}
        <button className="ml-3 underline" onClick={() => window.print()}>Print</button>
      </div>
      <article className={"relative mx-auto bg-white p-10 shadow print:shadow-none " + (award ? "aspect-[1.414] border-[10px]" : "border")} style={{ borderColor: award ? color : undefined }}>
        <header className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {s.logo_url && <img src={s.logo_url} alt="" className="mx-auto mb-2 h-16 w-16 object-contain" />}
          <p className="text-xl font-bold uppercase tracking-wide" style={{ color }}>{s.name}</p>
          {s.motto && <p className="text-xs italic text-slate-500">{s.motto}</p>}
          {s.address && <p className="text-xs text-slate-500">{s.address}</p>}
          <h1 className={"mt-6 font-serif " + (award ? "text-4xl" : "text-2xl")}>{c.title}</h1>
          {award && c.student && <p className="mt-4 font-serif text-3xl" style={{ color }}>{c.student}</p>}
        </header>
        <div className={"mt-6 whitespace-pre-wrap leading-relaxed " + (award ? "text-center text-lg" : "text-[15px]")}>{c.body}</div>
        <footer className="mt-10 flex items-end justify-between gap-6">
          <div className="text-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {s.signature_url && <img src={s.signature_url} alt="Signature" className="h-12 object-contain" />}
            <p className="border-t border-slate-400 pt-1 font-semibold">{c.signer_name ?? ""}</p>
            <p className="text-xs text-slate-500">{c.signer_title ?? ""}</p>
            <p className="mt-2 text-xs text-slate-500">Issued {long(c.issued_on)} · No. {c.serial_no}</p>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {s.stamp_url && <img src={s.stamp_url} alt="School stamp" className="h-20 w-20 object-contain opacity-80" />}
          <div className="text-center">
            {url && <QrCode value={url} size={96} />}
            <p className="mt-1 text-[10px] text-slate-500">Scan to check this certificate</p>
          </div>
        </footer>
        {c.status === "revoked" && <p className="absolute inset-0 grid place-items-center text-7xl font-black uppercase text-rose-600/20 -rotate-12 pointer-events-none">Revoked</p>}
      </article>
    </main>
  );
}
