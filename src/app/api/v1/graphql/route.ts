import { NextRequest, NextResponse } from "next/server";
import { authenticate, listResource, RESOURCES } from "@/lib/open-api-server";
import { parseGraphQL, project } from "@/lib/open-api";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/graphql  { query, variables }
 * Each top-level field is a resource (students, classes, staff, attendance,
 * results, invoices, payments, applications, events, news) with the same
 * arguments as the REST filters plus limit and offset. Asks only for the
 * fields you name. At most 5 resources per query.
 */
export async function POST(req: NextRequest) {
  const c = await authenticate(req.headers);
  if (c instanceof NextResponse) return c;
  const body = await req.json().catch(() => null) as { query?: string; variables?: Record<string, unknown> } | null;
  if (!body?.query || typeof body.query !== "string" || body.query.length > 10_000) {
    return NextResponse.json({ errors: [{ message: "send { \"query\": \"{ students { id name } }\" }" }] }, { status: 400 });
  }
  let fields;
  try { fields = parseGraphQL(body.query, body.variables ?? {}); }
  catch (e) { return NextResponse.json({ errors: [{ message: (e as Error).message }] }, { status: 400 }); }
  if (fields.length > 5) return NextResponse.json({ errors: [{ message: "ask for at most 5 resources at once" }] }, { status: 400 });

  const data: Record<string, unknown> = {};
  const errors: { message: string; path: string[] }[] = [];
  for (const f of fields) {
    if (f.name === "__schema" || f.name === "__type") { data[f.alias] = { resources: Object.keys(RESOURCES) }; continue; }
    const limit = Math.min(200, Math.max(1, Number(f.args.limit ?? 50) || 50)), offset = Math.max(0, Number(f.args.offset ?? 0) || 0);
    try {
      const args = { ...Object.fromEntries(Object.entries(f.args).map(([k, v]) => [k, typeof v === "string" ? v : v === null ? undefined : String(v)])), limit, offset };
      const res = await listResource(c, f.name, args);
      data[f.alias] = project(res.data, f.fields);
    } catch (e) {
      data[f.alias] = null;
      errors.push({ message: (e as Error).message, path: [f.alias] });
    }
  }
  return NextResponse.json(errors.length ? { data, errors } : { data }, { headers: { "Cache-Control": "no-store" } });
}
