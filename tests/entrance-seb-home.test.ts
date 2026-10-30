import { describe, it, expect, vi, beforeEach } from "vitest";

// Entrance tests at home with Safe Exam Browser (migration 9000): the school decides per intake.
let plan: Record<string, unknown> = { seb_at_home: true, face_check: false };
const events: unknown[] = [];
const attempt = { id: "att-1", tenant_id: "t1", application_id: "app-1", exam_id: "ex-1", status: "assigned", sitting_id: null,
  exams: { id: "ex-1", title: "JSS1 entrance test", instructions: null, duration_minutes: 40, settings: {}, status: "published" },
  applications: { id: "app-1", tenant_id: "t1", first_name: "Tobi", tenants: { status: "active", name: "Greenfield" } } };

const chain = (table: string) => {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "order", "limit", "update"]) c[m] = () => c;
  c.insert = (p: unknown) => { if (table === "entrance_events") events.push(p); return c; };
  const result = () => ({
    entrance_attempts: { data: attempt }, applications: { data: { entrance_plan_id: "plan-1" } },
    entrance_plans: { data: plan }, tenant_settings: { data: { school_name: "Greenfield" } }
  } as Record<string, unknown>)[table] ?? { data: null };
  c.maybeSingle = async () => result();
  c.single = async () => result();
  c.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok);
  return c;
};
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ from: (t: string) => chain(t), storage: { from: () => ({}) } }) }));
// No questions: a start that gets past the Safe Exam Browser check stops at "not finished setting this test".
vi.mock("@/lib/exams/server", () => ({ loadQuestions: async () => [], markCodeQuestions: async (_s: unknown, a: unknown) => a, GRACE_MS: 60_000, VIOLATION_KINDS: [] }));

const { GET, POST } = await import("@/app/api/entrance/[token]/route");
const TOKEN = "a".repeat(36);
const params = { params: Promise.resolve({ token: TOKEN }) };
const SEB_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 SEB/3.7.1";
const start = (ua = "Mozilla/5.0 (Windows NT 10.0) Chrome/130") => POST(new Request(`https://school.example/api/entrance/${TOKEN}`, {
  method: "POST", headers: { "content-type": "application/json", "user-agent": ua }, body: JSON.stringify({ action: "start" })
}) as never, params);

describe("Safe Exam Browser for entrance tests at home", () => {
  beforeEach(() => { events.length = 0; plan = { seb_at_home: true, face_check: false }; });

  it("won't start outside Safe Exam Browser, and records the attempt", async () => {
    const r = await start();
    expect(r.status).toBe(403);
    expect((await r.json()).error).toMatch(/Safe Exam Browser/);
    expect(events).toEqual([expect.objectContaining({ kind: "seb_refused", attempt_id: "att-1" })]);
  });

  it("starts inside Safe Exam Browser", async () => {
    const r = await start(SEB_UA);
    expect((await r.json()).error).toMatch(/not finished setting this test/);   // got past the SEB check
    expect(events).toEqual([]);
  });

  it("gives each family its own SEB file that opens straight on their test", async () => {
    const r = await GET(new Request(`https://school.example/api/entrance/${TOKEN}?seb=1`) as never, params);
    expect(r.headers.get("content-type")).toBe("application/seb");
    const xml = await r.text();
    expect(xml).toContain(`/entrance/${TOKEN}</string>`);
    expect(xml).toContain(`/entrance/${TOKEN}?done=1</string>`);
  });

  it("tells the test page what to show", async () => {
    const outside = await (await GET(new Request(`https://school.example/api/entrance/${TOKEN}`) as never, params)).json();
    expect(outside.info.seb).toMatchObject({ required: true, in_seb: false, file_url: `/api/entrance/${TOKEN}?seb=1` });
    expect(outside.info.seb.launch_url).toMatch(/^sebs?:\/\//);
    const inside = await (await GET(new Request(`https://school.example/api/entrance/${TOKEN}`, { headers: { "user-agent": SEB_UA } }) as never, params)).json();
    expect(inside.info.seb.in_seb).toBe(true);
  });

  it("is off unless the school turns it on: no SEB needed and no file given", async () => {
    plan = { seb_at_home: false, face_check: false };
    expect((await (await start()).json()).error).toMatch(/not finished setting this test/);
    const info = await (await GET(new Request(`https://school.example/api/entrance/${TOKEN}`) as never, params)).json();
    expect(info.info.seb).toBeNull();
    expect((await GET(new Request(`https://school.example/api/entrance/${TOKEN}?seb=1`) as never, params)).status).toBe(404);
  });
});
