"use client";
import { use, useEffect, useState } from "react";
import { useApi, send, fmtDate, money } from "@/components/ui";

const STEPS = ["new", "reviewing", "assessment", "interview", "offered", "accepted", "enrolled"];
const LABEL: Record<string, string> = { new: "Received", reviewing: "Under review", assessment: "Entrance assessment", interview: "Interview", offered: "Offer made", accepted: "Offer accepted", enrolled: "Enrolled",
  rejected: "Not successful", withdrawn: "Withdrawn", waitlisted: "On the waiting list", declined: "Offer declined", expired: "Offer expired" };
const DOCS: Record<string, string> = { birth_certificate: "Birth certificate", previous_report: "Last school report", passport_photo: "Passport photograph", transfer_letter: "Transfer letter", medical: "Medical / immunisation record", other: "Other document" };

type Data = {
  application: { application_no: string; status: string; first_name: string; last_name: string; applying_for: string; assessment_at: string | null; interview_at: string | null; offer_expires_on: string | null;
    decision_note: string | null; fee_paid: boolean; acceptance_fee: number; acceptance_paid: boolean; offer_accepted_at: string | null; waitlist_position: number | null; created_at: string; has_offer: boolean };
  documents: { id: string; kind: string; name: string; size: number; uploaded_at: string }[];
  entrance: { token: string | null; status: string; opens_at: string | null; closes_at: string | null; title: string; minutes: number; absent?: boolean;
    centre?: { name: string; address: string | null; starts_at: string; ends_at: string } | null }[];
  /** Sittings the family can choose from (when the school lets them), and the released result. */
  sittings?: { id: string; kind: "online" | "centre"; centre: string | null; address: string | null; starts_at: string; ends_at: string; chosen: boolean }[];
  book_attempt?: boolean;
  result?: { decision: string; score: number | null } | null;
  school: { name: string; logo_url: string | null; brand_color: string | null; phone: string | null; email: string | null };
  application_fee: number; currency: string; pay_online: boolean; bank_details: string | null;
};

/** The family's private application page: progress, documents, fees, offer, entrance test. */
export default function TrackPage(props: { params: Promise<{ token: string }> }) {
  const { token } = use(props.params);
  const { data, error, reload } = useApi<Data>(`/api/apply/track/${token}`);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [kind, setKind] = useState("birth_certificate");
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("payment");
    if (p) setMsg({ ok: p === "success", text: p === "success" ? "Payment received. Thank you." : p === "failed" ? "The payment did not go through. Please try again." : "We are confirming your payment; refresh in a minute." });
  }, []);
  if (error) return <main className="mx-auto max-w-xl p-6"><p className="rounded-lg bg-slate-100 p-4">{error}</p></main>;
  if (!data) return <main className="p-10 text-center text-sm text-slate-500">Loading…</main>;
  const a = data.application;
  const color = data.school.brand_color ?? "#2f4f8f";
  const idx = STEPS.indexOf(a.status);
  const closed = ["rejected", "withdrawn", "declined", "expired", "enrolled"].includes(a.status);
  async function pay(k: "application_fee" | "acceptance_fee") {
    setBusy(k);
    const r = await send<{ url: string }>(`/api/apply/track/${token}`, { action: "pay", kind: k });
    setBusy(null);
    if (!r.ok) return setMsg({ ok: false, text: r.error ?? "failed" });
    window.location.href = r.data.url;
  }
  async function upload(file: File) {
    setBusy("upload"); setMsg(null);
    const fd = new FormData(); fd.set("kind", kind); fd.set("file", file);
    const res = await fetch(`/api/apply/track/${token}/documents`, { method: "POST", body: fd });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    setMsg({ ok: res.ok, text: res.ok ? "Uploaded. Thank you." : j.error ?? "Upload failed" });
    if (res.ok) reload();
  }
  return (
    <main className="mx-auto max-w-xl p-6">
      <p className="text-sm font-semibold" style={{ color }}>{data.school.name}</p>
      <h1 className="text-[26px] font-serif font-semibold tracking-[-0.01em]">{a.first_name} {a.last_name}</h1>
      <p className="text-sm text-slate-600">Application {a.application_no} · {a.applying_for} · received {fmtDate(a.created_at)}</p>
      {msg && <p role="status" className={"mt-3 rounded-lg p-3 text-sm " + (msg.ok ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-900")}>{msg.text}</p>}

      {["rejected", "withdrawn", "declined", "expired", "waitlisted"].includes(a.status) ? (
        <p className="mt-4 rounded-lg bg-slate-100 p-4">{LABEL[a.status]}{a.status === "waitlisted" && a.waitlist_position ? ` (position ${a.waitlist_position})` : ""}.{a.decision_note ? ` ${a.decision_note}` : ""}</p>
      ) : (
        <ol className="mt-5 space-y-2">{STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-3"><span className={"grid h-7 w-7 place-items-center rounded-full text-xs font-bold " + (i <= idx ? "text-white" : "bg-slate-200 text-slate-500")} style={i <= idx ? { background: color } : undefined}>{i < idx ? "✓" : i + 1}</span>
            <span className={i === idx ? "font-semibold" : "text-slate-500"}>{LABEL[s]}{s === "assessment" && a.assessment_at ? ` · ${fmtDate(a.assessment_at, true)}` : ""}{s === "interview" && a.interview_at ? ` · ${fmtDate(a.interview_at, true)}` : ""}</span></li>))}</ol>
      )}
      {a.decision_note && !["rejected", "withdrawn", "declined", "expired", "waitlisted"].includes(a.status) && <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">{a.decision_note}</p>}

      {a.has_offer && (
        <section className="mt-5 rounded-lg border-2 p-4" style={{ borderColor: color }}>
          <h2 className="font-semibold">{a.status === "offered" ? "You have an offer" : "Offer"}</h2>
          {a.status === "offered" ? <p className="text-sm">Please read and sign the offer letter{a.offer_expires_on ? ` by ${fmtDate(a.offer_expires_on)}` : ""}.</p> : a.offer_accepted_at ? <p className="text-sm">Accepted on {fmtDate(a.offer_accepted_at, true)}.</p> : null}
          <a className="btn mt-2 text-white" style={{ background: color }} href={`/apply/track/${token}/offer`}>{a.status === "offered" ? "Read and sign the offer" : "View the signed letter"}</a>
          {Number(a.acceptance_fee) > 0 && ["offered", "accepted"].includes(a.status) && (
            <p className="mt-3 text-sm">Acceptance fee {money(a.acceptance_fee, data.currency)}: <b>{a.acceptance_paid ? "paid" : "not yet paid"}</b>
              {!a.acceptance_paid && a.status === "accepted" && data.pay_online && <button className="btn btn-outline ml-2 px-3 py-1 text-xs" disabled={busy !== null} onClick={() => pay("acceptance_fee")}>{busy === "acceptance_fee" ? "Opening…" : "Pay now"}</button>}</p>
          )}
        </section>
      )}

      {data.result && (
        <section className="mt-5 rounded-lg border-2 p-4" style={{ borderColor: color }}>
          <h2 className="font-semibold">Entrance result</h2>
          <p className="mt-1 text-lg">{data.result.decision}</p>
          {data.result.score !== null && <p className="text-sm text-slate-600">Entrance score: <b>{data.result.score}</b> out of 100</p>}
        </section>
      )}

      {data.entrance.filter(e => e.token || e.centre).map((e, i) => (
        <section key={e.token ?? `centre-${i}`} className="mt-5 rounded-lg border border-slate-200 p-4">
          <h2 className="font-semibold">Entrance test: {e.title}</h2>
          {e.centre ? (
            <p className="text-sm text-slate-700">At <b>{e.centre.name}</b>{e.centre.address ? `, ${e.centre.address}` : ""}, {fmtDate(e.centre.starts_at, true)}. {e.minutes} minutes. {a.first_name} types the test PIN we sent on the school&apos;s computer there. Please arrive 20 minutes early.</p>
          ) : (<>
            <p className="text-sm text-slate-600">{e.minutes} minutes, in one sitting.{e.opens_at ? ` Opens ${fmtDate(e.opens_at, true)}.` : ""}{e.closes_at ? ` Closes ${fmtDate(e.closes_at, true)}.` : ""}</p>
            <a className="btn mt-2 text-white" style={{ background: color }} href={`/entrance/${e.token}`}>{e.status === "in_progress" ? "Continue the test" : "Start the test"}</a>
          </>)}
          {e.absent && <p className="mt-2 text-sm text-amber-800">{a.first_name} missed this sitting.{data.book_attempt ? " Choose another date below." : " Please contact the school."}</p>}
        </section>
      ))}

      {data.book_attempt && (data.sittings ?? []).length > 0 && (
        <section className="mt-5 rounded-lg border border-slate-200 p-4">
          <h2 className="font-semibold">Choose a date for the entrance test</h2>
          <ul className="mt-2 space-y-2">{(data.sittings ?? []).map(st => (
            <li key={st.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2 text-sm">
              <span className="flex-1">{st.kind === "online" ? "Online, from home" : `${st.centre}${st.address ? `, ${st.address}` : ""}`} · {fmtDate(st.starts_at, true)}{st.kind === "online" ? ` to ${fmtDate(st.ends_at, true)}` : ""}</span>
              {st.chosen ? <b className="text-emerald-700">Booked</b> : (
                <button className="btn btn-outline px-3 py-1 text-xs" disabled={busy !== null} onClick={async () => {
                  setBusy(st.id);
                  const r = await send(`/api/apply/track/${token}`, { action: "choose_sitting", sitting_id: st.id });
                  setBusy(null);
                  setMsg({ ok: r.ok, text: r.ok ? "Booked. We will send the details in a minute." : r.error ?? "failed" });
                  reload();
                }}>{busy === st.id ? "Booking…" : "Choose"}</button>
              )}
            </li>))}</ul>
        </section>
      )}

      {data.application_fee > 0 && !closed && (
        <section className="mt-5 rounded-lg border border-slate-200 p-4">
          <h2 className="font-semibold">Application fee: {money(data.application_fee, data.currency)}</h2>
          {a.fee_paid ? <p className="text-sm text-emerald-700">Paid. Thank you.</p> : (<>
            {data.pay_online && <button className="btn mt-2 text-white" style={{ background: color }} disabled={busy !== null} onClick={() => pay("application_fee")}>{busy === "application_fee" ? "Opening payment…" : "Pay online (card, transfer, USSD)"}</button>}
            {data.bank_details && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">Or pay by bank transfer: {data.bank_details}. Use {a.application_no} as the reference.</p>}
          </>)}
        </section>
      )}

      {!closed && (
        <section className="mt-5 rounded-lg border border-slate-200 p-4">
          <h2 className="font-semibold">Documents</h2>
          <p className="text-sm text-slate-600">Upload clear photos or PDFs (up to 8 MB each). Only the school&apos;s admissions team can see them.</p>
          <ul className="mt-2 space-y-1 text-sm">{data.documents.map(d => <li key={d.id}>✓ {DOCS[d.kind] ?? d.kind}: {d.name} <span className="text-xs text-slate-500">({Math.round(d.size / 1024)} KB)</span></li>)}</ul>
          {["birth_certificate", "previous_report", "passport_photo"].filter(k => !data.documents.some(d => d.kind === k)).length > 0 &&
            <p className="mt-1 text-xs text-amber-700">Still needed: {["birth_certificate", "previous_report", "passport_photo"].filter(k => !data.documents.some(d => d.kind === k)).map(k => DOCS[k]).join(", ")}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select className="input w-auto" value={kind} onChange={e => setKind(e.target.value)} aria-label="Document type">{Object.entries(DOCS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <input type="file" accept="application/pdf,image/*" capture="environment" disabled={busy !== null} aria-label="Choose file" onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
            {busy === "upload" && <span className="text-xs text-slate-500">Uploading…</span>}
          </div>
        </section>
      )}

      {!closed && a.status !== "accepted" && (
        <button className="mt-6 text-xs text-slate-500 underline" onClick={async () => {
          const reason = prompt("Withdraw this application? You can tell us why (optional):");
          if (reason === null) return;
          const r = await send(`/api/apply/track/${token}`, { action: "withdraw", reason: reason || null });
          setMsg({ ok: r.ok, text: r.ok ? "Your application has been withdrawn." : r.error ?? "failed" }); reload();
        }}>Withdraw this application</button>
      )}
      <p className="mt-6 text-xs text-slate-500">Questions? {data.school.phone ?? ""} {data.school.email ?? ""}</p>
    </main>
  );
}
