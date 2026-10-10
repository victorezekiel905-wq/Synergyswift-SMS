"use client";
import { useState } from "react";

export type AlumniFields = {
  full_name: string; graduation_year: number | null; last_class: string; email: string; phone: string; occupation: string; employer: string;
  further_study: string; city: string; country: string; linkedin: string; mentor: boolean; consent_contact: boolean;
};
export const EMPTY_ALUMNI: AlumniFields = { full_name: "", graduation_year: null, last_class: "", email: "", phone: "", occupation: "", employer: "", further_study: "", city: "", country: "", linkedin: "", mentor: false, consent_contact: true };

/** The alumni details form used by the public sign-up page and the private update link. */
export default function AlumniForm({ initial, color, submitLabel, consentRequired, onSubmit }: {
  initial: AlumniFields; color: string; submitLabel: string; consentRequired: boolean; onSubmit: (f: AlumniFields) => Promise<string | null>;
}) {
  const [f, setF] = useState<AlumniFields>(initial);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [website, setWebsite] = useState("");   // honeypot
  const input = (k: keyof AlumniFields, label: string, o: { type?: string; required?: boolean; placeholder?: string } = {}) => (
    <label className="block text-sm"><span className="label">{label}{o.required && <span className="text-rose-600"> *</span>}</span>
      <input className="input" type={o.type ?? "text"} required={o.required} placeholder={o.placeholder} value={(f[k] as string | number | null) ?? ""}
        onChange={e => setF({ ...f, [k]: o.type === "number" ? (e.target.value ? Number(e.target.value) : null) : e.target.value })} /></label>
  );
  return (
    <form className="space-y-3" onSubmit={async e => {
      e.preventDefault();
      if (website) return;
      setBusy(true); setErr(null);
      setErr(await onSubmit(f));
      setBusy(false);
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        {input("full_name", "Full name", { required: true })}
        {input("graduation_year", "Year you left", { type: "number", required: consentRequired, placeholder: "e.g. 2015" })}
        {input("last_class", "Last class", { placeholder: "e.g. SS3" })}
        {input("email", "Email", { type: "email", required: consentRequired })}
        {input("phone", "Phone")}
        {input("city", "City")}
        {input("country", "Country")}
        {input("occupation", "What you do now", { placeholder: "e.g. Civil engineer" })}
        {input("employer", "Employer")}
        {input("further_study", "University / course")}
        {input("linkedin", "LinkedIn profile link", { type: "url", placeholder: "https://…" })}
      </div>
      <input type="text" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" value={website} onChange={e => setWebsite(e.target.value)} />
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={f.mentor} onChange={e => setF({ ...f, mentor: e.target.checked })} /> I would be happy to mentor or speak to current students.</label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={f.consent_contact} required={consentRequired} onChange={e => setF({ ...f, consent_contact: e.target.checked })} /> I agree to hear from the school about alumni news and events.</label>
      {err && <p className="rounded bg-rose-50 p-2 text-sm text-rose-800" role="alert">{err}</p>}
      <button className="btn w-full text-white" style={{ background: color }} disabled={busy}>{busy ? "Saving…" : submitLabel}</button>
    </form>
  );
}
