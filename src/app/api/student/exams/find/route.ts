import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { windowState, examClasses, classMaySit } from "@/lib/exams/server";

export const dynamic = "force-dynamic";

const Body = z.object({ code: z.string().trim().min(4).max(20) });

/**
 * synergyswift.com/exam: a signed-in student types the exam code the teacher gave and is taken to
 * that exam. Only exams in the student's own school, published, and for their class (or the whole
 * school). The code is checked again when the exam starts.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(["student"], "exams");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("Type the exam code your teacher gave you.");
  const code = parsed.data.code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const svc = createServiceClient();
  const { data: me } = await svc.from("students").select("id,class_group_id").eq("tenant_id", ctx.tenant.id).eq("user_id", ctx.userId).maybeSingle();
  if (!me) return jsonError("Your sign-in is not linked to your student record yet. Ask the school office to link it.", 404);
  const { data: exams } = await svc.from("exams").select("id,title,status,opens_at,closes_at,class_group_id,access_code")
    .eq("tenant_id", ctx.tenant.id).ilike("access_code", code).in("status", ["published", "closed", "draft"]).limit(10);
  const list = (exams ?? []) as { id: string; title: string; status: string; opens_at: string | null; closes_at: string | null; class_group_id: string | null; access_code: string }[];
  if (!list.length) return jsonError("No exam has that code. Check it with your teacher.", 404);
  const published = list.filter(e => e.status !== "draft");
  if (!published.length) return jsonError("That exam isn't ready yet: your teacher hasn't published it. Ask them to publish it.", 409);
  const mine: typeof published = [];
  for (const e of published) if (classMaySit(await examClasses(svc, e), me.class_group_id)) mine.push(e);
  if (!mine.length) return jsonError("That exam is for another class. Check the code with your teacher.", 403);
  // If one code matches several exams, the one open now first.
  const pick = mine.find(e => windowState(e as never) === "open") ?? mine[0];
  return NextResponse.json({ id: pick.id, title: pick.title, window: windowState(pick as never) });
}
