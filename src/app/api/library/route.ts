import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { studentName } from "@/lib/school";
import { classifyScan, parseOpenLibrary, canOpen, toIsbn13 } from "@/lib/library";

export const dynamic = "force-dynamic";

const LOAN = "id,book_id,issued_at,due_at,returned_at,fine_amount,fine_status,renewals,lost_at,library_books(id,title,author,isbn),students(id,first_name,last_name,other_names,admission_no,class_groups(name)),staff(id,full_name)";
const borrower = (l: any) => l.students ? `${studentName(l.students)} (${l.students.class_groups?.name ?? l.students.admission_no})` : l.staff?.full_name;

async function me(ctx: any) {
  const [{ data: s }, { data: f }] = await Promise.all([
    ctx.sb.from("students").select("id").eq("tenant_id", ctx.tenant.id).eq("user_id", ctx.userId).maybeSingle(),
    ctx.sb.from("staff").select("id").eq("tenant_id", ctx.tenant.id).eq("user_id", ctx.userId).maybeSingle()
  ]);
  return { student: (s?.id ?? null) as string | null, staff: (f?.id ?? null) as string | null };
}

/** A borrower from an admission or staff number, or the code on their ID card. */
async function findBorrower(sb: any, tid: string, raw: string) {
  const code = raw.replace(/^EDU:/i, "").replace(/[,()]/g, "").trim();
  const { data: st } = await sb.from("students").select("id").eq("tenant_id", tid).eq("status", "active").or(`admission_no.eq.${code},card_code.eq.${code}`).limit(1);
  if (st?.[0]) return { student: st[0].id as string, staff: null };
  const { data: sf } = await sb.from("staff").select("id").eq("tenant_id", tid).or(`staff_no.eq.${code},card_code.eq.${code}`).limit(1);
  return sf?.[0] ? { student: null, staff: sf[0].id as string } : null;
}

/** A title from a scanned ISBN or the library's own label. */
async function findBook(sb: any, tid: string, raw: string) {
  const s = classifyScan(raw);
  if (s.kind === "card") return null;
  const q = s.kind === "isbn" ? sb.from("library_books").select("id,title,available_copies,format").eq("tenant_id", tid).eq("isbn", s.isbn)
    : sb.from("library_books").select("id,title,available_copies,format").eq("tenant_id", tid).eq("barcode", s.code);
  const { data } = await q.limit(1);
  return data?.[0] ?? null;
}

/**
 * GET ?view=catalogue[&q=&format=]   search (everyone in the school)
 * GET ?view=loans|overdue|history|fines|reservations   the desk (library staff)
 * GET ?view=mine                      the signed-in reader's loans and reservations
 * GET ?view=lookup&isbn=              details from Open Library for a new book
 * GET ?open=<book id>                 opens a digital item for those allowed
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(undefined, "library");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url).searchParams;
  const view = u.get("view") ?? "catalogue";
  const tid = ctx.tenant.id, sb = ctx.sb, lib = hasAny(ctx, ROLES.library);

  const open = u.get("open");
  if (open) {
    const { data: b } = await sb.from("library_books").select("id,format,access,digital_path,digital_url,views").eq("tenant_id", tid).eq("id", open).maybeSingle();
    if (!b || b.format === "print") return jsonError("not found", 404);
    if (!canOpen(b.access, ctx.roles)) return jsonError("this item is not available to you", 403);
    const svc = createServiceClient();
    await svc.from("library_books").update({ views: (b.views ?? 0) + 1 }).eq("id", b.id);
    if (b.digital_url) return NextResponse.redirect(b.digital_url);
    if (!b.digital_path) return jsonError("no file attached", 404);
    const { data } = await svc.storage.from("library-digital").createSignedUrl(b.digital_path, 600);
    return data?.signedUrl ? NextResponse.redirect(data.signedUrl) : jsonError("not found", 404);
  }

  if (view === "catalogue") {
    const q = (u.get("q") ?? "").replace(/[%,()]/g, " ").trim();
    let query = sb.from("library_books").select("id,isbn,barcode,title,author,publisher,category,shelf,total_copies,available_copies,format,cover_url,description,year,edition,language,price,access,views,digital_url,digital_path")
      .eq("tenant_id", tid).order("title").limit(300);
    if (q) {
      const isbn = toIsbn13(q);
      query = isbn ? query.eq("isbn", isbn) : query.or(`title.ilike.%${q}%,author.ilike.%${q}%,isbn.ilike.%${q}%,category.ilike.%${q}%,barcode.eq.${q}`);
    }
    if (u.get("format") === "digital") query = query.neq("format", "print");
    if (u.get("format") === "print") query = query.eq("format", "print");
    const { data, error } = await query;
    if (error) return jsonError(error.message);
    // Holds count against what is on the shelf.
    const ids = (data ?? []).map((b: any) => b.id);
    const { data: holds } = ids.length ? await createServiceClient().from("library_reservations").select("book_id,status").in("book_id", ids).in("status", ["waiting", "ready"]) : { data: [] };
    return NextResponse.json((data ?? []).filter((b: any) => lib || b.format === "print" || canOpen(b.access, ctx.roles)).map((b: any) => ({
      ...b, digital_path: undefined, has_file: Boolean(b.digital_path || b.digital_url), digital_url: lib ? b.digital_url : undefined,
      waiting: (holds ?? []).filter((h: any) => h.book_id === b.id && h.status === "waiting").length,
      held: (holds ?? []).filter((h: any) => h.book_id === b.id && h.status === "ready").length })));
  }

  if (view === "mine") {
    const who = await me(ctx);
    if (!who.student && !who.staff) return NextResponse.json({ loans: [], reservations: [] });
    const col = who.student ? "student_id" : "staff_id", id = who.student ?? who.staff;
    const [{ data: loans }, { data: res }, { data: set }] = await Promise.all([
      sb.from("library_loans").select(LOAN).eq("tenant_id", tid).eq(col, id).order("issued_at", { ascending: false }).limit(50),
      sb.from("library_reservations").select("id,status,expires_at,created_at,library_books(id,title,author)").eq("tenant_id", tid).eq(col, id).in("status", ["waiting", "ready"]).order("created_at"),
      sb.from("tenant_settings").select("library_max_loans,library_max_renewals,library_loan_days").eq("tenant_id", tid).maybeSingle()
    ]);
    return NextResponse.json({ loans: loans ?? [], reservations: res ?? [], settings: set ?? null });
  }

  if (!lib) return jsonError("forbidden", 403);

  if (view === "lookup") {
    const isbn = toIsbn13(u.get("isbn") ?? "");
    if (!isbn) return jsonError("that is not an ISBN");
    const { data: have } = await sb.from("library_books").select("id,title,total_copies").eq("tenant_id", tid).eq("isbn", isbn).maybeSingle();
    if (have) return NextResponse.json({ existing: have, isbn });
    try {
      const r = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`, { headers: { "User-Agent": "school-library-catalogue" }, signal: AbortSignal.timeout(8000) });
      const found = r.ok ? parseOpenLibrary(await r.json(), isbn) : null;
      return NextResponse.json({ found, isbn });
    } catch {
      return NextResponse.json({ found: null, isbn, error: "Open Library did not answer; type the details in." });
    }
  }

  if (view === "reservations") {
    const { data } = await sb.from("library_reservations").select("id,status,expires_at,created_at,notified_at,library_books(id,title),students(first_name,last_name,other_names,class_groups(name)),staff(full_name)")
      .eq("tenant_id", tid).in("status", ["waiting", "ready"]).order("created_at");
    return NextResponse.json((data ?? []).map((r: any) => ({ ...r, reader: r.students ? `${studentName(r.students)} (${r.students.class_groups?.name ?? ""})` : r.staff?.full_name })));
  }

  let query = sb.from("library_loans").select(LOAN).eq("tenant_id", tid).order("due_at").limit(1000);
  if (view === "loans") query = query.is("returned_at", null);
  if (view === "overdue") query = query.is("returned_at", null).lt("due_at", new Date().toISOString());
  if (view === "history") query = query.not("returned_at", "is", null).order("returned_at", { ascending: false });
  if (view === "fines") query = query.eq("fine_status", "owed");
  const { data, error } = await query;
  if (error) return jsonError(error.message);
  return NextResponse.json((data ?? []).map((l: any) => ({ ...l, borrower: borrower(l) })));
}

const Book = z.object({
  id: z.string().uuid().optional(),
  isbn: z.string().trim().max(20).nullish().transform(v => v ? toIsbn13(v) ?? v.replace(/[^0-9X]/gi, "") : null),
  barcode: z.string().trim().max(40).nullish().transform(v => v || null),
  title: z.string().trim().min(1).max(200),
  author: z.string().trim().max(160).nullish(), publisher: z.string().trim().max(160).nullish(), category: z.string().trim().max(80).nullish(),
  shelf: z.string().trim().max(40).nullish(), total_copies: z.number().int().min(0).max(10000),
  format: z.enum(["print", "ebook", "audio", "video", "link"]).default("print"), cover_url: z.string().trim().url().max(500).nullish().or(z.literal("")).transform(v => v || null),
  description: z.string().trim().max(4000).nullish(), year: z.number().int().min(1400).max(2200).nullish(), edition: z.string().trim().max(40).nullish(),
  language: z.string().trim().max(40).nullish(), price: z.number().min(0).max(1e8).nullish(), digital_url: z.string().trim().url().max(1000).nullish().or(z.literal("")).transform(v => v || null),
  access: z.enum(["everyone", "staff", "students"]).default("everyone")
});
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_book"), book: Book }),
  z.object({ action: z.literal("issue"), book_id: z.string().uuid().optional(), book_code: z.string().trim().max(60).optional(), borrower_code: z.string().trim().min(1).max(80), days: z.number().int().min(1).max(365).optional() }),
  z.object({ action: z.literal("return"), loan_id: z.string().uuid().optional(), book_code: z.string().trim().max(60).optional() }),
  z.object({ action: z.literal("renew"), loan_id: z.string().uuid() }),
  z.object({ action: z.literal("lost"), loan_id: z.string().uuid() }),
  z.object({ action: z.literal("settle_fine"), loan_id: z.string().uuid(), status: z.enum(["paid", "waived"]) }),
  z.object({ action: z.literal("reserve"), book_id: z.string().uuid(), borrower_code: z.string().trim().max(80).optional() }),
  z.object({ action: z.literal("cancel_reservation"), id: z.string().uuid() }),
  z.object({ action: z.literal("settings"), library_loan_days: z.number().int().min(1).max(365), library_fine_per_day: z.number().min(0).max(100000),
    library_max_loans: z.number().int().min(1).max(50), library_hold_days: z.number().int().min(1).max(30), library_max_renewals: z.number().int().min(0).max(20) })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(undefined, "library");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id, sb = ctx.sb, lib = hasAny(ctx, ROLES.library);
  const readerActions = ["renew", "reserve", "cancel_reservation"];
  if (!lib && !readerActions.includes(b.action)) return jsonError("forbidden", 403);
  const fail = (m: string) => jsonError(m.replace(/^.*?ERROR: /, ""));
  const { data: settings } = await sb.from("tenant_settings").select("library_loan_days,library_fine_per_day").eq("tenant_id", tid).maybeSingle();

  switch (b.action) {
    case "save_book": {
      const { id, ...book } = b.book;
      if (book.format !== "print") book.total_copies = 0;
      if (id) {
        const { data: cur } = await sb.from("library_books").select("total_copies,available_copies").eq("tenant_id", tid).eq("id", id).maybeSingle();
        if (!cur) return jsonError("book not found", 404);
        const onLoan = cur.total_copies - cur.available_copies;
        if (book.total_copies < onLoan) return jsonError(`${onLoan} copies are on loan; total cannot be lower`);
        const { error } = await sb.from("library_books").update({ ...book, available_copies: book.total_copies - onLoan }).eq("id", id);
        return error ? fail(error.message.includes("duplicate") ? "another book has that barcode" : error.message) : NextResponse.json({ id });
      }
      const { data, error } = await sb.from("library_books").insert({ ...book, tenant_id: tid, available_copies: book.total_copies }).select("id").single();
      return error ? fail(error.message.includes("duplicate") ? "another book has that barcode" : error.message) : NextResponse.json(data, { status: 201 });
    }
    case "issue": {
      const who = await findBorrower(sb, tid, b.borrower_code);
      if (!who) return jsonError("no student or staff member with that number or card", 404);
      const bookId = b.book_id ?? (b.book_code ? (await findBook(sb, tid, b.book_code))?.id : null);
      if (!bookId) return jsonError("scan the book's barcode or choose it from the catalogue", 404);
      const { data, error } = await sb.rpc("library_issue", { p_book: bookId, p_student: who.student, p_staff: who.staff, p_days: b.days ?? settings?.library_loan_days ?? 14 });
      return error ? fail(error.message) : NextResponse.json({ loan_id: data }, { status: 201 });
    }
    case "return": {
      let loanId = b.loan_id;
      if (!loanId && b.book_code) {
        const book = await findBook(sb, tid, b.book_code);
        if (!book) return jsonError("no book with that barcode", 404);
        const { data: open } = await sb.from("library_loans").select("id").eq("tenant_id", tid).eq("book_id", book.id).is("returned_at", null).order("due_at");
        if (!open?.length) return jsonError(`no copy of "${book.title}" is out on loan`);
        if (open.length > 1) return jsonError(`${open.length} copies of "${book.title}" are out; return it from the loans list`);
        loanId = open[0].id;
      }
      if (!loanId) return jsonError("choose the loan");
      const { data: fine, error } = await sb.rpc("library_return", { p_loan: loanId, p_fine_per_day: settings?.library_fine_per_day ?? 0 });
      if (error) return fail(error.message);
      // Was the copy passed straight to someone in the queue?
      const { data: l } = await sb.from("library_loans").select("book_id").eq("id", loanId).maybeSingle();
      const { data: held } = l ? await sb.from("library_reservations").select("id,students(first_name,last_name,other_names),staff(full_name)").eq("book_id", l.book_id).eq("status", "ready").gte("ready_at", new Date(Date.now() - 60_000).toISOString()).limit(1) : { data: [] };
      const h: any = held?.[0];
      return NextResponse.json({ fine: Number(fine ?? 0), hold_for: h ? (h.students ? studentName(h.students) : h.staff?.full_name) : null });
    }
    case "renew": {
      const { data, error } = await sb.rpc("library_renew", { p_loan: b.loan_id });
      return error ? fail(error.message) : NextResponse.json({ due_at: data });
    }
    case "lost": {
      const { data, error } = await sb.rpc("library_lost", { p_loan: b.loan_id });
      return error ? fail(error.message) : NextResponse.json({ charge: Number(data ?? 0) });
    }
    case "settle_fine": {
      const { data, error } = await sb.from("library_loans").update({ fine_status: b.status }).eq("tenant_id", tid).eq("id", b.loan_id).eq("fine_status", "owed").select("id");
      if (error) return fail(error.message);
      return data?.length ? NextResponse.json({ ok: true }) : jsonError("no fine owed on this loan");
    }
    case "reserve": {
      let who: { student: string | null; staff: string | null } | null;
      if (b.borrower_code && lib) who = await findBorrower(sb, tid, b.borrower_code);
      else who = await me(ctx);
      if (!who || (!who.student && !who.staff)) return jsonError("only students and staff can reserve books", 404);
      const { data, error } = await sb.rpc("library_reserve", { p_book: b.book_id, p_student: who.student, p_staff: who.student ? null : who.staff });
      return error ? fail(error.message) : NextResponse.json({ status: data }, { status: 201 });
    }
    case "cancel_reservation": {
      const svc = createServiceClient();
      const { data: r } = await svc.from("library_reservations").select("id,student_id,staff_id,status").eq("tenant_id", tid).eq("id", b.id).maybeSingle();
      if (!r || !["waiting", "ready"].includes(r.status)) return jsonError("reservation not found", 404);
      const who = await me(ctx);
      if (!lib && r.student_id !== who.student && r.staff_id !== who.staff) return jsonError("forbidden", 403);
      await svc.from("library_reservations").update({ status: "cancelled" }).eq("id", r.id);
      if (r.status === "ready") await svc.rpc("library_expire_holds").then(() => null, () => null);
      return NextResponse.json({ ok: true });
    }
    case "settings": {
      const { action: _a, ...row } = b;
      const { data, error } = await sb.from("tenant_settings").update(row).eq("tenant_id", tid).select("tenant_id");
      if (error) return fail(error.message);
      return data?.length ? NextResponse.json({ ok: true }) : jsonError("only a school admin can change library settings", 403);
    }
  }
}
