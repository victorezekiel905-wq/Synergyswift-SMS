import { NextRequest, NextResponse } from "next/server";
import { SCOPES, EVENTS } from "@/lib/open-api";
import { appUrl } from "@/lib/school";

export const dynamic = "force-dynamic";

const page = [
  { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } },
  { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 } }
];
const q = (name: string, description: string) => ({ name, in: "query", description, schema: { type: "string" } });
const list = (summary: string, scope: string, params: object[] = []) => ({
  get: { summary, description: `Needs the ${scope} scope.`, security: [{ apiKey: [] }], parameters: [...page, ...params],
    responses: { 200: { description: "{ data: [...], paging: { limit, offset, total } }" }, 401: { description: "missing or invalid key" }, 403: { description: "scope missing" }, 429: { description: "over 120 requests a minute" } } }
});

/** The API's description (OpenAPI 3.1), for developers and tools such as Postman. */
export async function GET(req: NextRequest) {
  const base = appUrl(req);
  return NextResponse.json({
    openapi: "3.1.0",
    info: {
      title: "Synergy Swift school API", version: "1.0.0",
      description: [
        "Read a school's data and send in admissions applications. A school admin creates keys under Integrations, choosing scopes; send the key as `Authorization: Bearer ssk_…`.",
        "GraphQL: POST /api/v1/graphql with { query, variables } — top-level fields are the resources below with the same filters.",
        `Webhooks (set up under Integrations) POST JSON { id, event, created_at, data } for: ${EVENTS.join(", ")}. Check the X-Webhook-Signature header: t=<unix time>,v1=<hex HMAC-SHA256 of "<t>.<raw body>"> using the endpoint's secret. Failed deliveries are retried for about a day.`,
        `Scopes: ${SCOPES.map(s => `${s.id} (${s.label})`).join("; ")}.`
      ].join("\n\n")
    },
    servers: [{ url: `${base}/api/v1` }],
    components: { securitySchemes: { apiKey: { type: "http", scheme: "bearer" } } },
    paths: {
      "/students": list("Students on roll", "students:read", [q("class", "class name or id"), q("status", "active (default), graduated, withdrawn…")]),
      "/classes": list("Classes with their subjects and teachers", "classes:read"),
      "/staff": list("Staff directory", "staff:read"),
      "/attendance": list("Morning register marks", "attendance:read", [q("from", "YYYY-MM-DD (required)"), q("to", "YYYY-MM-DD"), q("class", "class name or id")]),
      "/results": list("Published term results", "results:read", [q("term", "term id"), q("student", "student id")]),
      "/invoices": list("Fee invoices", "fees:read", [q("status", "issued, part_paid, paid, void"), q("student", "student id"), q("term", "term id")]),
      "/payments": list("Payments received", "payments:read", [q("from", "YYYY-MM-DD"), q("to", "YYYY-MM-DD")]),
      "/applications": {
        ...list("Admissions applications", "applications:read", [q("status", "new, reviewing, offered, enrolled…")]),
        post: { summary: "Send in an application (e.g. from the school website)", description: "Needs the applications:write scope. The family receives their tracking link as usual.", security: [{ apiKey: [] }],
          requestBody: { content: { "application/json": { schema: { type: "object", required: ["first_name", "last_name", "applying_for", "guardian_name", "guardian_phone", "consent"],
            properties: { first_name: { type: "string" }, last_name: { type: "string" }, other_names: { type: "string" }, gender: { enum: ["male", "female", "other"] }, date_of_birth: { type: "string", format: "date" },
              applying_for: { type: "string" }, previous_school: { type: "string" }, guardian_name: { type: "string" }, guardian_phone: { type: "string" }, guardian_email: { type: "string", format: "email" },
              guardian_relation: { type: "string" }, address: { type: "string" }, notes: { type: "string" }, consent: { const: true } } } } } },
          responses: { 201: { description: "{ data: { id, application_no, status, tracking_url } }" }, 422: { description: "invalid fields" } } }
      },
      "/events": list("Events the school shows on its website", "events:read"),
      "/news": list("Published news posts", "news:read"),
      "/graphql": { post: { summary: "GraphQL queries over the same resources", security: [{ apiKey: [] }], responses: { 200: { description: "{ data, errors? }" } } } }
    }
  });
}
