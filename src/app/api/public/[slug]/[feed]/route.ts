import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { tenantByPublicSlug, publicNews, publicEvents } from "@/lib/open-api-server";
import { rss } from "@/lib/open-api";
import { appUrl } from "@/lib/school";

export const dynamic = "force-dynamic";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Cache-Control": "public, max-age=300" };

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * The school website's feeds, readable from any site:
 *   /api/public/<school>/news      latest news (JSON; ?post=<slug> for one post with its text)
 *   /api/public/<school>/rss       the same as RSS
 *   /api/public/<school>/events    events the school chose to show
 *   /api/public/<school>/school    name, logo and contact details, and the form links
 */
export async function GET(req: NextRequest, props: { params: Promise<{ slug: string; feed: string }> }) {
  const { slug, feed } = await props.params;
  const svc = createServiceClient();
  const t = await tenantByPublicSlug(svc, slug);
  if (!t) return NextResponse.json({ error: "school not found" }, { status: 404, headers: CORS });
  const base = appUrl(req);
  const u = new URL(req.url).searchParams;
  const limit = Math.min(50, Math.max(1, Number(u.get("limit") ?? 10) || 10));
  if (feed === "school") {
    return NextResponse.json({ school: t.school, links: { apply: `${base}/apply/${slug}`, enquire: `${base}/enquire/${slug}`, rss: `${base}/api/public/${slug}/rss` } }, { headers: CORS });
  }
  if (feed === "news") {
    const post = u.get("post");
    if (post) {
      const { data } = await svc.from("news_posts").select("id,title,slug,summary,body,image_url,published_at").eq("tenant_id", t.tenant.id).eq("status", "published").eq("slug", post).maybeSingle();
      return data ? NextResponse.json({ school: t.school.name, post: data }, { headers: CORS }) : NextResponse.json({ error: "not found" }, { status: 404, headers: CORS });
    }
    const { data } = await publicNews(svc, t.tenant.id, limit);
    return NextResponse.json({ school: t.school.name, news: data }, { headers: CORS });
  }
  if (feed === "rss") {
    const { data } = await publicNews(svc, t.tenant.id, 20);
    const body = rss({ title: `${t.school.name}: news`, link: base, description: `News from ${t.school.name}` },
      (data as any[]).map(n => ({ title: n.title, link: `${base}/api/public/${slug}/news?post=${n.slug}`, summary: n.summary, published_at: n.published_at, guid: n.id })));
    return new NextResponse(body, { headers: { ...CORS, "Content-Type": "application/rss+xml; charset=utf-8" } });
  }
  if (feed === "events") {
    const { data } = await publicEvents(svc, t.tenant.id, limit);
    return NextResponse.json({ school: t.school.name, events: data }, { headers: CORS });
  }
  return NextResponse.json({ error: "unknown feed" }, { status: 404, headers: CORS });
}
