"use client";
import { useCallback, useState } from "react";
import { useApi, send, Page, PageHeader, Tabs, Alert, Empty, Modal, Field, Badge, fmtDate, money, rolesOf, type Me } from "@/components/ui";
import ScanInput from "@/components/library/ScanInput";
import { loanState } from "@/lib/library";
import { OPEN_LIBRARY } from "@/lib/open-library";

type Book = { id: string; isbn: string | null; barcode: string | null; title: string; author: string | null; publisher: string | null; category: string | null; shelf: string | null; total_copies: number;
  available_copies: number; format: string; cover_url: string | null; description: string | null; year: number | null; edition: string | null; language: string | null; price: number | null;
  access: string; views: number; has_file: boolean; digital_url?: string | null; waiting: number; held: number;
  download_url?: string | null; licence?: string | null; levels?: string | null; curricula?: string[] | null };
type Loan = { id: string; issued_at: string; due_at: string; returned_at: string | null; fine_amount: number; fine_status: string; renewals: number; lost_at: string | null; borrower: string; library_books: { title: string } | null };
type Tab = "desk" | "catalogue" | "loans" | "overdue" | "fines" | "reservations" | "history" | "mine" | "settings";
const FORMAT: Record<string, string> = { print: "Book", ebook: "E-book", audio: "Audiobook", video: "Video", link: "Online" };

export default function LibraryPage() {
  const { data: me } = useApi<Me>("/api/me");
  const roles = rolesOf(me);
  const lib = ["librarian", "school_admin", "principal", "platform_admin"].some(r => roles.has(r));
  const admin = ["school_admin", "principal", "platform_admin"].some(r => roles.has(r));
  const reader = roles.has("student") || [...roles].some(r => !["parent", "alumni"].includes(r));
  const [tab, setTab] = useState<Tab | null>(null);
  const tabs: { id: Tab; label: string }[] = lib
    ? [{ id: "desk", label: "Desk" }, { id: "catalogue", label: "Catalogue" }, { id: "loans", label: "On loan" }, { id: "overdue", label: "Overdue" }, { id: "fines", label: "Fines" },
       { id: "reservations", label: "Reservations" }, { id: "history", label: "Returned" }, ...(admin ? [{ id: "settings" as Tab, label: "Settings" }] : [])]
    : [{ id: "catalogue", label: "Catalogue & e-library" }, ...(reader ? [{ id: "mine" as Tab, label: "My books" }] : [])];
  const active = tab && tabs.some(t => t.id === tab) ? tab : tabs[0].id;
  return (
    <Page wide>
      <PageHeader eyebrow="Library" title="Library" subtitle="Scan a reader's card and a book's barcode to lend or return. Reservations queue up and the next reader is told when a copy is waiting. E-books, audiobooks and videos open online. Overdue readers and their parents are reminded." />
      <Tabs value={active} onChange={setTab} tabs={tabs} />
      {active === "desk" && <Desk />}
      {active === "catalogue" && <Catalogue lib={lib} reader={reader} />}
      {["loans", "overdue", "fines", "history"].includes(active) && <Loans view={active} />}
      {active === "reservations" && <Reservations />}
      {active === "mine" && <Mine />}
      {active === "settings" && <Settings />}
    </Page>
  );
}

function Desk() {
  const [reader, setReader] = useState<string | null>(null);
  const [log, setLog] = useState<{ ok: boolean; text: string }[]>([]);
  const add = (ok: boolean, text: string) => setLog(l => [{ ok, text }, ...l].slice(0, 12));
  const onBorrow = useCallback(async (code: string) => {
    if (/^EDU:/i.test(code) || !reader) { setReader(code); add(true, `Reader: ${code.replace(/^EDU:/i, "")}. Now scan the books to lend.`); return; }
    const r = await send("/api/library", { action: "issue", book_code: code, borrower_code: reader });
    add(r.ok, r.ok ? `Lent (${code}).` : r.error ?? "failed");
  }, [reader]);
  const onReturn = useCallback(async (code: string) => {
    const r = await send<{ fine: number; hold_for: string | null }>("/api/library", { action: "return", book_code: code });
    add(r.ok, r.ok ? `Returned (${code}).${r.data.fine ? ` Fine due: ${r.data.fine}.` : ""}${r.data.hold_for ? ` Put it aside for ${r.data.hold_for}, who reserved it.` : ""}` : r.error ?? "failed");
  }, []);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="card space-y-2 p-4">
        <h2 className="font-semibold">Lend</h2>
        <p className="text-sm text-slate-600">{reader ? <>Lending to <b>{reader.replace(/^EDU:/i, "")}</b>. Scan each book. <button className="text-brand-700 underline" onClick={() => setReader(null)}>Next reader</button></> : "Scan the reader's ID card (or type an admission or staff number), then each book."}</p>
        <ScanInput onCode={onBorrow} placeholder={reader ? "Scan a book" : "Scan the reader's card"} autoFocus />
      </section>
      <section className="card space-y-2 p-4">
        <h2 className="font-semibold">Return</h2>
        <p className="text-sm text-slate-600">Scan each returned book. Late fines are worked out, and reserved books are flagged to put aside.</p>
        <ScanInput onCode={onReturn} placeholder="Scan a returned book" />
      </section>
      {log.length > 0 && <ul className="space-y-1 text-sm lg:col-span-2">{log.map((l, i) => <li key={i} className={l.ok ? "text-emerald-700" : "text-rose-700"}>{l.text}</li>)}</ul>}
    </div>
  );
}

function Catalogue({ lib, reader }: { lib: boolean; reader: boolean }) {
  const [q, setQ] = useState("");
  const [fmt, setFmt] = useState("");
  const books = useApi<Book[]>(`/api/library?view=catalogue&q=${encodeURIComponent(q)}${fmt ? `&format=${fmt}` : ""}`, [q, fmt]);
  const [edit, setEdit] = useState<Partial<Book> | null>(null);
  const [issue, setIssue] = useState<Book | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-sm" placeholder="Search title, author, ISBN, subject" value={q} onChange={e => setQ(e.target.value)} aria-label="Search books" />
        <select className="input w-auto" value={fmt} onChange={e => setFmt(e.target.value)} aria-label="Format"><option value="">Everything</option><option value="print">Books on the shelf</option><option value="digital">E-library</option><option value="free">Free collection</option></select>
        {lib && <button className="btn btn-outline ml-auto" title="Classic novels, inspirational books, open textbooks for every subject, and free learning sites. All can be read online; books can be downloaded." onClick={async () => {
          const r = await send<{ added: number; total: number }>("/api/library", { action: "add_open_collection" });
          setMsg({ ok: r.ok, text: r.ok ? (r.data.added ? `Added ${r.data.added} free titles to read and download.` : "The free collection is already in your library.") : r.error ?? "failed" });
          if (r.ok) { setFmt("free"); books.reload(); }
        }}>Add the free collection ({OPEN_LIBRARY.length})</button>}
        {lib && <button className="btn btn-primary" onClick={() => setEdit({ total_copies: 1, format: "print", access: "everyone" })}>+ Add a title</button>}
      </div>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      {!books.data?.length ? <Empty>No titles found.</Empty> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{books.data.map(b => {
          const free = Math.max(0, b.available_copies - b.held);
          return (
            <div key={b.id} className="card flex gap-3 p-3 text-sm">
              {b.cover_url
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={b.cover_url} alt="" className="h-24 w-16 flex-none rounded object-cover" loading="lazy" />
                : <div className="flex h-24 w-16 flex-none items-center justify-center rounded bg-slate-100 text-xs text-slate-400">{FORMAT[b.format]}</div>}
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{b.title}</p>
                <p className="text-xs text-slate-500">{[b.author, b.year, b.category].filter(Boolean).join(" · ")}</p>
                {b.levels && <p className="text-[11px] text-slate-500">{b.levels}{b.curricula?.length ? ` · ${b.curricula.map(c => ({ NG: "Nigerian", UK: "British", US: "American" } as Record<string, string>)[c] ?? c).join(", ")}` : ""}{b.licence ? ` · ${b.licence}` : ""}</p>}
                {b.format === "print" ? <p className="mt-1"><Badge tone={free ? "green" : "red"}>{free} of {b.total_copies} on the shelf</Badge>{b.waiting ? <span className="ml-1 text-xs text-amber-700">{b.waiting} waiting</span> : null}{b.shelf && <span className="ml-1 text-xs text-slate-500">shelf {b.shelf}</span>}</p>
                  : <p className="mt-1"><Badge tone="blue">{FORMAT[b.format]}</Badge>{b.access !== "everyone" && <span className="ml-1 text-xs text-slate-500">{b.access} only</span>}</p>}
                <div className="mt-1 flex flex-wrap gap-1">
                  {b.format !== "print" && b.has_file && <a className="btn btn-primary px-2 py-1 text-xs" href={`/api/library?open=${b.id}`} target="_blank" rel="noreferrer">{b.download_url || b.format === "ebook" ? "Read" : "Open"}</a>}
                  {b.download_url && <a className="btn btn-outline px-2 py-1 text-xs" href={b.download_url} target="_blank" rel="noreferrer" download>Download</a>}
                  {b.format === "print" && reader && !lib && <button className="btn btn-outline px-2 py-1 text-xs" onClick={async () => { const r = await send<{ status: string }>("/api/library", { action: "reserve", book_id: b.id }); setMsg({ ok: r.ok, text: r.ok ? (r.data.status === "ready" ? "A copy is being kept for you at the library." : "Reserved. You will be told when a copy is waiting for you.") : r.error ?? "" }); books.reload(); }}>Reserve</button>}
                  {lib && b.format === "print" && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setIssue(b)}>Lend</button>}
                  {lib && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setEdit(b)}>Edit</button>}
                </div>
              </div>
            </div>
          );
        })}</div>
      )}
      <BookForm book={edit} onClose={() => setEdit(null)} onSaved={t => { setEdit(null); setMsg({ ok: true, text: t }); books.reload(); }} />
      <Modal open={Boolean(issue)} onClose={() => setIssue(null)} title={`Lend: ${issue?.title ?? ""}`}>
        {issue && <div className="space-y-2"><p className="text-sm text-slate-600">Scan the reader’s ID card or type their admission or staff number.</p>
          <ScanInput autoFocus placeholder="Reader" onCode={async code => { const r = await send("/api/library", { action: "issue", book_id: issue.id, borrower_code: code }); setMsg({ ok: r.ok, text: r.ok ? "Lent." : r.error ?? "" }); if (r.ok) { setIssue(null); books.reload(); } }} /></div>}
      </Modal>
    </div>
  );
}

function BookForm({ book, onClose, onSaved }: { book: Partial<Book> | null; onClose: () => void; onSaved: (t: string) => void }) {
  const [b, setB] = useState<Partial<Book>>({});
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const cur = { ...book, ...b };
  const set = (k: keyof Book, v: unknown) => setB({ ...b, [k]: v });
  const lookup = async (isbn: string) => {
    setLooking(true); setErr(null);
    const r = await fetch(`/api/library?view=lookup&isbn=${encodeURIComponent(isbn)}`).then(x => x.json()).catch(() => ({}));
    setLooking(false);
    if (r.existing) return setErr(`Already in the catalogue: "${r.existing.title}" (${r.existing.total_copies} copies). Edit it to add copies.`);
    if (r.error && !r.found) return setErr(r.error);
    if (!r.found) return setB({ ...b, isbn: r.isbn ?? isbn });
    setB({ ...b, ...r.found });
  };
  return (
    <Modal open={Boolean(book)} onClose={() => { setB({}); setFile(null); setErr(null); onClose(); }} title={cur.id ? "Edit title" : "Add a title"} wide>
      <form className="grid gap-3 sm:grid-cols-3" onSubmit={async e => {
        e.preventDefault();
        const r = await send<{ id: string }>("/api/library", { action: "save_book", book: { id: cur.id, isbn: cur.isbn || null, barcode: cur.barcode || null, title: cur.title, author: cur.author || null,
          publisher: cur.publisher || null, category: cur.category || null, shelf: cur.shelf || null, total_copies: Number(cur.total_copies ?? 1), format: cur.format ?? "print",
          cover_url: cur.cover_url || null, description: cur.description || null, year: cur.year ? Number(cur.year) : null, edition: cur.edition || null, language: cur.language || null,
          price: cur.price ? Number(cur.price) : null, digital_url: cur.digital_url || null, access: cur.access ?? "everyone" } });
        if (!r.ok) return setErr(r.error);
        const id = cur.id ?? r.data.id;
        if (file && id) {
          const fd = new FormData(); fd.set("book_id", id); fd.set("file", file);
          const up = await fetch("/api/library/digital", { method: "POST", body: fd });
          if (!up.ok) return setErr((await up.json().catch(() => ({}))).error ?? "The file did not upload");
        }
        setB({}); setFile(null); setErr(null); onSaved("Saved.");
      }}>
        {!cur.id && <div className="sm:col-span-3"><Field label="Scan or type the ISBN to fill in the details"><ScanInput placeholder="ISBN" onCode={lookup} /></Field>{looking && <p className="text-xs text-slate-500">Looking it up…</p>}</div>}
        <div className="sm:col-span-2"><Field label="Title"><input className="input" required value={cur.title ?? ""} onChange={e => set("title", e.target.value)} /></Field></div>
        <Field label="Format"><select className="input" value={cur.format ?? "print"} onChange={e => set("format", e.target.value)}>{Object.entries(FORMAT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Author"><input className="input" value={cur.author ?? ""} onChange={e => set("author", e.target.value)} /></Field>
        <Field label="Publisher"><input className="input" value={cur.publisher ?? ""} onChange={e => set("publisher", e.target.value)} /></Field>
        <Field label="Year"><input className="input" type="number" min={1400} max={2200} value={cur.year ?? ""} onChange={e => set("year", e.target.value)} /></Field>
        <Field label="ISBN"><input className="input" value={cur.isbn ?? ""} onChange={e => set("isbn", e.target.value)} /></Field>
        <Field label="Library barcode (if no ISBN)"><input className="input" value={cur.barcode ?? ""} onChange={e => set("barcode", e.target.value)} /></Field>
        <Field label="Subject / category"><input className="input" value={cur.category ?? ""} onChange={e => set("category", e.target.value)} /></Field>
        {(cur.format ?? "print") === "print" ? <>
          <Field label="Copies"><input className="input" type="number" min={0} value={cur.total_copies ?? 1} onChange={e => set("total_copies", e.target.value)} /></Field>
          <Field label="Shelf"><input className="input" value={cur.shelf ?? ""} onChange={e => set("shelf", e.target.value)} /></Field>
          <Field label="Price (charged if lost)"><input className="input" type="number" min={0} step="any" value={cur.price ?? ""} onChange={e => set("price", e.target.value)} /></Field>
        </> : <>
          <Field label="Who can open it"><select className="input" value={cur.access ?? "everyone"} onChange={e => set("access", e.target.value)}><option value="everyone">Everyone, families too</option><option value="students">Students and staff</option><option value="staff">Staff only</option></select></Field>
          <Field label="Link (or upload a file)"><input className="input" type="url" value={cur.digital_url ?? ""} onChange={e => set("digital_url", e.target.value)} /></Field>
          <Field label="File (PDF, audio, video; 50 MB)"><input className="input" type="file" accept="application/pdf,audio/mpeg,audio/mp4,video/mp4" onChange={e => setFile(e.target.files?.[0] ?? null)} /></Field>
          <p className="text-xs text-slate-500 sm:col-span-3">Only upload books you have the right to share (out of copyright, your own, or licensed to the school).</p>
        </>}
        <Field label="Edition"><input className="input" value={cur.edition ?? ""} onChange={e => set("edition", e.target.value)} /></Field>
        <Field label="Language"><input className="input" value={cur.language ?? ""} onChange={e => set("language", e.target.value)} /></Field>
        <Field label="Cover image link"><input className="input" type="url" value={cur.cover_url ?? ""} onChange={e => set("cover_url", e.target.value)} /></Field>
        <div className="sm:col-span-3"><Field label="Description"><textarea className="input" rows={2} value={cur.description ?? ""} onChange={e => set("description", e.target.value)} /></Field></div>
        {err && <div className="sm:col-span-3"><Alert>{err}</Alert></div>}
        <button className="btn btn-primary sm:col-span-3">Save</button>
      </form>
    </Modal>
  );
}

function Loans({ view }: { view: string }) {
  const { data, reload } = useApi<Loan[]>(`/api/library?view=${view}`, [view]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const act = async (body: object, ok: (d: any) => string) => { const r = await send<any>("/api/library", body); setMsg({ ok: r.ok, text: r.ok ? ok(r.data) : r.error ?? "" }); reload(); };
  if (!data) return null;
  return (
    <div className="space-y-2">
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      {view === "overdue" && <p className="text-sm text-slate-600">Parents get a weekly reminder and readers one every few days, without you doing anything.</p>}
      {!data.length ? <Empty>Nothing here.</Empty> : (
        <div className="card overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[13px] text-slate-500"><tr><th className="p-2">Book</th><th className="p-2">Reader</th><th className="p-2">Out</th><th className="p-2">Due</th><th className="p-2">Fine</th><th className="p-2" /></tr></thead>
          <tbody>{data.map(l => {
            const st = loanState(l);
            return (
              <tr key={l.id} className="border-t border-slate-100"><td className="p-2 font-medium">{l.library_books?.title}{l.renewals > 0 && <span className="text-xs text-slate-400"> · renewed {l.renewals}×</span>}</td><td className="p-2">{l.borrower}</td>
                <td className="p-2">{fmtDate(l.issued_at)}</td>
                <td className="p-2">{l.returned_at ? (l.lost_at ? <Badge tone="red">lost</Badge> : `back ${fmtDate(l.returned_at)}`) : <>{fmtDate(l.due_at)} {st.state === "overdue" && <Badge tone="red">{st.days}d late</Badge>}</>}</td>
                <td className="p-2">{Number(l.fine_amount) > 0 ? <>{money(l.fine_amount)} <Badge tone={l.fine_status === "owed" ? "amber" : "green"}>{l.fine_status}</Badge></> : ""}</td>
                <td className="whitespace-nowrap p-2 text-right">
                  {!l.returned_at && <>
                    <button className="btn btn-primary px-2 py-1 text-xs" onClick={() => act({ action: "return", loan_id: l.id }, d => `Returned.${d.fine ? ` Fine due: ${d.fine}.` : ""}${d.hold_for ? ` Put it aside for ${d.hold_for}.` : ""}`)}>Return</button>
                    <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => act({ action: "renew", loan_id: l.id }, d => `Renewed to ${fmtDate(d.due_at)}.`)}>Renew</button>
                    <button className="btn btn-ghost px-2 py-1 text-xs text-rose-600" onClick={() => confirm("Mark this book lost? The reader will owe its price.") && act({ action: "lost", loan_id: l.id }, d => `Marked lost.${d.charge ? ` ${d.charge} owed.` : ""}`)}>Lost</button></>}
                  {l.fine_status === "owed" && <>
                    <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => act({ action: "settle_fine", loan_id: l.id, status: "paid" }, () => "Fine paid.")}>Paid</button>
                    <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => act({ action: "settle_fine", loan_id: l.id, status: "waived" }, () => "Fine waived.")}>Waive</button></>}
                </td></tr>
            );
          })}</tbody></table></div>
      )}
    </div>
  );
}

function Reservations() {
  const { data, reload } = useApi<any[]>("/api/library?view=reservations");
  if (!data) return null;
  return !data.length ? <Empty>No reservations.</Empty> : (
    <div className="card overflow-x-auto"><table className="w-full text-sm">
      <thead className="bg-slate-50 text-left text-[13px] text-slate-500"><tr><th className="p-2">Book</th><th className="p-2">Reader</th><th className="p-2">Status</th><th className="p-2" /></tr></thead>
      <tbody>{data.map(r => <tr key={r.id} className="border-t border-slate-100"><td className="p-2">{r.library_books?.title}</td><td className="p-2">{r.reader}</td>
        <td className="p-2">{r.status === "ready" ? <Badge tone="green">waiting at the desk until {fmtDate(r.expires_at)}</Badge> : <Badge>in the queue since {fmtDate(r.created_at)}</Badge>}</td>
        <td className="p-2 text-right"><button className="btn btn-ghost px-2 py-1 text-xs" onClick={async () => { await send("/api/library", { action: "cancel_reservation", id: r.id }); reload(); }}>Cancel</button></td></tr>)}</tbody></table></div>
  );
}

function Mine() {
  const { data, reload } = useApi<{ loans: any[]; reservations: any[]; settings: any }>("/api/library?view=mine");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!data) return null;
  const open = data.loans.filter(l => !l.returned_at);
  const owed = data.loans.filter(l => l.fine_status === "owed").reduce((s, l) => s + Number(l.fine_amount), 0);
  return (
    <div className="space-y-4">
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      {owed > 0 && <Alert tone="amber">You owe {money(owed)} in library fines.</Alert>}
      <section><h2 className="mb-2 font-semibold">On loan ({open.length}{data.settings ? ` of ${data.settings.library_max_loans}` : ""})</h2>
        {!open.length ? <Empty>Nothing out at the moment.</Empty> : <ul className="space-y-1 text-sm">{open.map(l => { const st = loanState(l); return (
          <li key={l.id} className="card flex flex-wrap items-center gap-2 p-3"><b>{l.library_books?.title}</b><span className="text-slate-500">due {fmtDate(l.due_at)}</span>{st.state === "overdue" && <Badge tone="red">{st.days} days late</Badge>}{st.state === "due_soon" && <Badge tone="amber">due soon</Badge>}
            <button className="btn btn-outline ml-auto px-2 py-1 text-xs" onClick={async () => { const r = await send<{ due_at: string }>("/api/library", { action: "renew", loan_id: l.id }); setMsg({ ok: r.ok, text: r.ok ? `Renewed until ${fmtDate(r.data.due_at)}.` : r.error ?? "" }); reload(); }}>Renew</button></li>); })}</ul>}</section>
      {data.reservations.length > 0 && <section><h2 className="mb-2 font-semibold">Reserved</h2><ul className="space-y-1 text-sm">{data.reservations.map(r => (
        <li key={r.id} className="flex flex-wrap items-center gap-2">{r.library_books?.title} {r.status === "ready" ? <Badge tone="green">collect by {fmtDate(r.expires_at)}</Badge> : <Badge>waiting for a copy</Badge>}
          <button className="text-xs text-rose-600" onClick={async () => { await send("/api/library", { action: "cancel_reservation", id: r.id }); reload(); }}>cancel</button></li>))}</ul></section>}
    </div>
  );
}

function Settings() {
  const { data } = useApi<{ settings: Record<string, number> }>("/api/school/settings");
  const [f, setF] = useState<Record<string, number> | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const s = f ?? (data ? { library_loan_days: data.settings.library_loan_days ?? 14, library_fine_per_day: data.settings.library_fine_per_day ?? 0, library_max_loans: data.settings.library_max_loans ?? 3,
    library_hold_days: data.settings.library_hold_days ?? 3, library_max_renewals: data.settings.library_max_renewals ?? 2 } : null);
  if (!s) return null;
  const num = (k: string, label: string) => <Field label={label}><input className="input" type="number" min={0} step="any" value={s[k]} onChange={e => setF({ ...s, [k]: Number(e.target.value) })} /></Field>;
  return (
    <form className="card grid max-w-2xl gap-3 p-5 sm:grid-cols-2" onSubmit={async e => { e.preventDefault(); const r = await send("/api/library", { action: "settings", ...s }); setMsg({ ok: r.ok, text: r.ok ? "Saved." : r.error ?? "" }); }}>
      {num("library_loan_days", "Loan length (days)")}{num("library_fine_per_day", "Fine per late day")}{num("library_max_loans", "Books a student may have out")}
      {num("library_hold_days", "Days a reserved book is kept")}{num("library_max_renewals", "Renewals allowed")}
      {msg && <div className="sm:col-span-2"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      <button className="btn btn-primary sm:col-span-2">Save</button>
    </form>
  );
}
