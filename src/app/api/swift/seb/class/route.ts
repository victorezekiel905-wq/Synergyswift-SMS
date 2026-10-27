import { NextRequest, NextResponse } from "next/server";
import { createClient as createLiveClient } from "@/live/lib/supabase/server";

/**
 * GET ?class_id=: is this class locked to Safe Exam Browser for live lessons?
 * POST { class_id, on }: lock or unlock it (its teachers and school admins; checked in the database).
 * class_id is the Synergy Swift class (the live class has the same id).
 */
export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("class_id") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "class_id required" }, { status: 400 });
  const sb = await createLiveClient();
  const { data } = await sb.from("classes").select("id,require_seb").eq("id", id).maybeSingle();
  return NextResponse.json({ available: Boolean(data), require_seb: Boolean(data?.require_seb) });
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({})) as { class_id?: string; on?: boolean };
  if (!b.class_id || !/^[0-9a-f-]{36}$/.test(b.class_id)) return NextResponse.json({ error: "class_id required" }, { status: 400 });
  const sb = await createLiveClient();
  const { data, error } = await sb.rpc("set_class_seb", { p_class: b.class_id, p_on: Boolean(b.on) });
  if (error) return NextResponse.json({ error: /not allowed/.test(error.message) ? "Only this class's teachers or a school admin can change this." : error.message }, { status: 403 });
  return NextResponse.json(data);
}
