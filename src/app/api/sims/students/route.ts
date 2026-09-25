import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { StudentInput, GuardianInput, cleanStudent } from "@/lib/validators";

export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "sims");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url);
  const q = (u.searchParams.get("q") ?? "").trim();
  const cg = u.searchParams.get("class_group_id");
  const status = u.searchParams.get("status") ?? "active";
  let query = ctx.sb.from("students")
    .select("id,admission_no,first_name,last_name,other_names,gender,class_group_id,status,photo_url,user_id,card_code,class_groups(name),student_guardians(guardians(id,full_name,phone,email))")
    .eq("tenant_id", ctx.tenant.id).order("last_name").order("first_name").limit(Number(u.searchParams.get("limit") ?? 500));
  if (status !== "all") query = query.eq("status", status);
  if (cg) query = query.eq("class_group_id", cg);
  if (q) {
    const safe = q.replace(/[%,()]/g, " ");
    query = query.or(`first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,admission_no.ilike.%${safe}%`);
  }
  const { data, error } = await query;
  if (error) return jsonError(error.message);
  return NextResponse.json(data ?? []);
}

const Create = StudentInput.extend({ guardians: z.array(GuardianInput).max(4).default([]) });

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.sims, "sims");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Create.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const { guardians, ...student } = parsed.data;
  const tid = ctx.tenant.id;

  const { data: t } = await ctx.sb.from("tenants").select("student_limit").eq("id", tid).maybeSingle();
  if (t?.student_limit) {
    const { count } = await ctx.sb.from("students").select("id", { count: "exact", head: true }).eq("tenant_id", tid).eq("status", "active");
    if ((count ?? 0) >= t.student_limit) return jsonError(`your plan allows ${t.student_limit} active students`, 402);
  }

  const { data: s, error } = await ctx.sb.from("students").insert({ ...cleanStudent(student), tenant_id: tid }).select("id").single();
  if (error) return jsonError(error.message.includes("duplicate") ? "admission number already exists" : error.message);
  for (const g of guardians) {
    const { relation, is_primary, can_pickup, ...gRow } = g;
    const { data: gid, error: gErr } = await ctx.sb.from("guardians")
      .insert({ ...gRow, email: gRow.email || null, tenant_id: tid }).select("id").single();
    if (gErr) return jsonError(`student saved, guardian failed: ${gErr.message}`);
    await ctx.sb.from("student_guardians").insert({ tenant_id: tid, student_id: s.id, guardian_id: gid.id, relation, is_primary, can_pickup });
  }
  await ctx.sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "student.created", target: s.id });
  return NextResponse.json(s, { status: 201 });
}
