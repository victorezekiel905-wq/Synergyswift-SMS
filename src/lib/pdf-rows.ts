import { PDFParse } from "pdf-parse";

/**
 * A PDF list (a class register, a whole school's student list) as rows of cells:
 * each line is a row, and wide gaps between words become cell breaks. Page
 * numbers and "Page 2 of 5" footers are dropped.
 */
export async function pdfRows(bytes: Uint8Array): Promise<string[][]> {
  const parser = new PDFParse({ data: Buffer.from(bytes) });
  try {
    const { text } = await parser.getText({ cellSeparator: "\t", pageJoiner: "" });
    return text.split(/\r?\n/)
      .map(line => line.split("\t").map(c => c.replace(/\s+/g, " ").trim()))
      .filter(r => r.some(Boolean))
      .filter(r => !(r.filter(Boolean).length === 1 && /^(page\s*)?\d+(\s*(of|\/)\s*\d+)?$/i.test(r.filter(Boolean)[0])));
  } finally {
    await parser.destroy().catch(() => {});
  }
}
