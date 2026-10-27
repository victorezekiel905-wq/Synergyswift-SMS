"use client";
import { useState } from "react";

export type Post = { id: string; title: string; description: string | null; seats: number; position: number };
export type Candidate = { id: string; post_id: string; name: string; photo_url: string | null; manifesto: string | null; position: number };
export type Choices = Record<string, string[]>;

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join("");

/** A candidate's face: their photo, or their initials. */
export function CandidateFace({ c, size = "md" }: { c: Pick<Candidate, "name" | "photo_url">; size?: "md" | "lg" }) {
  const cls = size === "lg" ? "h-20 w-20 text-2xl" : "h-12 w-12 text-base";
  // eslint-disable-next-line @next/next/no-img-element
  return c.photo_url ? <img src={c.photo_url} alt="" className={`${cls} shrink-0 rounded-full object-cover ring-1 ring-slate-200`} />
    : <span aria-hidden className={`${cls} grid shrink-0 place-items-center rounded-full bg-brand-50 font-semibold text-brand-800 ring-1 ring-brand-100`}>{initials(c.name)}</span>;
}

/**
 * The ballot paper: one card per post, tap candidates (up to the number of seats), then
 * check your choices and cast. Leaving a post empty is an abstention. `big` is the
 * tablet layout for the teacher-run kiosk.
 */
export default function Ballot({ posts, candidates, onCast, big = false, busy = false }: {
  posts: Post[]; candidates: Candidate[]; onCast: (c: Choices) => Promise<void> | void; big?: boolean; busy?: boolean;
}) {
  const [picked, setPicked] = useState<Choices>({});
  const [review, setReview] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (p: Post, id: string) => setPicked(cur => {
    const now = cur[p.id] ?? [];
    if (now.includes(id)) return { ...cur, [p.id]: now.filter(x => x !== id) };
    if (p.seats === 1) return { ...cur, [p.id]: [id] };
    if (now.length >= p.seats) return cur;
    return { ...cur, [p.id]: [...now, id] };
  });
  const name = (id: string) => candidates.find(c => c.id === id)?.name ?? "";

  if (review) {
    return (
      <section className={"card " + (big ? "p-8" : "p-5")}>
        <h2 className={big ? "text-2xl font-semibold" : "text-lg font-semibold"}>Check your choices</h2>
        <ul className="mt-4 divide-y divide-slate-100">{posts.map(p => (
          <li key={p.id} className={"flex flex-wrap items-baseline justify-between gap-2 py-3 " + (big ? "text-xl" : "")}>
            <span className="text-slate-600">{p.title}</span>
            <span className="font-semibold">{(picked[p.id] ?? []).length ? (picked[p.id] ?? []).map(name).join(", ") : <span className="font-normal text-slate-500">No vote (abstain)</span>}</span>
          </li>))}</ul>
        <p className="mt-3 text-sm text-slate-600">Your vote is secret. Once cast it cannot be changed.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button className={"btn btn-ghost border border-slate-300 " + (big ? "px-6 py-4 text-lg" : "")} disabled={busy} onClick={() => setReview(false)}>Change</button>
          <button className={"btn btn-primary " + (big ? "px-8 py-4 text-lg" : "")} disabled={busy} onClick={() => onCast(picked)}>{busy ? "Casting…" : "Cast my vote"}</button>
        </div>
      </section>
    );
  }
  return (
    <div className="space-y-4">
      {posts.map(p => {
        const mine = picked[p.id] ?? [];
        const list = candidates.filter(c => c.post_id === p.id);
        return (
          <section key={p.id} className={"card " + (big ? "p-6" : "p-4")} aria-labelledby={`post-${p.id}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id={`post-${p.id}`} className={big ? "text-2xl font-semibold" : "text-lg font-semibold"}>{p.title}</h2>
              <span className="text-sm text-slate-600">{p.seats === 1 ? "Choose one" : `Choose up to ${p.seats}`}{mine.length ? ` · ${mine.length} chosen` : ""}</span>
            </div>
            {p.description && <p className="mt-1 text-sm text-slate-600">{p.description}</p>}
            <div className={"mt-3 grid gap-3 " + (big ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3")} role={p.seats === 1 ? "radiogroup" : "group"} aria-labelledby={`post-${p.id}`}>
              {list.map(c => {
                const on = mine.includes(c.id);
                const full = !on && p.seats > 1 && mine.length >= p.seats;
                return (
                  <div key={c.id} className={"rounded-xl border-2 transition " + (on ? "border-brand-700 bg-brand-50" : "border-slate-200 bg-white") + (full ? " opacity-50" : "")}>
                    <button type="button" role={p.seats === 1 ? "radio" : "checkbox"} aria-checked={on} disabled={full || busy} onClick={() => toggle(p, c.id)}
                      className={"flex w-full items-center gap-3 text-left " + (big ? "p-5" : "p-3")}>
                      <CandidateFace c={c} size={big ? "lg" : "md"} />
                      <span className="min-w-0 flex-1">
                        <span className={"block font-semibold " + (big ? "text-xl" : "")}>{c.name}</span>
                        {on && <span className="text-sm font-medium text-brand-700">Chosen</span>}
                      </span>
                      <span aria-hidden className={"grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 " + (on ? "border-brand-700 bg-brand-700 text-white" : "border-slate-300")}>{on ? "✓" : ""}</span>
                    </button>
                    {c.manifesto && (
                      <div className={big ? "px-5 pb-4" : "px-3 pb-3"}>
                        <button type="button" className="text-xs font-medium text-brand-700 underline" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? "Hide" : "Read"} {c.name.split(" ")[0]}&apos;s promises</button>
                        {open === c.id && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{c.manifesto}</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      <div className="flex justify-end">
        <button className={"btn btn-primary " + (big ? "px-8 py-4 text-lg" : "")} disabled={busy} onClick={() => setReview(true)}>Next: check my choices</button>
      </div>
    </div>
  );
}

export type Results = { phase: string; ballots: number; posts: { id: string; title: string; seats: number; abstained: number;
  candidates: { id: string; name: string; photo_url: string | null; votes: number; rank: number; elected: boolean; tie: boolean }[] }[] };

/** Votes per candidate, the elected, and ties that need a decision. */
export function ElectionResults({ r }: { r: Results }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{r.ballots} ballot{r.ballots === 1 ? "" : "s"} counted.</p>
      {r.posts.map(p => {
        const top = Math.max(1, ...p.candidates.map(c => c.votes));
        return (
          <section key={p.id} className="card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-semibold">{p.title}</h3>
              <span className="text-xs text-slate-500">{p.seats === 1 ? "1 seat" : `${p.seats} seats`}{p.abstained ? ` · ${p.abstained} abstained` : ""}</span></div>
            {p.candidates.some(c => c.tie) && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">A tie decides a seat here. The school will settle it (a run-off or its own rule).</p>}
            <ul className="mt-3 space-y-2">{p.candidates.map(c => (
              <li key={c.id} className="flex items-center gap-3">
                <CandidateFace c={c} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">{c.name}
                    {c.elected && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200">Elected</span>}
                    {c.tie && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900 ring-1 ring-inset ring-amber-200">Tie</span>}</p>
                  <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-slate-100"><div className={"h-full rounded-full " + (c.elected ? "bg-brand-600" : "bg-slate-400")} style={{ width: `${(c.votes / top) * 100}%` }} /></div>
                </div>
                <span className="w-14 text-right font-semibold tabular-nums">{c.votes}</span>
              </li>))}</ul>
          </section>
        );
      })}
    </div>
  );
}
