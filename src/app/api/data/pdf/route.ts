import { NextRequest, NextResponse } from "next/server";
import { requireCtx, ROLES, jsonError } from "@/lib/auth";
import { pdfRows } from "@/lib/pdf-rows";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A PDF list as rows of cells, for the import screen (lib/pdf-rows). Nothing is stored. */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return jsonError("choose a PDF file");
  if (file.size > 8_000_000) return jsonError("the PDF is larger than 8 MB; split it into smaller files");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") return jsonError("this is not a PDF file");
  let rows: string[][];
  try { rows = await pdfRows(bytes); }
  catch { return jsonError("this PDF couldn't be read. Save it again as PDF, or export the list as CSV or Excel."); }
  if (!rows.length) return jsonError("no text found in this PDF. If it is a scanned picture, type the list into a spreadsheet instead.");
  if (rows.length > 6000) return jsonError(`the PDF has ${rows.length} lines; import at most 5000 students at a time`);
  return NextResponse.json({ rows });
}
