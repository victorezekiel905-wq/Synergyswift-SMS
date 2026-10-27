import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { studentPortfolio, staffPortfolio } from "@/lib/portfolio-server";
import { shareName, shareState } from "@/lib/portfolio";

export const dynamic = "force-dynamic";

/** A shared portfolio (phase 14o). Anyone with the link sees it until it expires or is stopped; nothing else is reachable from it. */
export async function GET(_req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  if (!/^[0-9a-f]{40}$/.test(token)) return jsonError("not found", 404);
  const svc = createServiceClient();
  const { data: s } = await svc.from("portfolio_shares").select("*,tenants(name,status)").eq("token", token).maybeSingle();
  if (!s || s.tenants?.status !== "active" || shareState(s) !== "live") return jsonError("not found", 404);
  await svc.from("portfolio_shares").update({ views: (s.views ?? 0) + 1 }).eq("id", s.id);
  const { data: settings } = await svc.from("tenant_settings").select("school_name,logo_url,brand_color").eq("tenant_id", s.tenant_id).maybeSingle();
  const school = { name: settings?.school_name ?? s.tenants.name, logo_url: settings?.logo_url ?? null, brand_color: settings?.brand_color ?? null };
  if (s.student_id) {
    const { data: st } = await svc.from("students").select("first_name,last_name,class_groups(name)").eq("id", s.student_id).maybeSingle();
    if (!st) return jsonError("not found", 404);
    const p = await studentPortfolio(svc, s.tenant_id, s.student_id, { shared: true, achievementId: s.achievement_id });
    return NextResponse.json({ kind: "student", school, name: shareName(st.first_name, st.last_name), class_name: (st as any).class_groups?.name ?? null, single: Boolean(s.achievement_id), expires_at: s.expires_at, ...p });
  }
  const { data: sf } = await svc.from("staff").select("full_name,position,department").eq("id", s.staff_id).maybeSingle();
  if (!sf) return jsonError("not found", 404);
  return NextResponse.json({ kind: "staff", school, name: sf.full_name, position: sf.position ?? sf.department ?? null, single: Boolean(s.achievement_id), expires_at: s.expires_at,
    achievements: await staffPortfolio(svc, s.tenant_id, s.staff_id, s.achievement_id), work: [], certificates: [] });
}
