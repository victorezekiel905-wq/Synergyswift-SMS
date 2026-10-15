"use client";
import { useState } from "react";
import { useApi, Badge, Modal, fmtDate } from "@/components/ui";
import { Conversation } from "@/components/learning/TutorAdmin";
import { PROVIDER } from "@/components/learning/OnlineLessons";

/** A child's learning paths and study-helper chats, for signed-in parents. */
export default function ChildLearning({ studentId }: { studentId: string }) {
  const paths = useApi<{ items: { id: string; title: string; subject: string | null; done: number; total: number; pct: number }[] }>(`/api/learning-paths?student_id=${studentId}`, [studentId]);
  const chats = useApi<{ items: { id: string; title: string; updated_at: string; concern: string | null }[] }>(`/api/tutor?student_id=${studentId}`, [studentId]);
  const [open, setOpen] = useState<string | null>(null);
  const p = paths.data?.items ?? [], c = chats.data?.items ?? [];
  if (!p.length && !c.length) return null;
  return (
    <div className="space-y-2">
      {p.length > 0 && <div><p className="text-xs font-semibold uppercase text-slate-500">Learning paths</p>
        <ul>{p.map(x => <li key={x.id}>{x.title} <span className="text-xs text-slate-500">{x.subject ? `${x.subject} · ` : ""}{x.done} of {x.total} steps</span></li>)}</ul></div>}
      {c.length > 0 && <div><p className="text-xs font-semibold uppercase text-slate-500">Study helper chats</p>
        <ul>{c.slice(0, 8).map(x => <li key={x.id}><button className="text-left text-brand-700 hover:underline" onClick={() => setOpen(x.id)}>{x.title}</button> <span className="text-xs text-slate-500">{fmtDate(x.updated_at)}</span></li>)}</ul></div>}
      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title="Study helper chat" wide>{open && <Conversation id={open} />}</Modal>
    </div>
  );
}

/** Online classes coming up for the family's children. */
export function FamilyOnlineLessons() {
  const { data } = useApi<{ items: { id: string; title: string; provider: string; starts_at: string; duration_min: number; status: string; class_groups: { name: string } | null; subjects: { name: string } | null }[] }>("/api/online-lessons");
  const items = (data?.items ?? []).filter(l => l.status !== "cancelled");
  if (!items.length) return null;
  return (
    <section className="space-y-1">
      <h3 className="font-semibold">Online classes coming up</h3>
      <ul>{items.slice(0, 10).map(l => <li key={l.id}>{l.title} <Badge tone="blue">{PROVIDER[l.provider]}</Badge> <span className="text-xs text-slate-500">{l.class_groups?.name} · {fmtDate(l.starts_at, true)} · {l.duration_min} min</span></li>)}</ul>
    </section>
  );
}
