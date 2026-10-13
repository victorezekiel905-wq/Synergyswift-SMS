import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readJson, jsonError } from "@/lib/auth";
import { deviceLabel } from "@/lib/security";

/** The caller's signed-in devices, and signing one or all others out. */
export async function GET() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return jsonError("unauthenticated", 401);
  const { data, error } = await sb.rpc("my_sessions");
  if (error) return jsonError(error.message);
  return NextResponse.json({ sessions: (data ?? []).map((s: any) => ({ ...s, device: deviceLabel(s.user_agent) })) });
}

export async function POST(req: NextRequest) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return jsonError("unauthenticated", 401);
  const b = await readJson<{ id?: string; others?: boolean }>(req);
  if (!b.others && !(typeof b.id === "string" && /^[0-9a-f-]{36}$/i.test(b.id))) return jsonError("choose a session");
  const { data, error } = await sb.rpc("end_my_sessions", { p_session: b.others ? null : b.id, p_others: Boolean(b.others) });
  return error ? jsonError(error.message) : NextResponse.json({ ok: true, ended: data });
}
