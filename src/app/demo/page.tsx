"use client";
import Link from "next/link";
import { useState } from "react";

const SIZES = [{ v: 80, l: "Under 100 students" }, { v: 200, l: "100 to 250" }, { v: 400, l: "250 to 500" }, { v: 800, l: "500 to 1,000" }, { v: 1500, l: "1,000 to 2,000" }, { v: 3000, l: "More than 2,000" }];

/** "Book a demo" for schools (phase 14g-1): goes straight into the Synergy Swift sales CRM. */
export default function Demo() {
  const [f, setF] = useState({ school_name: "", contact_name: "", contact_role: "", phone: "", email: "", city: "", state: "", students_estimate: "", needs: "", website: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const r = await fetch("/api/demo", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...f, students_estimate: f.students_estimate ? Number(f.students_estimate) : null, contact_role: f.contact_role || null, city: f.city || null, state: f.state || null, needs: f.needs || null }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok && r.status !== 429) return setErr(j.error ?? "Something went wrong. Please try again.");
    setDone(true);
  }
  return (
    <main className="min-h-screen bg-canvas">
      <div className="mx-auto grid max-w-5xl gap-10 px-5 py-12 lg:grid-cols-[1fr_1.1fr]">
        <section>
          <Link href="/" className="text-sm font-semibold text-brand-700 no-underline">Synergy Swift</Link>
          <h1 className="mt-3 text-[34px] font-serif font-semibold leading-tight tracking-[-0.01em]">See your whole school in one place</h1>
          <p className="mt-3 text-slate-700">A 30-minute demo, on a video call or at your school: results and report cards, fees, attendance, secure exams with Safe Exam Browser, entrance exams, live lessons and games, parents&apos; app, transport, elections and more.</p>
          <ul className="mt-5 space-y-2 text-sm text-slate-700">
            <li>· We show it with your classes and your fees, not a slide deck.</li>
            <li>· Prices are by school size and the parts you need.</li>
            <li>· We move your data and train your staff.</li>
          </ul>
        </section>
        <section className="card p-6">
          {done ? (
            <div role="status" className="py-6 text-center">
              <h2 className="text-xl font-semibold">Thank you</h2>
              <p className="mt-2 text-slate-700">We&apos;ll call you within one working day to book a time that suits you.</p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <h2 className="text-lg font-semibold">Book a demo</h2>
              <label className="block"><span className="label">School</span><input className="input" required value={f.school_name} onChange={set("school_name")} autoComplete="organization" /></label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block"><span className="label">Your name</span><input className="input" required value={f.contact_name} onChange={set("contact_name")} autoComplete="name" /></label>
                <label className="block"><span className="label">Your role</span><input className="input" value={f.contact_role} onChange={set("contact_role")} placeholder="Proprietor, principal…" /></label>
                <label className="block"><span className="label">Phone (WhatsApp)</span><input className="input" required type="tel" value={f.phone} onChange={set("phone")} autoComplete="tel" /></label>
                <label className="block"><span className="label">Email</span><input className="input" required type="email" value={f.email} onChange={set("email")} autoComplete="email" /></label>
                <label className="block"><span className="label">City</span><input className="input" value={f.city} onChange={set("city")} /></label>
                <label className="block"><span className="label">State</span><input className="input" value={f.state} onChange={set("state")} /></label>
              </div>
              <label className="block"><span className="label">Number of students</span>
                <select className="input" value={f.students_estimate} onChange={set("students_estimate")}><option value="">Choose…</option>{SIZES.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}</select></label>
              <label className="block"><span className="label">What would you most like to see? (optional)</span><textarea className="input" rows={3} value={f.needs} onChange={set("needs")} /></label>
              <input tabIndex={-1} autoComplete="off" className="hidden" aria-hidden value={f.website} onChange={set("website")} />
              {err && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-900">{err}</p>}
              <button className="btn btn-primary w-full py-3" disabled={busy}>{busy ? "Sending…" : "Book my demo"}</button>
              <p className="text-xs text-slate-500">We use these details only to arrange your demo.</p>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
