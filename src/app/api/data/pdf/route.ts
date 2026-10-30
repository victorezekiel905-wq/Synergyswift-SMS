import { NextRequest, NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";
import { requireCtx, ROLES, jsonError } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * A PDF list (a class register, a whole school's student list) as rows of cells,
 * for the import screen: each line is a row, and wide gaps between words become
 * cell breaks. Nothing is stored.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return jsonError("choose a PDF file");
  if (file.size > 8_000_000) return jsonError("the PDF is larger than 8 MB; split it into smaller files");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") return jsonError("this is not a PDF file");
  const parser = new PDFParse({ data: Buffer.from(bytes) });
  try {
    const { text } = await parser.getText({ cellSeparator: "\t", pageJoiner: "" });
    const rows = text.split(/\r?\n/)
      .map(line => line.split("\t").map(c => c.replace(/\s+/g, " ").trim()))
      .filter(r => r.some(Boolean))
      // Page numbers and "Page 2 of 5" footers aren't students.
      .filter(r => !(r.filter(Boolean).length === 1 && /^(page\s*)?\d+(\s*(of|\/)\s*\d+)?$/i.test(r.filter(Boolean)[0])));
    if (!rows.length) return jsonError("no text found in this PDF. If it is a scanned picture, type the list into a spreadsheet instead.");
    if (rows.length > 6000) return jsonError(`the PDF has ${rows.length} lines; import at most 5000 students at a time`);
    return NextResponse.json({ rows });
  } catch {
    return jsonError("this PDF couldn't be read. Save it again as PDF, or export the list as CSV or Excel.");
  } finally {
    await parser.destroy().catch(() => {});
  }
}
