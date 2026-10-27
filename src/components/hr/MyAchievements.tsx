"use client";
import { useState } from "react";
import { useApi, send, Alert, Loading, Empty } from "@/components/ui";
import { PortfolioView, ShareLinks, type Achievement, type Share } from "@/components/portfolio/Portfolio";

const KINDS: Record<string, string> = { award: "Award", qualification: "Qualification", training: "Training / CPD", certification: "Certification", publication: "Publication", competition: "Competition", leadership: "Leadership", service: "Service", other: "Other" };

/** A teacher's own achievement portfolio, with photos and share links (phase 14o). */
export function MyAchievements() {
  const { data, error, reload } = useApi<{ staff: { id: string; full_name: string } | null; achievements: Achievement[]; shares: Share[] }>("/api/staff/portfolio");
  const [f, setF] = useState({ title: "", kind: "award", issuer: "", achieved_on: new Date().toISOString().slice(0, 10), link_url: "", description: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  if (!data.staff) return <Empty>Your account is not linked to a staff record. Ask HR to link it.</Empty>;
  return (
    <div className="space-y-5 text-sm">
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <form className="card grid gap-2 p-4 sm:grid-cols-6" onSubmit={async e => {
        e.preventDefault();
        const fd = new FormData();
        Object.entries(f).forEach(([k, v]) => fd.set(k, v));
        const photo = (e.currentTarget.elements.namedItem("photo") as HTMLInputElement).files?.[0];
        if (photo) fd.set("photo", photo);
        const r = await fetch("/api/staff/portfolio", { method: "POST", body: fd });
        const j = await r.json().catch(() => ({}));
        setMsg({ ok: r.ok, text: r.ok ? "Added to your portfolio." : j.error ?? "failed" });
        if (r.ok) { (e.target as HTMLFormElement).reset(); setF({ ...f, title: "", issuer: "", link_url: "", description: "" }); reload(); }
      }}>
        <h3 className="font-semibold sm:col-span-6">Add an achievement</h3>
        <input className="input sm:col-span-3" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="e.g. Best Teacher Award, Lagos State 2026" required aria-label="Title" />
        <select className="input" value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })} aria-label="Kind">{Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <input className="input" value={f.issuer} onChange={e => setF({ ...f, issuer: e.target.value })} placeholder="Given by" aria-label="Given by" />
        <input className="input" type="date" value={f.achieved_on} onChange={e => setF({ ...f, achieved_on: e.target.value })} aria-label="Date" />
        <input className="input sm:col-span-3" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} placeholder="What for (optional)" aria-label="Description" />
        <input className="input sm:col-span-3" value={f.link_url} onChange={e => setF({ ...f, link_url: e.target.value })} placeholder="Link (https://, optional)" aria-label="Link" />
        <label className="text-slate-600 sm:col-span-4">Photo (optional) <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" className="ml-2" /></label>
        <button className="btn btn-primary sm:col-span-2">Add</button>
      </form>
      <PortfolioView achievements={data.achievements} onShare={async id => {
        const r = await send<{ url: string }>("/api/staff/portfolio", { action: "share", achievement_id: id, days: 90 });
        setMsg({ ok: r.ok, text: r.ok ? `Link made: ${r.data.url}` : r.error ?? "failed" }); if (r.ok) reload();
      }} />
      <ShareLinks shares={data.shares} api="/api/staff/portfolio" onChange={reload} />
    </div>
  );
}
