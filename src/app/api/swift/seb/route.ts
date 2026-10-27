import { NextRequest, NextResponse } from "next/server";
import { createClient as createLiveClient } from "@/live/lib/supabase/server";
import { createServiceClient as createLiveService } from "@/live/lib/supabase/service";
import { createServiceClient } from "@/lib/supabase/service";
import { verifySeb, absoluteRequestUrl, buildSebConfig } from "@/lib/exams/seb";
import { appUrl } from "@/lib/school";

/** The locked lesson behind a join code, with the school's Safe Exam Browser keys. */
async function lessonFor(code: string) {
  const live = createLiveService();
  const { data: s } = await live.from("class_sessions").select("id,tenant_id,title,status,require_seb").eq("join_code", code.trim().toUpperCase()).neq("status", "ended").maybeSingle();
  if (!s) return null;
  const { data: t } = await createServiceClient().from("tenant_settings").select("live_seb_config_keys").eq("tenant_id", s.tenant_id).maybeSingle();
  return { ...s, keys: (t?.live_seb_config_keys ?? []) as string[] };
}

/**
 * GET ?code=ABC123: the Safe Exam Browser file for a locked lesson (opens the
 * sign-in page, then the lesson). POST { code }: called from inside Safe Exam
 * Browser; checks the browser and gives the signed-in student a pass to join.
 */
export async function GET(req: NextRequest) {
  const code = new URL(req.url).searchParams.get("code") ?? "";
  if (!/^[A-Za-z0-9]{6}$/.test(code)) return NextResponse.json({ error: "code required" }, { status: 400 });
  const s = await lessonFor(code);
  if (!s) return NextResponse.json({ error: "No live lesson with that code." }, { status: 404 });
  const base = appUrl(req);
  const xml = buildSebConfig({
    startUrl: `${base}/login?next=${encodeURIComponent(`/live/student/join?code=${code.toUpperCase()}`)}`,
    quitUrl: `${base}/live/student`, title: s.title, require_seb: true, seb_config_keys: s.keys
  });
  return new NextResponse(xml, { headers: { "Content-Type": "application/seb", "Content-Disposition": `attachment; filename="lesson-${code.toUpperCase()}.seb"` } });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { code?: string };
  const code = String(body.code ?? "");
  const sb = await createLiveClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const s = await lessonFor(code);
  if (!s) return NextResponse.json({ error: "No live lesson with that code." }, { status: 404 });
  if (!s.require_seb) return NextResponse.json({ ok: true, needed: false });
  const check = verifySeb(absoluteRequestUrl(req), req.headers, { require_seb: true, seb_config_keys: s.keys });
  if (!check.ok) return NextResponse.json({ ok: false, needed: true, error: check.reason ?? "This lesson must be opened in Safe Exam Browser.", download: `/api/swift/seb?code=${code.toUpperCase()}` }, { status: 403 });
  await createLiveService().from("seb_passes").upsert({ session_id: s.id, user_id: user.id, level: check.level === "hash" ? "hash" : "user_agent", expires_at: new Date(Date.now() + 12 * 3_600_000).toISOString() });
  return NextResponse.json({ ok: true, needed: true });
}
