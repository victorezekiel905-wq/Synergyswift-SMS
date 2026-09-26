import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { startOfTodayIso, toCsv } from "@/lib/school";

/** Visitors on site now and today's log (?date=YYYY-MM-DD, &format=csv). */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.gate, "visitors");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url);
  const day = u.searchParams.get("date");
  const from = day ? startOfTodayIso(ctx.tenant.timezone, new Date(`${day}T12:00:00Z`)) : startOfTodayIso(ctx.tenant.timezone);
  const to = new Date(new Date(from).getTime() + 86400_000).toISOString();
  const [{ data: onSite }, { data: log }] = await Promise.all([
    ctx.sb.from("visitors").select("*").eq("tenant_id", ctx.tenant.id).is("signed_out_at", null).order("signed_in_at", { ascending: false }),
    ctx.sb.from("visitors").select("*").eq("tenant_id", ctx.tenant.id).gte("signed_in_at", from).lt("signed_in_at", to).order("signed_in_at", { ascending: false })
  ]);
  if (u.searchParams.get("format") === "csv") {
    const csv = toCsv([["Name", "Phone", "Organisation", "Purpose", "Host", "Badge", "In", "Out"],
      ...(log ?? []).map((v: any) => [v.full_name, v.phone, v.organisation, v.purpose, v.host_name, v.badge_no, v.signed_in_at, v.signed_out_at])]);
    return new NextResponse("﻿" + csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="visitors.csv"` } });
  }
  return NextResponse.json({ on_site: onSite ?? [], log: log ?? [] });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sign_in"), full_name: z.string().trim().min(2).max(120), phone: z.string().trim().max(30).nullish(), organisation: z.string().trim().max(120).nullish(),
    purpose: z.string().trim().min(2).max(200), host_name: z.string().trim().max(120).nullish(), host_user_id: z.string().uuid().nullish(), badge_no: z.string().trim().max(20).nullish(),
    id_type: z.string().trim().max(40).nullish(), id_number: z.string().trim().max(40).nullish(), vehicle: z.string().trim().max(40).nullish() }),
  z.object({ action: z.literal("sign_out"), id: z.string().uuid() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.gate, "visitors");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  if (b.action === "sign_out") {
    const { error } = await ctx.sb.from("visitors").update({ signed_out_at: new Date().toISOString() }).eq("tenant_id", ctx.tenant.id).eq("id", b.id).is("signed_out_at", null);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  const { action: _a, ...row } = b;
  const { data, error } = await ctx.sb.from("visitors").insert({ ...row, tenant_id: ctx.tenant.id, recorded_by: ctx.userId }).select("id").single();
  return error ? jsonError(error.message) : NextResponse.json(data, { status: 201 });
}
