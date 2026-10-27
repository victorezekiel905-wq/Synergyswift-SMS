import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";

export const dynamic = "force-dynamic";

const KIOSK = [...ROLES.admin, "teacher"] as const;

/**
 * A teacher's voting tablet (phase 14f): the class list with who has voted (never how),
 * the ballot paper, and casting a student's vote on the teacher's device.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(KIOSK, "elections");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url);
  const id = u.searchParams.get("election");
  const cls = u.searchParams.get("class");
  if (!id) return jsonError("choose an election");
  const { data: e } = await ctx.sb.from("elections").select("id,title,description,status,opens_at,closes_at,allow_kiosk,audience,class_group_ids").eq("tenant_id", ctx.tenant.id).eq("id", id).maybeSingle();
  if (!e) return jsonError("election not found", 404);
  if (!e.allow_kiosk || !["students", "everyone"].includes(e.audience)) return jsonError("This election does not use voting tablets.");
  // The classes this person may run a tablet for: those they teach (all classes for officers), within the election's classes.
  const officer = ROLES.admin.some(r => ctx.roles.has(r));
  const { data: all } = await ctx.sb.from("class_groups").select("id,name").eq("tenant_id", ctx.tenant.id).order("name");
  const allowed: { id: string; name: string }[] = [];
  for (const g of all ?? []) {
    if (e.class_group_ids?.length && !e.class_group_ids.includes(g.id)) continue;
    if (officer) { allowed.push(g); continue; }
    const { data: ok } = await ctx.sb.rpc("teaches_class", { p_class: g.id });
    if (ok) allowed.push(g);
  }
  const out: Record<string, unknown> = { election: e, classes: allowed };
  if (cls && allowed.some(g => g.id === cls)) {
    const [{ data: students }, { data: voted }, { data: posts }, { data: candidates }] = await Promise.all([
      ctx.sb.from("students").select("id,first_name,last_name,admission_no").eq("tenant_id", ctx.tenant.id).eq("class_group_id", cls).eq("status", "active").order("first_name"),
      ctx.sb.rpc("election_class_voted", { p_election: id, p_class: cls }),
      ctx.sb.from("election_posts").select("id,title,description,seats,position").eq("election_id", id).order("position"),
      ctx.sb.from("election_candidates").select("id,post_id,name,photo_url,manifesto,position").eq("election_id", id).order("position")
    ]);
    const done = new Set<string>((voted as string[] | null) ?? []);
    out.students = (students ?? []).map((s: any) => ({ id: s.id, name: `${s.first_name} ${s.last_name}`, admission_no: s.admission_no, voted: done.has(s.id) }));
    out.posts = posts ?? [];
    out.candidates = candidates ?? [];
  }
  return NextResponse.json(out);
}

const Body = z.object({ election_id: z.string().uuid(), student_id: z.string().uuid(), choices: z.record(z.string().uuid(), z.array(z.string().uuid()).max(50)) });

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(KIOSK, "elections");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("invalid request");
  const b = parsed.data;
  const { data, error } = await ctx.sb.rpc("cast_ballot_kiosk", { p_election: b.election_id, p_student: b.student_id, p_choices: b.choices });
  if (error) return jsonError(error.message, error.code === "42501" ? 403 : 400);
  return NextResponse.json({ ok: true, receipt: data });
}
