import { NextRequest, NextResponse } from "next/server";
import { requireCtx, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { staffAttendance } from "@/lib/attendance-server";
import { localParts } from "@/lib/attendance";
import { toCsv } from "@/lib/school";

export const dynamic = "force-dynamic";
const VIEW = ["school_admin", "principal", "platform_admin", "hr_manager", "qa_officer"];

/** Staff clock-in for a day: who came, when, hours, late, on leave, absent. ?format=csv to export. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(VIEW, "attendance");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url).searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(u.get("date") ?? "") ? u.get("date")! : localParts(new Date(), ctx.tenant.timezone).date;
  const r = await staffAttendance(createServiceClient(), ctx.tenant.id, ctx.tenant.timezone, date);
  if (u.get("format") === "csv") {
    const t = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString("en-GB", { timeZone: ctx.tenant.timezone, hour: "2-digit", minute: "2-digit" }) : "";
    const csv = toCsv([["Staff no", "Name", "Department", "Status", "First in", "Last out", "Hours", "Note"],
      ...r.rows.map((x: any) => [x.staff_no, x.name, x.department, x.status, t(x.first_in), t(x.last_out), (x.minutes / 60).toFixed(1), x.note])]);
    return new NextResponse("﻿" + csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="staff-attendance-${date}.csv"` } });
  }
  if (!r.rows.length) return jsonError("add staff under HR first", 404);
  return NextResponse.json(r);
}
