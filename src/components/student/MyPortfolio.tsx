"use client";
import { useState } from "react";
import { useApi, send, Alert, Badge, Empty, fmtDate } from "@/components/ui";

type Data = {
  items: { id: string; title: string; kind: string; description: string | null; link_url: string | null; has_file: boolean; status: string; feedback: string | null; created_at: string; subjects: { name: string } | null }[];
  achievements: { id: string; title: string; award: string | null; level: string; achieved_on: string }[];
  certificates: { id: string; title: string; issued_on: string; verify_token: string }[];
  subjects: { id: string; name: string }[];
};

/** A student's own portfolio: add work (a teacher approves it), and see achievements and certificates. */
export default function MyPortfolio() {
  const { data, error, reload } = useApi<Data>("/api/student/portfolio");
  const [f, setF] = useState({ title: "", kind: "work", subject_id: "", link_url: "", description: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (error) return null;
  if (!data) return null;
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
      {(data.achievements.length > 0 || data.certificates.length > 0) && (
        <div className="card p-3 text-sm">
          {data.achievements.length > 0 && <><p className="font-semibold">Achievements</p><ul>{data.achievements.map(a => <li key={a.id}>{a.title}{a.award ? `: ${a.award}` : ""} <span className="text-xs text-slate-500">{fmtDate(a.achieved_on)}</span></li>)}</ul></>}
          {data.certificates.length > 0 && <><p className="mt-2 font-semibold">Certificates</p><ul>{data.certificates.map(c => <li key={c.id}><a className="text-brand-700 hover:underline" href={`/v/${c.verify_token}`} target="_blank" rel="noreferrer">{c.title}</a> <span className="text-xs text-slate-500">{fmtDate(c.issued_on)}</span></li>)}</ul></>}
        </div>
      )}
    </section>
  );
}
