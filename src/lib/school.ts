/**
 * Shared lookups for the school-operations modules. Every function takes an
 * explicit tenantId and filters on it, so it is safe with either the
 * RLS-bound client or the service client.
 */
import type { Scheme } from "./grading";

export function studentName(s: { first_name?: string | null; last_name?: string | null; other_names?: string | null } | null | undefined) {
  if (!s) return "Student";
  return [s.first_name, s.other_names, s.last_name].filter(Boolean).join(" ");
}

export function appUrl(req?: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL;
  if (env && !env.includes("localhost")) return env.replace(/\/$/, "");
  if (req) {
    const h = req.headers;
    const proto = h.get("x-forwarded-proto")?.split(",")[0] ?? new URL(req.url).protocol.replace(":", "");
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) return `${proto}://${host}`;
  }
  return (env ?? "http://localhost:3000").replace(/\/$/, "");
}

export async function currentTerm(sb: any, tenantId: string) {
  const { data } = await sb.from("terms")
    .select("id,name,session_id,starts_on,ends_on,next_term_begins,academic_sessions(name)")
    .eq("tenant_id", tenantId).eq("is_current", true).maybeSingle();
  return data as null | { id: string; name: string; session_id: string; academic_sessions: { name: string } | null };
}

export async function termLabel(sb: any, tenantId: string, termId: string) {
  const { data } = await sb.from("terms").select("name,academic_sessions(name)").eq("tenant_id", tenantId).eq("id", termId).maybeSingle();
  if (!data) return "Term";
  return `${data.name} ${data.academic_sessions?.name ?? ""}`.trim();
}

/** Scheme for a class group: its own scheme, else the tenant default, else the first one. */
export async function schemeFor(sb: any, tenantId: string, classGroupId: string | null): Promise<(Scheme & { id: string; name: string; show_class_average: boolean }) | null> {
  let schemeId: string | null = null;
  if (classGroupId) {
    const { data: g } = await sb.from("class_groups").select("scheme_id").eq("tenant_id", tenantId).eq("id", classGroupId).maybeSingle();
    schemeId = g?.scheme_id ?? null;
  }
  let q = sb.from("grading_schemes")
    .select("id,name,pass_mark,decimals,show_position,show_class_average,is_default,grade_bands(grade,min_score,max_score,remark,grade_point),grading_components(id,name,max_score,weight,position)")
    .eq("tenant_id", tenantId);
  q = schemeId ? q.eq("id", schemeId) : q.order("is_default", { ascending: false }).order("created_at");
  const { data } = await q.limit(1);
  const s = data?.[0];
  if (!s) return null;
  return {
    id: s.id, name: s.name, pass_mark: Number(s.pass_mark), decimals: Number(s.decimals),
    show_position: s.show_position, show_class_average: s.show_class_average,
    bands: (s.grade_bands ?? []).map((b: any) => ({ ...b, min_score: Number(b.min_score), max_score: Number(b.max_score), grade_point: b.grade_point === null ? null : Number(b.grade_point) })),
    components: (s.grading_components ?? []).map((c: any) => ({ ...c, max_score: Number(c.max_score), weight: Number(c.weight) }))
      .sort((a: any, b: any) => a.position - b.position)
  };
}

/** Is `now` (in the tenant's timezone) later than HH:MM? */
export function isLate(now: Date, startTime: string | null | undefined, timeZone: string): boolean {
  if (!startTime) return false;
  const [h, m] = startTime.split(":").map(Number);
  let tz = timeZone;
  try { new Intl.DateTimeFormat("en-GB", { timeZone: tz }); } catch { tz = "UTC"; }
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const hh = Number(parts.find(p => p.type === "hour")?.value ?? 0) % 24;
  const mm = Number(parts.find(p => p.type === "minute")?.value ?? 0);
  return hh * 60 + mm > h * 60 + m;
}

/** Start of "today" in the tenant's timezone, as a UTC ISO string. */
export function startOfTodayIso(timeZone: string, now = new Date()): string {
  let tz = timeZone;
  try { new Intl.DateTimeFormat("en-GB", { timeZone: tz }); } catch { tz = "UTC"; }
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const p = Object.fromEntries(fmt.formatToParts(now).map(x => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  const offset = asUtc - now.getTime();                     // tz offset in ms
  const midnightLocalAsUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day));
  return new Date(midnightLocalAsUtc - offset).toISOString();
}

/** Haversine distance in metres (staff geofenced self check-in). */
export function distanceMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Minimal CSV parser (quotes, commas, CRLF) for imports. First row = headers. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some(x => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some(x => x.trim() !== "")) rows.push(row);
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, "_"));
  return rows.slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])));
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map(r => r.map(v => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\r\n");
}
