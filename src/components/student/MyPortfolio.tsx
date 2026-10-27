"use client";
import { useState } from "react";
import Link from "next/link";
import { useApi, send, Alert, Badge, Empty, fmtDate } from "@/components/ui";
import { PortfolioView, Targets, ShareLinks, type Achievement, type TargetRow, type Share } from "@/components/portfolio/Portfolio";

type Data = {
  items: { id: string; title: string; kind: string; description: string | null; link_url: string | null; has_file: boolean; status: string; feedback: string | null; created_at: string; subjects: { name: string } | null }[];
  achievements: Achievement[];
  certificates: { id: string; title: string; issued_on: string; verify_token: string }[];
  subjects: { id: string; name: string }[];
  targets?: TargetRow[]; shares?: Share[]; transcript_allowed?: boolean;
};
const ACH_KINDS = ["academic", "sports", "arts", "leadership", "service", "competition", "character", "other"];

/** A student's own portfolio: add work (a teacher approves it), and see achievements and certificates. */
export default function MyPortfolio() {
  const { data, error, reload } = useApi<Data>("/api/student/portfolio");
  const [f, setF] = useState({ title: "", kind: "work", subject_id: "", link_url: "", description: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [ach, setAch] = useState({ title: "", kind: "competition", level: "school", award: "", achieved_on: new Date().toISOString().slice(0, 10) });
  const [shared, setShared] = useState<string | null>(null);
  if (error) return null;
  if (!data) return null;
  const shareOne = async (id: string) => { const r = await send<{ url: string }>("/api/student/portfolio", { action: "share", achievement_id: id, days: 90 }); if (r.ok) { setShared(r.data.url); reload(); } else setMsg({ ok: false, text: r.error ?? "failed" }); };
  return (
    <section className="mb-8 space-y-3">
      <h2 className="text-lg font-semibold">My portfolio</h2>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <form className="card grid gap-2 p-3 text-sm sm:grid-cols-4" onSubmit={async e => {
        e.preventDefault();
        const file = (e.currentTarget.elements.namedItem("file") as HTMLInputElement).files?.[0];
        setBusy(true);
        let ok = false, text = "";
        if (file) {
          const fd = new FormData();
          Object.entries(f).forEach(([k, v]) => fd.set(k, v));
          fd.set("file", file);
          const r = await fetch("/api/student/portfolio", { method: "POST", body: fd });
          const j = await r.json().catch(() => ({}));
          ok = r.ok; text = j.error ?? "";
        } else {
          const r = await send("/api/student/portfolio", f);
          ok = r.ok; text = r.error ?? "";
        }
        setBusy(false);
        setMsg({ ok, text: ok ? "Sent. Your teacher will look at it." : text || "failed" });
        if (ok) { (e.target as HTMLFormElement).reset(); setF({ ...f, title: "", link_url: "", description: "" }); reload(); }
      }}>
        <input className="input sm:col-span-2" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="Title of your work" required aria-label="Title" />
        <select className="input" value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })} aria-label="Kind">{["work", "project", "artwork", "writing", "photo", "video", "audio", "other"].map(k => <option key={k}>{k}</option>)}</select>
        <select className="input" value={f.subject_id} onChange={e => setF({ ...f, subject_id: e.target.value })} aria-label="Subject"><option value="">Subject</option>{data.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <input className="input sm:col-span-2" name="file" type="file" aria-label="File (up to 25 MB)" />
        <input className="input sm:col-span-2" value={f.link_url} onChange={e => setF({ ...f, link_url: e.target.value })} placeholder="…or a link (https://)" aria-label="Link" />
        <input className="input sm:col-span-3" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} placeholder="What is it about?" aria-label="Description" />
        <button className="btn btn-primary" disabled={busy}>{busy ? "Sending…" : "Add"}</button>
      </form>
      {!data.items.length ? <Empty>Add your best work: projects, essays, artwork, videos.</Empty> : (
        <ul className="grid gap-2 sm:grid-cols-2">{data.items.map(i => (
          <li key={i.id} className="card p-3 text-sm">
            <p className="font-medium">{i.has_file ? <a className="text-brand-700 hover:underline" href={`/api/student/portfolio?open=${i.id}`} target="_blank" rel="noreferrer">{i.title}</a>
              : i.link_url ? <a className="text-brand-700 hover:underline" href={i.link_url} target="_blank" rel="noreferrer">{i.title}</a> : i.title}
              {" "}<Badge tone={i.status === "approved" ? "green" : i.status === "submitted" ? "amber" : "red"}>{i.status === "submitted" ? "with your teacher" : i.status}</Badge></p>
            <p className="text-xs text-slate-500">{i.subjects?.name ?? i.kind} · {fmtDate(i.created_at)}</p>
            {i.feedback && <p className="text-xs text-slate-700">Teacher: {i.feedback}</p>}
          </li>
        ))}</ul>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-2"><h2 className="mr-auto text-lg font-semibold">My achievements</h2>
        <Link className="btn btn-outline" href="/student/transcript">My transcript{data.transcript_allowed === false ? " (view only)" : ""}</Link></div>
      <form className="card grid gap-2 p-3 text-sm sm:grid-cols-6" onSubmit={async e => {
        e.preventDefault();
        const fd = new FormData();
        Object.entries(ach).forEach(([k, v]) => fd.set(k, v));
        fd.set("what", "achievement");
        const photo = (e.currentTarget.elements.namedItem("photo") as HTMLInputElement).files?.[0];
        if (photo) fd.set("photo", photo);
        const r = await fetch("/api/student/portfolio", { method: "POST", body: fd });
        const j = await r.json().catch(() => ({}));
        setMsg({ ok: r.ok, text: r.ok ? "Added. A teacher will verify it, then it shows on your shared portfolio." : j.error ?? "failed" });
        if (r.ok) { (e.target as HTMLFormElement).reset(); setAch({ ...ach, title: "", award: "" }); reload(); }
      }}>
        <input className="input sm:col-span-2" value={ach.title} onChange={e => setAch({ ...ach, title: e.target.value })} placeholder="e.g. Maths Olympiad, state round" required aria-label="Achievement" />
        <select className="input" value={ach.kind} onChange={e => setAch({ ...ach, kind: e.target.value })} aria-label="Kind">{ACH_KINDS.map(k => <option key={k}>{k}</option>)}</select>
        <select className="input" value={ach.level} onChange={e => setAch({ ...ach, level: e.target.value })} aria-label="Level">{["class", "school", "local", "state", "national", "international"].map(k => <option key={k}>{k}</option>)}</select>
        <input className="input" value={ach.award} onChange={e => setAch({ ...ach, award: e.target.value })} placeholder="Place / medal" aria-label="Award" />
        <input className="input" type="date" value={ach.achieved_on} onChange={e => setAch({ ...ach, achieved_on: e.target.value })} aria-label="Date" />
        <label className="sm:col-span-4 text-slate-600">Photo (optional) <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" className="ml-2" /></label>
        <button className="btn btn-primary sm:col-span-2">Add achievement</button>
      </form>
      {shared && <Alert tone="green">Link made: <span className="break-all font-mono text-xs">{shared}</span></Alert>}
      <PortfolioView achievements={data.achievements} certificates={data.certificates} onShare={shareOne} />
      <Targets targets={data.targets ?? []} onAdd={async d => { const r = await send("/api/student/portfolio", { action: "target", description: d }); if (r.ok) reload(); else setMsg({ ok: false, text: r.error ?? "failed" }); return r.ok; }}
        onStatus={async (id, status) => { await send("/api/student/portfolio", { action: "target_status", id, status }); reload(); }} />
      <ShareLinks shares={data.shares ?? []} api="/api/student/portfolio" onChange={reload} />
    </section>
  );
}
