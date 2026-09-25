import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { toCsv } from "@/lib/school";

/** Report cards for a class and term. ?format=csv returns the broadsheet. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "results");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url);
  const termId = u.searchParams.get("term_id"), cg = u.searchParams.get("class_group_id");
  if (!termId || !cg) return jsonError("term_id and class_group_id are required");
  const { data, error } = await ctx.sb.from("report_cards")
    .select("id,student_id,total,average,position,class_size,status,teacher_comment,principal_comment,published_at,access_token,computed_at,data")
    .eq("tenant_id", ctx.tenant.id).eq("term_id", termId).eq("class_group_id", cg)
    .order("position", { ascending: true, nullsFirst: false });
  if (error) return jsonError(error.message);
  const cards = data ?? [];

  if (u.searchParams.get("format") === "csv") {
    const subjects: { subject_id: string; subject: string }[] = [];
    for (const c of cards) for (const s of c.data?.subjects ?? []) if (!subjects.some(x => x.subject_id === s.subject_id)) subjects.push(s);
    const header = ["Position", "Admission no", "Student", ...subjects.flatMap(s => [`${s.subject} total`, `${s.subject} grade`]), "Total", "Average", "Status"];
    const lines = cards.map((c: any) => {
      const by = new Map((c.data?.subjects ?? []).map((s: any) => [s.subject_id, s]));
      return [c.position, c.data?.admission_no, c.data?.student_name,
        ...subjects.flatMap(s => { const r: any = by.get(s.subject_id); return [r?.total ?? "", r?.grade ?? ""]; }),
        c.total, c.average, c.status];
    });
    return new NextResponse("﻿" + toCsv([header, ...lines]), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="broadsheet.csv"` }
    });
  }
  return NextResponse.json(cards);
}

const Patch = z.object({
  id: z.string().uuid(),
  teacher_comment: z.string().trim().max(600).nullish(),
  principal_comment: z.string().trim().max(600).nullish(),
  status: z.enum(["draft", "approved", "withheld"]).optional()
});

/** Comments (teachers) and approve / withhold (admins). Publishing goes through /api/results/publish. */
export async function PATCH(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "results");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Patch.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => i.message).join("; "));
  const { id, ...fields } = parsed.data;
  if ((fields.status || fields.principal_comment !== undefined) && !hasAny(ctx, ROLES.admin)) {
    return jsonError("only admins can approve, withhold or write the principal's comment", 403);
  }
  const { error } = await ctx.sb.from("report_cards").update(fields).eq("tenant_id", ctx.tenant.id).eq("id", id);
  return error ? jsonError(error.message) : NextResponse.json({ ok: true });
}
