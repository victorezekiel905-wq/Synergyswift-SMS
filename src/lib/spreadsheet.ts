/**
 * Read and write CSV and Excel (.xlsx) tables without a heavy dependency:
 * an .xlsx file is a zip of XML parts, read and written with JSZip.
 * Works in the browser and on the server. Unit tested.
 */
import JSZip from "jszip";

export type Table = { headers: string[]; rows: string[][] };

/** Parses CSV, semicolon- or tab-separated text (whichever the first line uses). */
export function parseDelimited(text: string): Table {
  const out = parseGrid(text);
  if (!out.length) return { headers: [], rows: [] };
  const headers = out[0].map(h => h.trim());
  return { headers, rows: out.slice(1).map(r => headers.map((_, i) => (r[i] ?? "").trim())) };
}

/**
 * Every non-empty row as it is in the file (rows keep their own length). The separator is
 * the one used by the first line that has any, so a file can start with a title or a
 * class heading on its own.
 */
export function parseGrid(text: string): string[][] {
  const s = text.replace(/^﻿/, "");
  const first = s.split(/\r?\n/).slice(0, 50).find(l => /[,;\t]/.test(l)) ?? "";
  const counts = [",", ";", "\t"].map(d => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1]);
  const delim = counts[0][1] > 1 ? counts[0][0] : ",";
  const out: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"' && cell === "") q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some(x => x.trim() !== "")) out.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some(x => x.trim() !== "")) out.push(row);
  return out;
}

export function toCsv(t: Table): string {
  // Cells that a spreadsheet would run as a formula get a leading apostrophe (numbers and phone numbers are left alone).
  const formula = (v: string) => /^[=@]/.test(v) || /^[+\-](?![\d.\s])/.test(v);
  const esc = (v: string) => { const x = formula(v) ? `'${v}` : v; return /[",\n\r]/.test(x) || formula(v) ? `"${x.replace(/"/g, '""')}"` : x; };
  return "﻿" + [t.headers, ...t.rows].map(r => r.map(c => esc(String(c ?? ""))).join(",")).join("\r\n");
}

// ---------------- xlsx ----------------

const xmlUnescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");
const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

/** "AB12" → column index 27 (0-based). */
export function columnIndex(ref: string): number {
  const letters = ref.replace(/\d+$/, "").toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
export function columnName(i: number): string {
  let s = "", n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/** Excel stores dates as days since 1899-12-30. */
export function excelDate(serial: number): string {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86400_000));
  return d.toISOString().slice(0, 10);
}

/** Reads the first worksheet of an .xlsx file. Date columns come back as YYYY-MM-DD. */
export async function readXlsx(data: ArrayBuffer | Uint8Array): Promise<Table> {
  const grid = await readXlsxGrid(data);
  if (!grid.length) return { headers: [], rows: [] };
  const headers = grid[0].map(h => h.trim());
  return { headers, rows: grid.slice(1).map(r => headers.map((_, i) => r[i] ?? "")) };
}

/** Every non-empty row of the first sheet as it is (rows keep their own length). */
export async function readXlsxGrid(data: ArrayBuffer | Uint8Array): Promise<string[][]> {
  const zip = await JSZip.loadAsync(data);
  const wb = await zip.file("xl/workbook.xml")?.async("string");
  if (!wb) throw new Error("this is not an Excel .xlsx file");
  const firstSheet = wb.match(/<sheet\b[^>]*r:id="([^"]+)"/)?.[1];
  const rels = (await zip.file("xl/_rels/workbook.xml.rels")?.async("string")) ?? "";
  let target = "worksheets/sheet1.xml";
  if (firstSheet) {
    const m = [...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)].map(x => x[1]).find(a => a.includes(`Id="${firstSheet}"`));
    const t = m?.match(/Target="([^"]+)"/)?.[1];
    if (t) target = t.replace(/^\/?xl\//, "").replace(/^\//, "");
  }
  const sheet = await zip.file(`xl/${target}`)?.async("string");
  if (!sheet) throw new Error("the workbook has no sheets");
  const sharedXml = (await zip.file("xl/sharedStrings.xml")?.async("string")) ?? "";
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => xmlUnescape([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join("")));
  // Number formats that are dates (built-in 14–22 and custom ones with d/m/y).
  const styles = (await zip.file("xl/styles.xml")?.async("string")) ?? "";
  const customDate = new Set([...styles.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]+)"/g)].filter(m => /[dmy]/i.test(m[2].replace(/\[[^\]]*\]|"[^"]*"/g, ""))).map(m => Number(m[1])));
  const xfs = (styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? "").match(/<xf\b[^>]*>/g) ?? [];
  const dateStyle = xfs.map(x => { const id = Number(x.match(/numFmtId="(\d+)"/)?.[1] ?? 0); return (id >= 14 && id <= 22) || customDate.has(id); });

  const grid: string[][] = [];
  for (const r of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1], inner = c[2] ?? "";
      const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1];
      const type = attrs.match(/t="([^"]+)"/)?.[1];
      const style = Number(attrs.match(/s="(\d+)"/)?.[1] ?? -1);
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let val = "";
      if (type === "s") val = shared[Number(v)] ?? "";
      else if (type === "inlineStr") val = xmlUnescape([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join(""));
      else if (type === "b") val = v === "1" ? "TRUE" : "FALSE";
      else if (v !== undefined) val = type !== "str" && dateStyle[style] && /^\d+(\.\d+)?$/.test(v) ? excelDate(Number(v)) : xmlUnescape(v);
      const idx = ref ? columnIndex(ref) : cells.length;
      cells[idx] = val.trim();
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = "";
    if (cells.some(x => x !== "")) grid.push(cells);
  }
  return grid;
}

/** A one-sheet .xlsx file. Every cell is text so admission numbers keep their leading zeros. */
export async function writeXlsx(t: Table, sheetName = "Sheet1"): Promise<Uint8Array> {
  const zip = new JSZip();
  const row = (cells: string[], r: number) => `<row r="${r}">${cells.map((c, i) => `<c r="${columnName(i)}${r}" t="inlineStr"${r === 1 ? ' s="1"' : ""}><is><t xml:space="preserve">${xmlEscape(String(c ?? ""))}</t></is></c>`).join("")}</row>`;
  const name = xmlEscape(sheetName.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet1");
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file("xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="0" fontId="1" applyFont="1"/></cellXfs></styleSheet>`);
  zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${[t.headers, ...t.rows].map((r, i) => row(r, i + 1)).join("")}</sheetData></worksheet>`);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
