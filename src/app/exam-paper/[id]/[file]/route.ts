import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { loadQuestions } from "@/lib/exams/server";
import { buildPaper } from "@/lib/exams/paper-server";
import { cached } from "@/lib/exams/cache";

export const dynamic = "force-dynamic";

/**
 * The encrypted exam paper (see lib/exams/paper.ts), at /exam-paper/<exam>/<version>.bin.
 * No sign-in: the file is useless without the key a student receives when they start. The version
 * is in the address and the file never changes, so Cloudflare (".bin" is cached by default) and
 * the browser keep it: a whole hall downloads it from the nearest Cloudflare site, not from here.
 * Kept out of the middleware so no cookie is ever attached (a cookie would stop Cloudflare caching).
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string; file: string }> }) {
  const { id, file } = await props.params;
  const m = /^([a-f0-9]{16})\.bin$/.exec(file);
  const gone = (status: number) => new NextResponse(null, { status, headers: { "Cache-Control": "no-store" } });
  if (!m || !/^[0-9a-f-]{36}$/i.test(id)) return gone(404);
  const svc = createServiceClient();
  const exam = await cached(`paper-exam:${id}`, 15_000, async () =>
    (await svc.from("exams").select("id,status").eq("id", id).in("status", ["published", "closed"]).maybeSingle()).data);
  if (!exam) return gone(404);
  const questions = await cached(`exam-q:${id}`, 15_000, () => loadQuestions(svc, id));
  const paper = buildPaper(id, questions);
  // An older version (a question was changed): the device is told, and gets the paper from the exam API instead.
  if (paper.version !== m[1]) return gone(410);
  return new NextResponse(new Uint8Array(paper.file), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
