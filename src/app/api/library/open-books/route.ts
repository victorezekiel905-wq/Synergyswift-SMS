import { NextRequest, NextResponse } from "next/server";
import { requireCtx } from "@/lib/auth";

export const dynamic = "force-dynamic";

const PER_PAGE = 24;
const SECTIONS = ["textbooks", "storybooks", "children", "fiction", "poetry", "history", "science", "self_help", "education", "arts"];
const LEVELS = ["early_years", "primary", "secondary", "tertiary"];

/**
 * The free library (migration 9100): search the books every school has, by words,
 * section, level and school subject. Anyone signed in to a school with the library on.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(undefined, "library");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url).searchParams;
  const q = (u.get("q") ?? "").trim().slice(0, 120);
  const section = u.get("section") ?? "", level = u.get("level") ?? "", subject = (u.get("subject") ?? "").trim().slice(0, 60);
  const page = Math.max(1, Math.min(500, Number(u.get("page")) || 1));
  let query = ctx.sb.from("open_books").select("id,source,section,title,authors,description,subjects,level,read_url,download_url,cover_url,licence", { count: "exact" });
  if (q) query = query.textSearch("search", q.split(/\s+/).filter(Boolean).map(w => w.replace(/[^\p{L}\p{N}'-]/gu, "")).filter(Boolean).join(" & "), { config: "simple" });
  if (SECTIONS.includes(section)) query = query.eq("section", section);
  if (LEVELS.includes(level)) query = query.in("level", [level, "all"]);
  if (subject) query = query.contains("subjects", [subject]);
  const { data, count, error } = await query.order("title").range((page - 1) * PER_PAGE, page * PER_PAGE - 1);
  if (error) {
    if (/open_books/.test(error.message)) return NextResponse.json({ books: [], total: 0, page, per_page: PER_PAGE, missing: true });
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ books: data ?? [], total: count ?? 0, page, per_page: PER_PAGE });
}
