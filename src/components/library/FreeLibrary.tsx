"use client";
import { useEffect, useState } from "react";
import { useApi, Empty, Loading, Alert } from "@/components/ui";

type Book = { id: string; source: string; section: string; title: string; authors: string | null; description: string | null; subjects: string[];
  level: string; read_url: string; download_url: string | null; cover_url: string | null; licence: string | null };
type Result = { books: Book[]; total: number; page: number; per_page: number; missing?: boolean; error?: string };

export const SECTIONS: [string, string][] = [
  ["", "Everything"], ["textbooks", "Textbooks"], ["storybooks", "Storybooks"], ["children", "Children's books"], ["fiction", "Classics & adventure"],
  ["poetry", "Poetry"], ["self_help", "Self-help & life skills"], ["science", "Science & nature"], ["history", "History & biography"],
  ["education", "Reference & study"], ["arts", "Arts, music & hobbies"]
];
const LEVELS: [string, string][] = [["", "Any level"], ["early_years", "Early years"], ["primary", "Primary"], ["secondary", "Secondary"], ["tertiary", "Advanced"]];
const SUBJECTS = ["Mathematics", "English Language", "Literature", "Biology", "Chemistry", "Physics", "Basic Science", "Agriculture", "Geography", "History",
  "Economics", "Civic Education", "Business Studies", "Computer Studies", "Fine Arts", "Music", "Physical & Health Education", "Home Economics", "Languages",
  "Psychology & Life Skills", "Philosophy"];
const SOURCE: Record<string, string> = { gutenberg: "Project Gutenberg", storyweaver: "StoryWeaver", open_textbook_library: "Open Textbook Library", openstax: "OpenStax", libretexts: "LibreTexts", wikibooks: "Wikibooks" };
const LEVEL: Record<string, string> = { early_years: "Early years", primary: "Primary", secondary: "Secondary", tertiary: "Advanced", all: "All levels" };

/**
 * The free library every school has: tens of thousands of books that are free and legal
 * to read (public domain or open licences), from textbooks to storybooks. Search, filter,
 * read online or download. Chosen for schools.
 */
export default function FreeLibrary() {
  const [q, setQ] = useState(""), [typed, setTyped] = useState("");
  const [section, setSection] = useState(""), [level, setLevel] = useState(""), [subject, setSubject] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => { const t = setTimeout(() => { setQ(typed.trim()); setPage(1); }, 350); return () => clearTimeout(t); }, [typed]);
  const qs = new URLSearchParams({ q, section, level, subject, page: String(page) }).toString();
  const { data, error } = useApi<Result>(`/api/library/open-books?${qs}`, [qs]);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.per_page)) : 1;
  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-4">
        <p className="text-sm text-slate-600">Free books for every class: textbooks, storybooks, classics, poetry, science, history and self-help. All are free and legal to read (public domain or open licences) and chosen for schools.</p>
        <div className="flex flex-wrap gap-2">
          <input className="input min-w-0 flex-1" style={{ minWidth: "14rem" }} placeholder="Search by title, author or subject…" value={typed} onChange={e => setTyped(e.target.value)} aria-label="Search the free library" />
          <select className="input w-auto" value={level} onChange={e => { setLevel(e.target.value); setPage(1); }} aria-label="Level">{LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select className="input w-auto" value={subject} onChange={e => { setSubject(e.target.value); setPage(1); }} aria-label="Subject"><option value="">Any subject</option>{SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}</select>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Section">
          {SECTIONS.map(([v, l]) => (
            <button key={v} type="button" aria-pressed={section === v} onClick={() => { setSection(v); setPage(1); }}
              className={"rounded-full px-3 py-1 text-[13px] " + (section === v ? "bg-navy text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200")}>{l}</button>
          ))}
        </div>
      </div>
      {error && <Alert>{error}</Alert>}
      {!data && !error && <Loading />}
      {data?.missing && <Alert tone="amber">The free library is being set up. Ask your Synergy Swift administrator to load it.</Alert>}
      {data && !data.missing && (
        <>
          <p className="text-sm text-slate-600">{data.total.toLocaleString("en-NG")} book{data.total === 1 ? "" : "s"}{q ? ` for “${q}”` : ""}</p>
          {!data.books.length ? <Empty>No books match. Try fewer words, or another section.</Empty> : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {data.books.map(b => (
                <li key={b.id} className="card flex gap-3 p-3">
                  <Cover url={b.cover_url} title={b.title} />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 font-semibold leading-snug text-slate-900">{b.title}</p>
                    {b.authors && <p className="truncate text-[13px] text-slate-600">{b.authors}</p>}
                    <p className="mt-1 text-xs text-slate-500">{LEVEL[b.level] ?? b.level} · {b.subjects.slice(0, 2).join(", ")}</p>
                    {b.description && <p className="mt-1 line-clamp-2 text-xs text-slate-600">{b.description}</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <a className="btn btn-primary btn-sm no-underline" href={b.read_url} target="_blank" rel="noreferrer">Read</a>
                      {b.download_url && <a className="btn btn-outline btn-sm no-underline" href={b.download_url} target="_blank" rel="noreferrer">Download</a>}
                      <span className="text-[11px] text-slate-400">{SOURCE[b.source] ?? b.source}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {pages > 1 && (
            <div className="flex items-center justify-center gap-3 text-sm">
              <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Previous</button>
              <span className="tabular-nums text-slate-600">Page {page} of {pages.toLocaleString("en-NG")}</span>
              <button className="btn btn-outline btn-sm" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** The book's cover, or a plain one with its title when there is none (or it fails to load). */
function Cover({ url, title }: { url: string | null; title: string }) {
  const [broken, setBroken] = useState(false);
  if (url && !broken) return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="h-28 w-20 shrink-0 rounded border border-slate-200 bg-slate-100 object-cover" />
  );
  return <div aria-hidden className="flex h-28 w-20 shrink-0 items-center rounded border border-slate-200 bg-navy/90 p-1.5 text-center text-[10px] font-medium leading-tight text-white">{title.slice(0, 60)}</div>;
}
