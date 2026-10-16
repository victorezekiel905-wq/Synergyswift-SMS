/** Stock, assets and buying: who approves, what to reorder, what is due for service, which quote to take. Pure. */

/** The approvals a requisition needs: one, or an endorsement then a second approval above the limit. */
export function approvalPath(total: number, limit: number): ("endorse" | "approve")[] {
  return total > limit ? ["endorse", "approve"] : ["approve"];
}

/** What an approver can do next with a requisition. */
export function nextRequisitionSteps(r: { status: string; total_amount: number; requested_by: string; endorsed_by: string | null }, me: string, isHead: boolean, limit: number) {
  if (r.requested_by === me) return r.status === "submitted" || r.status === "endorsed" ? ["cancel"] : [];
  const big = Number(r.total_amount) > limit;
  if (r.status === "submitted") return big ? ["endorse", "reject"] : ["approve", "reject"];
  if (r.status === "endorsed") return r.endorsed_by !== me && isHead ? ["approve", "reject"] : r.endorsed_by === me ? [] : ["reject"];
  if (r.status === "approved") return ["order", "fulfil"];
  return [];
}

/** Items at or below their reorder level, with a suggested quantity (back up to twice the reorder level). */
export function reorderSuggestions(items: { id: string; name: string; variant?: string | null; quantity: number; reorder_level: number; unit_cost: number }[]) {
  return items.filter(i => Number(i.reorder_level) > 0 && Number(i.quantity) <= Number(i.reorder_level))
    .map(i => { const qty = Math.max(1, Math.ceil(Number(i.reorder_level) * 2 - Number(i.quantity))); return { ...i, suggest: qty, cost: Math.round(qty * Number(i.unit_cost) * 100) / 100 }; })
    .sort((a, b) => Number(a.quantity) / Math.max(1, Number(a.reorder_level)) - Number(b.quantity) / Math.max(1, Number(b.reorder_level)));
}

export const stockValue = (items: { quantity: number; unit_cost: number }[]) => Math.round(items.reduce((s, i) => s + Math.max(0, Number(i.quantity)) * Number(i.unit_cost), 0) * 100) / 100;

/** Assets due for service, and warranties running out, within a window. */
export function assetsDue(assets: { id: string; tag: string; name: string; status: string; next_maintenance_on: string | null; warranty_expires: string | null }[], today: string, within = 14) {
  const limit = new Date(Date.parse(`${today}T00:00:00Z`) + within * 86_400_000).toISOString().slice(0, 10);
  const live = assets.filter(a => a.status !== "retired" && a.status !== "lost");
  return {
    service: live.filter(a => a.next_maintenance_on && a.next_maintenance_on <= limit).map(a => ({ ...a, overdue: (a.next_maintenance_on as string) < today }))
      .sort((a, b) => String(a.next_maintenance_on).localeCompare(String(b.next_maintenance_on))),
    warranty: live.filter(a => a.warranty_expires && a.warranty_expires >= today && a.warranty_expires <= new Date(Date.parse(`${today}T00:00:00Z`) + 60 * 86_400_000).toISOString().slice(0, 10))
  };
}

/** The best quote: cheapest, then fastest. */
export function bestQuote<T extends { amount: number; delivery_days: number | null }>(quotes: T[]): T | null {
  return [...quotes].sort((a, b) => Number(a.amount) - Number(b.amount) || (a.delivery_days ?? 999) - (b.delivery_days ?? 999))[0] ?? null;
}

/** How far an order has arrived. */
export function orderProgress(lines: { quantity: number; received_qty: number; unit_cost: number }[]) {
  const ordered = lines.reduce((s, l) => s + Number(l.quantity), 0), received = lines.reduce((s, l) => s + Number(l.received_qty), 0);
  const value = Math.round(lines.reduce((s, l) => s + Number(l.received_qty) * Number(l.unit_cost), 0) * 100) / 100;
  return { ordered, received, value_received: value, complete: lines.length > 0 && lines.every(l => Number(l.received_qty) >= Number(l.quantity)) };
}

/** A basket total for the till, from shop items found by id or barcode. */
export function addToBasket(basket: { id: string; qty: number }[], id: string) {
  const i = basket.findIndex(b => b.id === id);
  return i >= 0 ? basket.map((b, j) => j === i ? { ...b, qty: b.qty + 1 } : b) : [...basket, { id, qty: 1 }];
}
