import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { entity, ENTITIES } from "@/lib/importers";
import { readTable, runImport, exportTable } from "@/lib/importers-server";
import { toCsv, writeXlsx } from "@/lib/spreadsheet";
import { fillAdmissionNumbers, type Existing } from "@/lib/admission-numbers";
import { fetchAll } from "@/lib/results";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The school's students, for giving admission numbers to a list without them. */
async function fetchAllRows(sb: any, tid: string): Promise<Existing[]> {
  const rows = await fetchAll<any>(() => sb.from("students").select("admission_no,first_name,last_name,class_groups(name)").eq("tenant_id", tid).order("admission_no"));
  return rows.map(s => ({ admission_no: s.admission_no ?? "", first_name: s.first_name ?? "", last_name: s.last_name ?? "", class_name: s.class_groups?.name ?? null }));
}

const MAX_ROWS = 5000;
const allowed = (ctx: any, key: string) => {
  const e = entity(key);
  if (!e) return false;
  if (e.finance) return hasAny(ctx, ROLES.finance);
  if (key === "staff") return hasAny(ctx, ROLES.admin) || hasAny(ctx, ROLES.hr);
  return hasAny(ctx, ROLES.sims);
};

/** ?entity=students&format=csv|xlsx downloads; no entity lists what can be imported. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url).searchParams;
  const key = u.get("entity");
  if (!key) return NextResponse.json({ entities: ENTITIES.filter(e => allowed(ctx, e.key)) });
  if (!allowed(ctx, key)) return jsonError("you cannot export this", 403);
  try {
    const t = await exportTable(ctx.sb, ctx.tenant.id, key);
    await ctx.sb.from("audit_logs").insert({ tenant_id: ctx.tenant.id, actor_id: ctx.userId, action: "data.exported", meta: { entity: key, rows: t.rows.length } });
    const name = `${key}-${new Date().toISOString().slice(0, 10)}`;
    if (u.get("format") === "xlsx") {
      const bytes = await writeXlsx(t, entity(key)!.label);
      return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}.xlsx"`, "Cache-Control": "no-store" } });
    }
    return new NextResponse(toCsv(t), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"`, "Cache-Control": "no-store" } });
  } catch (e) { return jsonError((e as Error).message); }
}

const Body = z.object({
  entity: z.string(), headers: z.array(z.string().max(200)).min(1).max(200),
  rows: z.array(z.array(z.string().max(2000)).max(200)).min(1).max(MAX_ROWS),
  map: z.record(z.number().int().min(-1).max(199)),
  dry_run: z.boolean().default(true), create_logins: z.boolean().default(false)
});

/** Checks (dry_run) or imports rows the browser has read from a CSV or Excel file. */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 400));
  const b = parsed.data;
  if (!allowed(ctx, b.entity)) return jsonError("you cannot import this", 403);
  const e = entity(b.entity)!;
  // Student lists without admission numbers: each student gets one (an existing student keeps theirs).
  let numbered: { reused: number; made: number } | null = null;
  if (b.entity === "students") {
    const col = (k: string) => b.map[k] ?? -1;
    if (col("first_name") >= 0 && col("last_name") >= 0) {
      const cell = (r: string[], k: string) => (col(k) >= 0 ? (r[col(k)] ?? "").trim() : "");
      if (b.rows.some(r => !cell(r, "admission_no"))) {
        const existing = await fetchAllRows(ctx.sb, ctx.tenant.id);
        const filled = fillAdmissionNumbers(b.rows.map(r => ({ admission_no: cell(r, "admission_no"), first_name: cell(r, "first_name"), last_name: cell(r, "last_name"), class_name: cell(r, "class") })), existing, new Date().getFullYear());
        let at = col("admission_no");
        if (at < 0) { at = b.headers.length; b.headers.push("Admission number (given by Synergy Swift)"); b.map.admission_no = at; }
        b.rows = b.rows.map((r, i) => { const x = [...r]; while (x.length <= at) x.push(""); x[at] = filled.numbers[i]; return x; });
        numbered = { reused: filled.reused, made: filled.made };
      }
    }
  }
  const missing = e.fields.filter(f => f.required && (b.map[f.key] ?? -1) < 0).map(f => f.label);
  if (missing.length) return jsonError(`choose the column for: ${missing.join(", ")}`);
  if (b.create_logins && !hasAny(ctx, ROLES.admin)) return jsonError("only school admins can create sign-in accounts", 403);
  try {
    const rows = readTable(b.entity, { headers: b.headers, rows: b.rows }, b.map);
    const result = await runImport(ctx.sb, ctx.tenant.id, b.entity, rows, { dryRun: b.dry_run, createLogins: b.create_logins, baseUrl: appUrl(req), userId: ctx.userId, svc: createServiceClient() });
    if (!b.dry_run) await ctx.sb.from("audit_logs").insert({ tenant_id: ctx.tenant.id, actor_id: ctx.userId, action: "data.imported",
      meta: { entity: b.entity, rows: result.rows, created: result.created, updated: result.updated, skipped: result.skipped, invited: result.invited } });
    return NextResponse.json({ ...result, numbered, errors: result.errors.slice(0, 500), more_errors: Math.max(0, result.errors.length - 500) });
  } catch (err) { return jsonError((err as Error).message); }
}
