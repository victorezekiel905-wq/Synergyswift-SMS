"use client";
import { useState } from "react";
import { useApi, send, Badge, fmtDate } from "@/components/ui";

type Group = { id: string; name: string; kind: string; description: string | null; meets: string | null; location: string | null; status: string | null; role: string | null; can_join: boolean; joining: string };
type Result = { id: string; event: string | null; position: number | null; award: string | null; score: string | null; competitions: { title: string; held_on: string; level: string } | null };

/** Clubs and teams a student is in or can join, and their competition results. */
export default function MyClubs() {
  const { data, reload } = useApi<{ groups: Group[]; results: Result[] }>("/api/student/clubs");
  const [msg, setMsg] = useState<string | null>(null);
  if (!data || (!data.groups.length && !data.results.length)) return null;
  const mine = data.groups.filter(g => g.status === "active" || g.status === "requested"), open = data.groups.filter(g => !g.status || !["active", "requested"].includes(g.status));
  async function act(action: "join" | "leave", g: Group) {
    if (action === "leave" && !confirm(`Leave ${g.name}?`)) return;
    const r = await send<{ status?: string }>("/api/student/clubs", { action, group_id: g.id });
    setMsg(!r.ok ? r.error : action === "leave" ? `You have left ${g.name}.` : r.data.status === "active" ? `You have joined ${g.name}.` : `Asked to join ${g.name}. The teacher in charge will reply.`);
    if (r.ok) reload();
  }
  return (
    <section className="card mb-6 space-y-3 p-4 text-sm">
      <h2 className="font-semibold">Clubs &amp; teams</h2>
      {msg && <p className="text-emerald-700">{msg}</p>}
      {mine.length > 0 && <ul className="space-y-1">{mine.map(g => (
        <li key={g.id} className="flex flex-wrap items-center justify-between gap-2">
          <span><span className="font-medium">{g.name}</span>{g.meets ? ` · ${g.meets}` : ""}{g.location ? ` · ${g.location}` : ""} {g.status === "requested" ? <Badge tone="amber">asked to join</Badge> : g.role && g.role !== "member" ? <Badge tone="violet">{g.role.replace("_", "-")}</Badge> : null}</span>
          <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => act("leave", g)}>{g.status === "requested" ? "Cancel" : "Leave"}</button>
        </li>))}</ul>}
      {open.length > 0 && (
        <details>
          <summary className="cursor-pointer text-brand-700">{open.length} you can join</summary>
          <ul className="mt-2 space-y-2">{open.map(g => (
            <li key={g.id} className="flex flex-wrap items-start justify-between gap-2 rounded border border-slate-200 p-2">
              <div><p className="font-medium">{g.name} <Badge>{g.kind}</Badge></p><p className="text-xs text-slate-500">{[g.meets, g.location].filter(Boolean).join(" · ")}</p>{g.description && <p className="mt-1 text-xs">{g.description}</p>}</div>
              <button className="btn btn-primary px-2 py-1 text-xs" onClick={() => act("join", g)}>{g.joining === "open" ? "Join" : "Ask to join"}</button>
            </li>))}</ul>
        </details>
      )}
      {data.results.length > 0 && (
        <div><h3 className="mb-1 font-medium">My competition results</h3>
          <ul className="space-y-1">{data.results.map(r => (
            <li key={r.id}>{r.competitions?.title}{r.event ? `: ${r.event}` : ""} <span className="text-slate-500">({fmtDate(r.competitions?.held_on)})</span>{" "}
              {r.award ? <Badge tone="green">{r.award}</Badge> : r.position ? <Badge tone={r.position <= 3 ? "green" : "slate"}>position {r.position}</Badge> : null}{r.score ? ` ${r.score}` : ""}</li>))}</ul>
        </div>
      )}
    </section>
  );
}
