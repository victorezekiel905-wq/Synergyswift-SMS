/**
 * Tuck shop (migration 9700): what students, parents and sellers are told. Pure, safe in the
 * browser, unit tested. The rules themselves run in the database (shop_make_code, shop_sell).
 */

export type ShopStatus = {
  max: number; used: number; left: number; gap_minutes: number; last_at: string | null; next_at: string | null;
  cap: number | null; spent_today: number; cap_left: number | null; balance: number; frozen: boolean; has_wallet: boolean;
  window_open: boolean; windows: string; day_ends: string; code: string | null; code_expires: string | null;
  selling_open?: boolean; selling_windows?: string;
};

/** A buy code as people type it: capitals, letters and numbers only (the dash and spaces dropped). */
export function cleanBuyCode(input: string): string {
  return String(input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}
/** 7K3-PX9: the dash goes in by itself as the seller types. */
export function formatBuyCode(input: string | null | undefined): string {
  const c = cleanBuyCode(input ?? "");
  return c.length > 3 ? `${c.slice(0, 3)}-${c.slice(3)}` : c;
}
/** Whether now (in the school's time zone) is inside times written "10:00-10:30, 12:30-13:15". Empty: always. */
export function inWindows(windows: string | null | undefined, timeZone?: string, now = new Date()): boolean {
  const w = String(windows ?? "").trim();
  if (!w) return true;
  const hm = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, ...(timeZone ? { timeZone } : {}) }).format(now);
  const mins = (t: string) => { const [h, m] = t.trim().split(":").map(Number); return h * 60 + m; };
  const cur = mins(hm);
  return w.split(",").some(part => {
    const m = /^\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*$/.exec(part);
    return m ? cur >= mins(m[1]) && cur <= mins(m[2]) : false;
  });
}

/** Six characters from the 32 without look-alikes (no 0, O, 1, I). */
export function isBuyCodeShape(input: string): boolean {
  return /^[A-HJ-NP-Z2-9]{6}$/.test(cleanBuyCode(input));
}
export type ShopRefusal = { error: string; [k: string]: unknown };

const fmtMoney = (n: unknown, currency: string) => {
  const v = Number(n ?? 0);
  try { return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 2 }).format(v); } catch { return `${currency} ${v.toFixed(2)}`; }
};
const fmtTime = (iso: unknown, timeZone?: string) => {
  try { return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, ...(timeZone ? { timeZone } : {}) }).format(new Date(String(iso))); } catch { return ""; }
};
const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);

/** Why a code could not be made, said to the student (or "your child" to a parent). */
export function codeRefusal(r: ShopRefusal & Partial<ShopStatus>, p: { currency: string; timeZone?: string; forParent?: boolean; name?: string }): string {
  const you = p.forParent ? (p.name ?? "Your child") : "You";
  const your = p.forParent ? `${p.name ?? "Your child"}'s` : "Your";
  switch (r.error) {
    case "bought_max": return `${you} ${p.forParent ? "has" : "have"} bought ${times(Number(r.max ?? 1))} today already. Wait till tomorrow.`;
    case "wait": return `${you} bought already. Wait till ${fmtTime(r.next_at, p.timeZone)} for the next buy.`;
    case "window": return `Buy codes can be made only at these times: ${String(r.windows ?? "").replace(/\s*,\s*/g, ", ")}.`;
    case "empty": return `${your} wallet is empty. The school adds money to it.`;
    case "frozen": return `${your} wallet is frozen. Ask the school.`;
    case "not_found": return "Student not found.";
    default: return "A code can't be made just now. Please try again.";
  }
}

/** Why the till refused a sale, said to the seller. */
export function sellRefusal(r: ShopRefusal, p: { currency: string; timeZone?: string; name?: string | null }): string {
  const who = p.name ?? "This student";
  switch (r.error) {
    case "bad_code": return "That code is not right, or it has been used. Ask the student to check it.";
    case "closed": return `The shop is closed now. Selling times: ${String(r.windows ?? "").replace(/\s*,\s*/g, ", ")}.`;
    case "scan_expired": return "That fingerprint is no longer valid. Ask the student to scan again.";
    case "code_required": return "Ask for the student's buy code or fingerprint.";
    case "empty": return `${who}'s wallet is empty.`;
    case "frozen": return `${who}'s wallet is frozen. Do not sell.`;
    case "bought_max": return `${who} has bought ${times(Number(r.max ?? 1))} today already. They can buy again tomorrow.`;
    case "wait": return `${who} bought already. Next buy from ${fmtTime(r.next_at, p.timeZone)}.`;
    case "over_limit": return `Over the daily limit of ${fmtMoney(r.cap, p.currency)}. ${fmtMoney(r.cap_left, p.currency)} left today: remove something.`;
    case "not_enough": return `Not enough money: the balance is ${fmtMoney(r.balance, p.currency)} and this comes to ${fmtMoney(r.amount, p.currency)}.`;
    case "out_of_stock": return `Only ${Number(r.left ?? 0)} ${String(r.item ?? "of that item")} left.`;
    case "not_for_sale": return "An item in the basket is not for sale any more.";
    case "empty_basket": return "Tick what the student is buying first.";
    case "not_found": return "Student not found.";
    default: return "The sale didn't go through. Please try again.";
  }
}

/** Shop items grouped by category in a steady order (Biscuits, Drinks…; no category last). */
export function byCategory<T extends { category: string | null; name: string }>(items: T[]): { category: string; items: T[] }[] {
  const m = new Map<string, T[]>();
  for (const it of items) { const k = (it.category ?? "").trim() || "Other"; m.set(k, [...(m.get(k) ?? []), it]); }
  return [...m].sort((a, b) => (a[0] === "Other" ? 1 : b[0] === "Other" ? -1 : a[0].localeCompare(b[0])))
    .map(([category, list]) => ({ category, items: [...list].sort((a, b) => a.name.localeCompare(b.name)) }));
}

/** The receipt of a basket from the shop's prices (the till shows it; the database charges its own sum). */
export function receipt(basket: Record<string, number>, items: { id: string; name: string; price: number }[]) {
  const lines = Object.entries(basket).filter(([, q]) => q > 0).map(([id, qty]) => {
    const it = items.find(i => i.id === id);
    return it ? { id, name: it.name, qty, price: Number(it.price), amount: Math.round(qty * Number(it.price) * 100) / 100 } : null;
  }).filter(Boolean) as { id: string; name: string; qty: number; price: number; amount: number }[];
  return { lines, total: Math.round(lines.reduce((a, l) => a + l.amount * 100, 0)) / 100 };
}

/** A seller can keep up to four sales on hold while serving someone else. */
export const MAX_PAUSED = 4;
export type PausedSale = { id: string; label: string; basket: Record<string, number>; at: string };
export function pauseSale(paused: PausedSale[], sale: Omit<PausedSale, "id" | "at">, now = new Date()): { ok: true; paused: PausedSale[] } | { ok: false; error: string } {
  if (!Object.values(sale.basket).some(q => q > 0)) return { ok: false, error: "Nothing to put on hold: tick an item first." };
  if (paused.length >= MAX_PAUSED) return { ok: false, error: `${MAX_PAUSED} sales are on hold already. Finish or clear one first.` };
  return { ok: true, paused: [...paused, { ...sale, id: `${now.getTime()}-${paused.length}`, at: now.toISOString() }] };
}

/** Spending for parents: by category and by day, from purchase lines. */
export function spendingAnalysis(purchases: { created_at: string; amount: number; items: { category?: string | null; qty?: number; price?: number }[] | null }[]) {
  const byCat = new Map<string, number>(), byDay = new Map<string, number>();
  let total = 0, buys = 0;
  for (const p of purchases) {
    const spent = Math.abs(Number(p.amount));
    total += spent; buys++;
    const day = p.created_at.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + spent);
    const lines = p.items ?? [];
    if (!lines.length) byCat.set("Other", (byCat.get("Other") ?? 0) + spent);
    for (const l of lines) { const k = (l.category ?? "").trim() || "Other"; byCat.set(k, (byCat.get(k) ?? 0) + Number(l.qty ?? 1) * Number(l.price ?? 0)); }
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    total: r2(total), buys, average: buys ? r2(total / buys) : 0,
    categories: [...byCat].map(([category, amount]) => ({ category, amount: r2(amount) })).sort((a, b) => b.amount - a.amount),
    days: [...byDay].map(([day, amount]) => ({ day, amount: r2(amount) })).sort((a, b) => a.day.localeCompare(b.day))
  };
}
