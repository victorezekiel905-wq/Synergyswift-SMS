/**
 * Tuck shop on the server (migration 9700). Service client only; callers authorise first.
 */
import { notifyGuardians, money } from "./notify";
import { communityNote } from "./messaging/notices";
import { financeSettings } from "./fees";
import { studentName } from "./school";
import { maybeLowBalanceAlert } from "./wallet";
import { codeRefusal, spendingAnalysis, formatBuyCode, type ShopStatus, type ShopRefusal } from "./tuck-shop";

type Svc = any;

export class ShopError extends Error { constructor(message: string, public status = 400) { super(message); } }
const needUpdate = (m: string) => /shop_|function .* does not exist|column .*shop/i.test(m);
const rpcError = (m: string) => new ShopError(needUpdate(m) ? "The tuck shop needs the database update (migration 20260101009700)." : m, needUpdate(m) ? 503 : 400);

export async function shopStatus(svc: Svc, tenantId: string, studentId: string): Promise<ShopStatus> {
  const { data, error } = await svc.rpc("shop_status", { p_tenant: tenantId, p_student: studentId });
  if (error) throw rpcError(error.message);
  return data as ShopStatus;
}

/** A student's (or parent's) buy code, within the school's rules. Refusals come back worded. */
export async function makeBuyCode(svc: Svc, p: { tenantId: string; studentId: string; by: string; as: "student" | "parent"; timeZone?: string; name?: string }) {
  const { data, error } = await svc.rpc("shop_make_code", { p_tenant: p.tenantId, p_student: p.studentId, p_by: p.by, p_as: p.as });
  if (error) throw rpcError(error.message);
  const { currency } = await financeSettings(svc, p.tenantId);
  if (data?.error) return { ok: false as const, error: codeRefusal(data as ShopRefusal, { currency, timeZone: p.timeZone, forParent: p.as === "parent", name: p.name }), status: data as ShopStatus };
  return { ok: true as const, code: data.code as string, expires: data.code_expires as string, reused: Boolean(data.reused), status: data as ShopStatus };
}

/**
 * A parent makes a code for their child and sends it to the child's class teacher as a message
 * (the teacher hands it over). Falls back to the school office when the class has no form teacher.
 */
export async function sendCodeToTeacher(svc: Svc, p: { tenantId: string; guardianId: string; guardianName: string; studentId: string; code: string; expires: string; timeZone?: string; baseUrl: string }) {
  const { data: st } = await svc.from("students").select("first_name,last_name,other_names,class_groups(form_teacher_id,name)").eq("id", p.studentId).maybeSingle();
  const teacher: string | null = st?.class_groups?.form_teacher_id ?? null;
  const until = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, ...(p.timeZone ? { timeZone: p.timeZone } : {}) }).format(new Date(p.expires));
  const { startFromGuardian } = await import("./conversations");
  const r = await startFromGuardian(svc, { tenantId: p.tenantId, guardianId: p.guardianId, guardianName: p.guardianName, studentId: p.studentId, staffUserId: teacher,
    subject: `Tuck shop code for ${st?.first_name ?? "my child"}`,
    body: `Please give ${studentName(st)} this tuck shop buy code: ${formatBuyCode(p.code)}. It works once, today only (until ${until}). Thank you.`, baseUrl: p.baseUrl });
  return { conversation: r.id, to: teacher ? "class teacher" : "school office" };
}

/** A sale at the till. On success the family is told (if the school wants), and an empty wallet is flagged. */
export async function sell(svc: Svc, p: { tenantId: string; operator: string; items: { id: string; qty: number }[]; amount?: number | null; method: "code" | "fingerprint" | "card";
  code?: string | null; scanId?: string | null; studentId?: string | null; baseUrl: string }) {
  const { data, error } = await svc.rpc("shop_sell", { p_tenant: p.tenantId, p_operator: p.operator, p_items: p.items, p_amount: p.amount ?? null, p_method: p.method,
    p_code: p.code ?? null, p_scan: p.scanId ?? null, p_student: p.studentId ?? null, p_reference: null });
  if (error) throw rpcError(error.message);
  if (data?.error) {
    if (data.error === "bad_code") void alertOnWrongCodes(svc, { tenantId: p.tenantId, operator: p.operator, baseUrl: p.baseUrl }).catch(() => undefined);
    return { ok: false as const, refusal: data as ShopRefusal };
  }
  const { data: s } = await svc.from("students").select("id,first_name,last_name,other_names,photo_url,admission_no,class_groups(name)").eq("id", data.student_id).maybeSingle();
  const name = studentName(s);
  // Messages after the sale: never hold up the queue.
  void afterSale(svc, { tenantId: p.tenantId, studentId: data.student_id, name, total: Number(data.total), balance: Number(data.balance), lines: data.lines ?? [],
    exhausted: Boolean(data.exhausted), low: Boolean(data.low), baseUrl: p.baseUrl }).catch(() => undefined);
  return { ok: true as const, sale: { ...data, student: { id: data.student_id, name, photo_url: s?.photo_url ?? null, admission_no: s?.admission_no ?? null, class_name: s?.class_groups?.name ?? null } } };
}

async function afterSale(svc: Svc, p: { tenantId: string; studentId: string; name: string; total: number; balance: number; lines: { name: string; qty: number }[]; exhausted: boolean; low: boolean; baseUrl: string }) {
  const [{ currency }, { data: set }] = await Promise.all([
    financeSettings(svc, p.tenantId),
    svc.from("tenant_settings").select("shop_notify_each_purchase").eq("tenant_id", p.tenantId).maybeSingle()
  ]);
  const what = p.lines.length ? p.lines.map(l => `${l.qty}× ${l.name}`).join(", ") : "an item";
  const link = (g: { portal_token?: string | null }) => g.portal_token ? `${p.baseUrl}/g/${g.portal_token}#wallet` : `${p.baseUrl}/parent#wallet`;
  if (set?.shop_notify_each_purchase !== false) {
    await notifyGuardians(svc, { tenantId: p.tenantId, studentIds: [p.studentId], kind: "shop_purchase", refId: p.studentId, budgetMs: 2000,
      build: (brand, g) => communityNote(brand, { name: g.full_name, subject: `${p.name} bought ${what}`,
        lines: [`${p.name} bought ${what} at the tuck shop for ${money(p.total, currency)}.`, `Balance now: ${money(p.balance, currency)}.`], link: link(g), linkLabel: "See spending" }) });
  }
  if (p.exhausted) {
    await notifyGuardians(svc, { tenantId: p.tenantId, studentIds: [p.studentId], kind: "wallet_empty", refId: p.studentId, budgetMs: 2000,
      build: (brand, g) => communityNote(brand, { name: g.full_name, subject: `${p.name}'s tuck shop wallet is empty`,
        lines: [`${p.name} has spent all the money in their tuck shop wallet.`, "The school adds money to wallets: contact the school office to top it up."], link: link(g), linkLabel: "See spending" }) });
  } else if (p.low) {
    await maybeLowBalanceAlert(svc, { tenantId: p.tenantId, studentId: p.studentId, balance: p.balance, baseUrl: p.baseUrl });
  }
}

/** The seller typed a code: the child it belongs to (name, photo, class; never the balance). */
export async function lookupCode(svc: Svc, p: { tenantId: string; operator: string; code: string; baseUrl: string }) {
  const { data, error } = await svc.rpc("shop_lookup_code", { p_tenant: p.tenantId, p_operator: p.operator, p_code: p.code });
  if (error) throw rpcError(error.message);
  if (data?.error) {
    if (data.error === "bad_code") void alertOnWrongCodes(svc, { tenantId: p.tenantId, operator: p.operator, baseUrl: p.baseUrl }).catch(() => undefined);
    return { ok: false as const, refusal: data as ShopRefusal };
  }
  return { ok: true as const, child: { id: data.student_id as string, name: data.name as string, photo_url: (data.photo_url as string | null) ?? null, class_name: (data.class_name as string | null) ?? null } };
}

/** Wrong codes never stop a seller; when one seller types many (15 in 10 minutes), the admins are told, at most once an hour. */
export const WRONG_CODE_ALERT = { count: 15, minutes: 10 };
export async function alertOnWrongCodes(svc: Svc, p: { tenantId: string; operator: string; baseUrl: string }) {
  const since = new Date(Date.now() - WRONG_CODE_ALERT.minutes * 60_000).toISOString();
  const { count } = await svc.from("shop_events").select("id", { count: "exact", head: true }).eq("tenant_id", p.tenantId).eq("operator", p.operator).eq("kind", "bad_code").gte("created_at", since);
  if ((count ?? 0) < WRONG_CODE_ALERT.count) return false;
  const { data: recent } = await svc.from("shop_events").select("id").eq("tenant_id", p.tenantId).eq("operator", p.operator).eq("kind", "seller_alert")
    .gte("created_at", new Date(Date.now() - 3600_000).toISOString()).limit(1);
  if (recent?.length) return false;
  const { data: who } = await svc.from("users").select("full_name").eq("id", p.operator).maybeSingle();
  await svc.from("shop_events").insert({ tenant_id: p.tenantId, kind: "seller_alert", detail: { wrong_codes: count, minutes: WRONG_CODE_ALERT.minutes }, operator: p.operator });
  const { data: admins } = await svc.from("users").select("id").eq("tenant_id", p.tenantId).eq("active", true).in("role", ["school_admin", "principal"]).limit(10);
  const { staffRows, enqueue, tryDispatch } = await import("./messaging/outbox");
  const rows = await staffRows(svc, { tenantId: p.tenantId, userIds: (admins ?? []).map((a: { id: string }) => a.id), kind: "shop_alert", refId: p.operator,
    subject: `Tuck shop: many wrong codes from ${who?.full_name ?? "a seller"}`,
    text: `${who?.full_name ?? "A seller"} typed ${count} wrong buy codes in the last ${WRONG_CODE_ALERT.minutes} minutes. Sales were not stopped. Please check with them.`,
    url: `${p.baseUrl}/school/shop` });
  if (rows.length) { await enqueue(svc, rows); await tryDispatch(svc, { budgetMs: 3000 }).catch(() => null); }
  return true;
}

/** The latest fingerprint read at a shop machine since the till asked, with the student. */
export async function latestScan(svc: Svc, p: { tenantId: string; deviceId: string; since: string }) {
  const { data } = await svc.from("shop_finger_scans").select("id,at,student_id,students(first_name,last_name,other_names,photo_url,class_groups(name))")
    .eq("tenant_id", p.tenantId).eq("device_id", p.deviceId).is("used_at", null).gte("at", p.since).order("at", { ascending: false }).limit(1);
  const s = data?.[0];
  return s ? { id: s.id, at: s.at, student: { id: s.student_id, name: studentName(s.students), photo_url: s.students?.photo_url ?? null, class_name: s.students?.class_groups?.name ?? null } } : null;
}

const EVENT_COLS = "id,kind,amount,detail,created_at,student_id,students(first_name,last_name,other_names),users:operator(full_name)";

/** What happened at the shop: for one student (their dashboard, their parents) or the whole school (admins). */
export async function shopEvents(svc: Svc, p: { tenantId: string; studentIds?: string[]; limit?: number }) {
  let q = svc.from("shop_events").select(EVENT_COLS).eq("tenant_id", p.tenantId).order("created_at", { ascending: false }).limit(p.limit ?? 50);
  if (p.studentIds) q = q.in("student_id", p.studentIds.length ? p.studentIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data, error } = await q;
  if (error) throw rpcError(error.message);
  return (data ?? []).map((e: any) => ({ id: e.id, kind: e.kind, amount: e.amount === null ? null : Number(e.amount), detail: e.detail ?? {}, at: e.created_at,
    student_id: e.student_id, student: e.students ? studentName(e.students) : null, by: e.users?.full_name ?? null }));
}

/** A student's shop page: status, wallet history and what happened, plus spending analysis for parents. */
export async function studentShop(svc: Svc, tenantId: string, studentId: string) {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [status, { data: tx }, events] = await Promise.all([
    shopStatus(svc, tenantId, studentId),
    svc.from("wallet_transactions").select("id,kind,amount,balance_after,description,items,method,status,created_at").eq("tenant_id", tenantId).eq("student_id", studentId)
      .neq("status", "failed").gte("created_at", since).order("created_at", { ascending: false }).limit(200),
    shopEvents(svc, { tenantId, studentIds: [studentId], limit: 30 })
  ]);
  const purchases = (tx ?? []).filter((t: any) => t.kind === "purchase" && t.status === "success");
  return { status, history: (tx ?? []).slice(0, 50), events, analysis: spendingAnalysis(purchases) };
}
