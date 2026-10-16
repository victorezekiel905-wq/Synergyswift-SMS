/** Library helpers: ISBNs from scanned barcodes, Open Library look-ups, loan states and who may open digital items. Pure. */

/** Digits (and X) only. */
export const cleanIsbn = (s: string) => String(s ?? "").toUpperCase().replace(/[^0-9X]/g, "");

export function isValidIsbn10(s: string) {
  const d = cleanIsbn(s);
  if (!/^\d{9}[\dX]$/.test(d)) return false;
  const sum = d.split("").reduce((t, c, i) => t + (c === "X" ? 10 : Number(c)) * (10 - i), 0);
  return sum % 11 === 0;
}

export function isValidIsbn13(s: string) {
  const d = cleanIsbn(s);
  if (!/^\d{13}$/.test(d) || !/^97[89]/.test(d)) return false;
  const sum = d.split("").reduce((t, c, i) => t + Number(c) * (i % 2 ? 3 : 1), 0);
  return sum % 10 === 0;
}

/** Any valid ISBN as ISBN-13 (scanners read EAN-13; older books print ISBN-10). Null if it is not an ISBN. */
export function toIsbn13(s: string): string | null {
  const d = cleanIsbn(s);
  if (isValidIsbn13(d)) return d;
  if (!isValidIsbn10(d)) return null;
  const core = `978${d.slice(0, 9)}`;
  const sum = core.split("").reduce((t, c, i) => t + Number(c) * (i % 2 ? 3 : 1), 0);
  return `${core}${(10 - (sum % 10)) % 10}`;
}

/** What a scanned code is: an ISBN, a borrower card (EDU:…), or a library label. */
export function classifyScan(raw: string): { kind: "isbn"; isbn: string } | { kind: "card"; code: string } | { kind: "label"; code: string } {
  const s = String(raw ?? "").trim();
  if (/^EDU:/i.test(s)) return { kind: "card", code: s.replace(/^EDU:/i, "") };
  const isbn = toIsbn13(s);
  return isbn ? { kind: "isbn", isbn } : { kind: "label", code: s };
}

/** Book details from Open Library's /api/books?jscmd=data response for one ISBN. */
export function parseOpenLibrary(json: unknown, isbn: string) {
  const rec = (json as Record<string, any> | null)?.[`ISBN:${isbn}`];
  if (!rec?.title) return null;
  const year = Number(String(rec.publish_date ?? "").match(/\d{4}/)?.[0]);
  return {
    isbn, title: [rec.title, rec.subtitle].filter(Boolean).join(": ").slice(0, 200),
    author: (rec.authors ?? []).map((a: { name: string }) => a.name).filter(Boolean).join(", ").slice(0, 160) || null,
    publisher: (rec.publishers ?? []).map((p: { name: string }) => p.name)[0] ?? null,
    year: year >= 1400 && year <= 2200 ? year : null,
    cover_url: rec.cover?.medium ?? rec.cover?.large ?? null,
    category: (rec.subjects ?? []).map((s: { name: string }) => s.name)[0]?.slice(0, 80) ?? null
  };
}

export function loanState(l: { due_at: string; returned_at: string | null; lost_at?: string | null }, now = new Date()) {
  if (l.lost_at) return { state: "lost" as const, days: 0 };
  if (l.returned_at) return { state: "returned" as const, days: 0 };
  const days = Math.ceil((now.getTime() - Date.parse(l.due_at)) / 86_400_000);
  return days > 0 ? { state: "overdue" as const, days } : { state: days >= -2 ? "due_soon" as const : "on_loan" as const, days: -days };
}

/** Same rule as the database: whole late days times the daily fine. */
export const fineFor = (dueAt: string, returnedAt: Date, perDay: number) => Math.max(0, Math.ceil((returnedAt.getTime() - Date.parse(dueAt)) / 86_400_000)) * Math.max(0, perDay);

/** Who may open a digital item. */
export function canOpen(access: string, roles: Set<string>) {
  const staff = [...roles].some(r => !["student", "parent", "alumni"].includes(r));
  if (access === "staff") return staff;
  if (access === "students") return staff || roles.has("student");
  return true;
}

/** Overdue reminders go out at most every few days. */
export const reminderDue = (l: { due_at: string; returned_at: string | null; last_reminded_at: string | null }, now = new Date(), everyDays = 3) =>
  !l.returned_at && Date.parse(l.due_at) < now.getTime() && (!l.last_reminded_at || now.getTime() - Date.parse(l.last_reminded_at) >= everyDays * 86_400_000);
