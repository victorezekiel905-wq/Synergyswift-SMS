import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { markByToken } from "@/lib/notices-server";

export const dynamic = "force-dynamic";

type P = { params: Promise<{ token: string }> };

/** Opening the link in a message: shows the notice and records that it was read. */
export async function GET(_req: NextRequest, { params }: P) {
  const { token } = await params;
  const r = await markByToken(createServiceClient(), token, false);
  if (!r) return NextResponse.json({ error: "This link is not valid." }, { status: 404 });
  const n: any = r.notice;
  return NextResponse.json({ title: n.title, body: n.body, kind: n.kind, requires_ack: n.requires_ack || n.kind === "emergency", sent_at: n.sent_at, school: n.tenants?.name ?? "", acknowledged_at: r.acknowledged_at });
}

/** "I have read this" / "I received this". */
export async function POST(_req: NextRequest, { params }: P) {
  const { token } = await params;
  const r = await markByToken(createServiceClient(), token, true);
  return r ? NextResponse.json({ ok: true, acknowledged_at: r.acknowledged_at }) : NextResponse.json({ error: "This link is not valid." }, { status: 404 });
}
