import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { studentName } from "@/lib/school";

/** Catalogue search + open/overdue loans. ?view=loans|overdue|catalogue */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(undefined, "library");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url);
  const view = u.searchParams.get("view") ?? "catalogue";
  const tid = ctx.tenant.id;
  if (view === "catalogue") {
    const q = (u.searchParams.get("q") ?? "").replace(/[%,()]/g, " ").trim();
    let query = ctx.sb.from("library_books").select("*").eq("tenant_id", tid).order("title").limit(300);
    if (q) query = query.or(`title.ilike.%${q}%,author.ilike.%${q}%,isbn.ilike.%${q}%,category.ilike.%${q}%`);
    const { data, error } = await query;
    return error ? jsonError(error.message) : NextResponse.json(data ?? []);
  }
  let query = ctx.sb.from("library_loans")
    .select("id,issued_at,due_at,returned_at,fine_amount,library_books(id,title,author),students(id,first_name,last_name,other_names,admission_no,class_groups(name)),staff(id,full_name)")
    .eq("tenant_id", tid).order("due_at").limit(1000);
  if (view === "loans") query = query.is("returned_at", null);
  if (view === "overdue") query = query.is("returned_at", null).lt("due_at", new Date().toISOString());
  if (view === "history") query = query.not("returned_at", "is", null).order("returned_at", { ascending: false });
  const { data, error } = await query;
  if (error) return jsonError(error.message);
  return NextResponse.json((data ?? []).map((l: any) => ({
    ...l, borrower: l.students ? `${studentName(l.students)} (${l.students.class_groups?.name ?? l.students.admission_no})` : l.staff?.full_name
  })));
}

const Book = z.object({
  id: z.string().uuid().optional(),
  isbn: z.string().trim().max(20).nullish(),
  title: z.string().trim().min(1).max(200),
  author: z.string().trim().max(160).nullish(),
  publisher: z.string().trim().max(160).nullish(),
  category: z.string().trim().max(80).nullish(),
  shelf: z.string().trim().max(40).nullish(),
  total_copies: z.number().int().min(0).max(10000)
});

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_book"), book: Book }),
  z.object({ action: z.literal("issue"), book_id: z.string().uuid(), borrower_code: z.string().trim().min(1).max(80), days: z.number().int().min(1).max(365).optional() }),
  z.object({ action: z.literal("return"), loan_id: z.string().uuid() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.library, "library");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const sb = ctx.sb;
  const { data: settings } = await sb.from("tenant_settings").select("library_loan_days,library_fine_per_day").eq("tenant_id", tid).maybeSingle();

  if (b.action === "save_book") {
    const { id, ...book } = b.book;
    if (id) {
      const { data: cur } = await sb.from("library_books").select("total_copies,available_copies").eq("tenant_id", tid).eq("id", id).maybeSingle();
      if (!cur) return jsonError("book not found", 404);
      const onLoan = cur.total_copies - cur.available_copies;
      if (book.total_copies < onLoan) return jsonError(`${onLoan} copies are on loan; total cannot be lower`);
      const { error } = await sb.from("library_books").update({ ...book, available_copies: book.total_copies - onLoan }).eq("id", id);
      return error ? jsonError(error.message) : NextResponse.json({ id });
    }
    const { data, error } = await sb.from("library_books").insert({ ...book, tenant_id: tid, available_copies: book.total_copies }).select("id").single();
    return error ? jsonError(error.message) : NextResponse.json(data, { status: 201 });
  }

  if (b.action === "issue") {
    // Borrower by admission / staff number or ID-card code.
    const code = b.borrower_code.replace(/^EDU:/i, "").replace(/[,()]/g, "");
    const { data: st } = await sb.from("students").select("id").eq("tenant_id", tid).eq("status", "active")
      .or(`admission_no.eq.${code},card_code.eq.${code}`).limit(1);
    let studentId: string | null = st?.[0]?.id ?? null, staffId: string | null = null;
    if (!studentId) {
      const { data: sf } = await sb.from("staff").select("id").eq("tenant_id", tid).or(`staff_no.eq.${code},card_code.eq.${code}`).limit(1);
      staffId = sf?.[0]?.id ?? null;
    }
    if (!studentId && !staffId) return jsonError("no student or staff member with that number", 404);
    const { data, error } = await sb.rpc("library_issue", { p_book: b.book_id, p_student: studentId, p_staff: staffId, p_days: b.days ?? settings?.library_loan_days ?? 14 });
    return error ? jsonError(error.message) : NextResponse.json({ loan_id: data }, { status: 201 });
  }

  const { data: fine, error } = await sb.rpc("library_return", { p_loan: b.loan_id, p_fine_per_day: settings?.library_fine_per_day ?? 0 });
  return error ? jsonError(error.message) : NextResponse.json({ fine: Number(fine ?? 0) });
}
