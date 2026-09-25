"use client";
import { useState } from "react";
import { useApi, send, Page, PageHeader, Tabs, Alert, Empty, Modal, Field, Badge, fmtDate, rolesOf, type Me } from "@/components/ui";

type Book = { id: string; isbn: string | null; title: string; author: string | null; publisher: string | null; category: string | null; shelf: string | null; total_copies: number; available_copies: number };
type Loan = { id: string; issued_at: string; due_at: string; returned_at: string | null; fine_amount: number; borrower: string; library_books: { title: string } | null };

export default function LibraryPage() {
  const { data: me } = useApi<Me>("/api/me");
  const roles = rolesOf(me);
  const isLibrarian = ["librarian", "school_admin", "principal", "platform_admin"].some(r => roles.has(r));
  const [tab, setTab] = useState<"catalogue" | "loans" | "overdue" | "history">("catalogue");
  const [q, setQ] = useState("");
  const books = useApi<Book[]>(`/api/library?view=catalogue&q=${encodeURIComponent(q)}`, [q]);
  const loans = useApi<Loan[]>(tab !== "catalogue" && isLibrarian ? `/api/library?view=${tab}` : null, [tab, isLibrarian]);
  const [edit, setEdit] = useState<Partial<Book> | null>(null);
  const [issue, setIssue] = useState<Book | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function doReturn(l: Loan) {
    const r = await send("/api/library", { action: "return", loan_id: l.id });
    setMsg({ ok: r.ok, text: r.ok ? `Returned.${r.data.fine > 0 ? ` Fine due: ${r.data.fine}` : ""}` : r.error ?? "failed" });
    loans.reload(); books.reload();
  }

  return (
    <Page wide>
      <PageHeader eyebrow="Operations" title="Library" subtitle="Catalogue, issue by scanning a student or staff ID, returns with automatic overdue fines, and weekly WhatsApp reminders to parents for overdue books."
        actions={isLibrarian ? <button className="btn btn-primary" onClick={() => setEdit({ total_copies: 1 })}>+ Add book</button> : undefined} />
      <Tabs value={tab} onChange={setTab} tabs={isLibrarian
        ? [{ id: "catalogue", label: "Catalogue" }, { id: "loans", label: "On loan" }, { id: "overdue", label: "Overdue" }, { id: "history", label: "Returned" }]
        : [{ id: "catalogue", label: "Catalogue" }]} />
      {msg && <div className="mb-3"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      {tab === "catalogue" ? (
        <>
          <input className="input mb-3 max-w-sm" placeholder="Search title, author, ISBN, category" value={q} onChange={e => setQ(e.target.value)} aria-label="Search books" />
          {!books.data?.length ? <Empty>No books found.</Empty> : (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Title</th><th className="p-3">Author</th><th className="p-3">Category</th><th className="p-3">Shelf</th><th className="p-3 text-center">Available</th><th className="p-3" /></tr></thead>
                <tbody>
                  {books.data.map(b => (
                    <tr key={b.id} className="border-t border-slate-100">
                      <td className="p-3 font-medium">{b.title}<div className="text-xs text-slate-400">{b.isbn}</div></td>
                      <td className="p-3">{b.author}</td><td className="p-3">{b.category}</td><td className="p-3">{b.shelf}</td>
                      <td className="p-3 text-center"><Badge tone={b.available_copies ? "green" : "red"}>{b.available_copies} / {b.total_copies}</Badge></td>
                      <td className="whitespace-nowrap p-3 text-right">{isLibrarian && <>
                        <button className="btn btn-ghost px-2 py-1 text-xs" disabled={!b.available_copies} onClick={() => setIssue(b)}>Issue</button>
                        <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setEdit(b)}>Edit</button>
                      </>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        !loans.data?.length ? <Empty>Nothing here.</Empty> : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Book</th><th className="p-3">Borrower</th><th className="p-3">Issued</th><th className="p-3">Due</th><th className="p-3">{tab === "history" ? "Returned / fine" : ""}</th></tr></thead>
              <tbody>
                {loans.data.map(l => (
                  <tr key={l.id} className="border-t border-slate-100">
                    <td className="p-3 font-medium">{l.library_books?.title}</td><td className="p-3">{l.borrower}</td>
                    <td className="p-3">{fmtDate(l.issued_at)}</td>
                    <td className={"p-3 " + (!l.returned_at && new Date(l.due_at) < new Date() ? "font-semibold text-rose-600" : "")}>{fmtDate(l.due_at)}</td>
                    <td className="p-3 text-right">{l.returned_at ? `${fmtDate(l.returned_at)}${Number(l.fine_amount) ? ` · fine ${l.fine_amount}` : ""}` : <button className="btn btn-primary px-3 py-1 text-xs" onClick={() => doReturn(l)}>Return</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
      <BookForm book={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); books.reload(); }} />
      <IssueForm book={issue} onClose={() => setIssue(null)} onDone={(t) => { setIssue(null); setMsg({ ok: true, text: t }); books.reload(); }} />
    </Page>
  );
}

function BookForm({ book, onClose, onSaved }: { book: Partial<Book> | null; onClose: () => void; onSaved: () => void }) {
  const [b, setB] = useState<Partial<Book>>({});
  const [err, setErr] = useState<string | null>(null);
  const cur = { ...book, ...b };
  const bind = (k: keyof Book) => ({ value: (cur[k] as string | number | null) ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement>) => setB({ ...b, [k]: e.target.value }) });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const r = await send("/api/library", { action: "save_book", book: {
      id: cur.id, title: cur.title, author: cur.author || null, isbn: cur.isbn || null, publisher: cur.publisher || null,
      category: cur.category || null, shelf: cur.shelf || null, total_copies: Number(cur.total_copies ?? 1) } });
    if (!r.ok) return setErr(r.error);
    setB({}); setErr(null); onSaved();
  }
  return (
    <Modal open={Boolean(book)} onClose={() => { setB({}); onClose(); }} title={cur.id ? "Edit book" : "Add book"}>
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Title"><input className="input" required {...bind("title")} /></Field></div>
        <Field label="Author"><input className="input" {...bind("author")} /></Field>
        <Field label="ISBN"><input className="input" {...bind("isbn")} /></Field>
        <Field label="Publisher"><input className="input" {...bind("publisher")} /></Field>
        <Field label="Category"><input className="input" {...bind("category")} /></Field>
        <Field label="Shelf"><input className="input" {...bind("shelf")} /></Field>
        <Field label="Copies"><input className="input" type="number" min={0} {...bind("total_copies")} /></Field>
        {err && <div className="sm:col-span-2"><Alert>{err}</Alert></div>}
        <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary">Save</button></div>
      </form>
    </Modal>
  );
}

function IssueForm({ book, onClose, onDone }: { book: Book | null; onClose: () => void; onDone: (t: string) => void }) {
  const [code, setCode] = useState("");
  const [days, setDays] = useState("");
  const [err, setErr] = useState<string | null>(null);
  async function issue(e: React.FormEvent) {
    e.preventDefault();
    const r = await send("/api/library", { action: "issue", book_id: book!.id, borrower_code: code, days: days ? Number(days) : undefined });
    if (!r.ok) return setErr(r.error);
    setCode(""); setDays(""); setErr(null); onDone(`Issued "${book!.title}".`);
  }
  return (
    <Modal open={Boolean(book)} onClose={onClose} title={`Issue: ${book?.title ?? ""}`}>
      <form onSubmit={issue} className="space-y-3">
        <Field label="Borrower" hint="Scan the ID card, or type the admission / staff number."><input className="input" autoFocus required value={code} onChange={e => setCode(e.target.value)} /></Field>
        <Field label="Loan days (blank = school default)"><input className="input" type="number" min={1} value={days} onChange={e => setDays(e.target.value)} /></Field>
        {err && <Alert>{err}</Alert>}
        <div className="flex justify-end gap-2"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary">Issue</button></div>
      </form>
    </Modal>
  );
}
