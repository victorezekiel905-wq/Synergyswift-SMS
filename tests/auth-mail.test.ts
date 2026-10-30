import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// A pretend database and Supabase admin API, recording what the routes do.
const db = vi.hoisted(() => ({
  rows: {} as Record<string, any[]>,
  calls: [] as { table: string; op: string; payload?: any; filters: [string, string, unknown][] }[],
  admin: {} as Record<string, any>,
  claim: null as string | null
}));
function table(name: string) {
  const call = { table: name, op: "select", payload: undefined as any, filters: [] as [string, string, unknown][] };
  db.calls.push(call);
  const match = () => (db.rows[name] ?? []).filter(r => call.filters.every(([k, op, v]) => op === "eq" ? r[k] === v : op === "is" ? (r[k] ?? null) === v : true));
  const q: any = {
    select: () => q, order: () => q, limit: () => q, gt: () => q, gte: () => q, not: () => q, neq: () => q,
    eq: (k: string, v: unknown) => { call.filters.push([k, "eq", v]); return q; },
    is: (k: string, v: unknown) => { call.filters.push([k, "is", v]); return q; },
    insert: (p: any) => { call.op = "insert"; call.payload = p; return q; },
    upsert: (p: any) => { call.op = "upsert"; call.payload = p; return q; },
    update: (p: any) => { call.op = "update"; call.payload = p; return q; },
    maybeSingle: async () => ({ data: match()[0] ?? null, error: null }),
    then: (ok: any, bad: any) => Promise.resolve({ data: match(), error: null, count: 0 }).then(ok, bad)
  };
  return q;
}
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: table,
    rpc: async (fn: string, args: any) => fn === "class_lookup_by_code" ? { data: args.p_code === "ABC123" ? [{ id: "c1", tenant_id: "t-a" }] : [], error: null }
      : fn === "claim_school_code" ? { data: db.claim, error: null } : { data: null, error: null },
    auth: { admin: db.admin }
  })
}));
const verifyOtp = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { verifyOtp, resetPasswordForEmail: vi.fn(async () => ({ error: null })) } }) }));

import { confirmLink, linkFrom, safeNext, mailable, sendAuthEmail } from "@/lib/auth-mail";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as confirmPost } from "@/app/api/auth/confirm/route";
import { POST as checkCode } from "@/app/api/auth/school-code/route";
import { hashSchoolCode } from "@/lib/school-codes";
import { NextRequest } from "next/server";

const post = (url: string, body: unknown) => new NextRequest(`https://app.example${url}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const keep = { ...process.env };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  db.rows = { tenants: [{ id: "t-a", status: "active" }], school_signup_codes: [{ code_hash: hashSchoolCode("SSC-ABCD-EFGH-JKMN"), label: "Greenfield College", expires_at: "2099-01-01T00:00:00Z", used_at: null, revoked_at: null }] };
  db.calls = []; db.claim = "code-1";
  db.admin.deleteUser = vi.fn(async () => ({ error: null }));
  Object.assign(process.env, { NEXT_PUBLIC_APP_URL: "https://app.example", EMAIL_PROVIDER: "sendgrid", SENDGRID_API_KEY: "SG.test", EMAIL_FROM: "Synergy Swift <hello@school.example>" });
  fetchMock = vi.fn(async () => ({ ok: true, status: 202, headers: new Headers({ "x-message-id": "m1" }), text: async () => "" }));
  vi.stubGlobal("fetch", fetchMock);
  db.admin.generateLink = vi.fn(async (o: any) => ({ data: { user: { id: "u-new", email: o.email, email_confirmed_at: null }, properties: { hashed_token: "hashtok1234567", verification_type: o.type } }, error: null }));
});
afterEach(() => { process.env = { ...keep }; vi.unstubAllGlobals(); });

describe("sign-in email links", () => {
  it("point at our confirm page, never off-site", () => {
    expect(confirmLink("https://app.example/", "abc", "signup", "/school")).toBe("https://app.example/auth/confirm?token_hash=abc&type=signup&next=%2Fschool");
    expect(safeNext("//evil.example")).toBe("/dashboard");
    expect(safeNext("https://evil.example")).toBe("/dashboard");
    expect(safeNext("/\\evil.example")).toBe("/dashboard");
  });
  it("use the type Supabase actually made (a sign-in link for an unconfirmed account confirms it)", () => {
    expect(linkFrom("https://a", { properties: { hashed_token: "t", verification_type: "signup" } }, "magiclink", "/")).toContain("type=signup");
    expect(linkFrom("https://a", { properties: { hashed_token: "t", verification_type: "weird" } }, "recovery", "/")).toContain("type=recovery");
    expect(linkFrom("https://a", { properties: {} }, "signup", "/")).toBeNull();
  });
  it("are never sent to student usernames' made-up addresses", () => {
    expect(mailable("ada@gmail.com")).toBe(true);
    expect(mailable("ada.obi@students.synergyswift.invalid")).toBe(false);
  });
  it("go through SendGrid with click tracking off, so the one-time link is not rewritten", async () => {
    const r = await sendAuthEmail({ kind: "reset", to: "ada@gmail.com", name: "Ada", link: "https://app.example/auth/confirm?token_hash=x&type=recovery&next=%2F" });
    expect(r.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.sendgrid.com/v3/mail/send");
    const body = JSON.parse(String(init.body));
    expect(body.tracking_settings.click_tracking).toEqual({ enable: false, enable_text: false });
    expect(body.subject).toBe("Reset your Synergy Swift password");
    expect(body.content[0].value).toContain("token_hash=x");
  });
});

describe("signing up", () => {
  it("makes the account, emails the link from Synergy Swift and records it for the school's Sign-ups page", async () => {
    const res = await register(post("/api/auth/register", { as: "student", email: "Ada@Gmail.com", password: "longenough", full_name: "Ada Obi", join_code: "abc123" }));
    expect(await res.json()).toEqual({ ok: true, status: "sent", email: "ada@gmail.com" });
    expect(db.admin.generateLink).toHaveBeenCalledWith(expect.objectContaining({ type: "signup", email: "ada@gmail.com", password: "longenough",
      options: expect.objectContaining({ data: { full_name: "Ada Obi", signup_as: "student", join_code: "ABC123" } }) }));
    const req = db.calls.find(c => c.table === "signup_requests" && c.op === "upsert");
    expect(req?.payload).toMatchObject({ user_id: "u-new", tenant_id: "t-a", kind: "student", email: "ada@gmail.com" });
    const mail = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(mail.content[0].value).toContain("https://app.example/auth/confirm?token_hash=hashtok1234567&type=signup");
  });
  it("refuses a wrong class code or school code before making any account", async () => {
    const a = await register(post("/api/auth/register", { as: "student", email: "a@b.co", password: "longenough", full_name: "A", join_code: "ZZZ999" }));
    expect(a.status).toBe(404);
    const b = await register(post("/api/auth/register", { as: "school", email: "a@b.co", password: "longenough", full_name: "A", school_name: "Greenfield", school_code: "SSC-AAAA-BBBB-CCCC" }));
    expect(b.status).toBe(403);
    expect(db.admin.generateLink).not.toHaveBeenCalled();
  });
  it("waits for an admin when no email service is set up", async () => {
    delete process.env.SENDGRID_API_KEY;
    const res = await register(post("/api/auth/register", { as: "student", email: "a@b.co", password: "longenough", full_name: "A", join_code: "ABC123" }));
    expect((await res.json()).status).toBe("waiting");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("asks for a real password", async () => {
    const res = await register(post("/api/auth/register", { as: "student", email: "a@b.co", password: "short", full_name: "A", join_code: "ABC123" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/8 characters/);
  });
});

describe("the confirm button", () => {
  const form = (o: Record<string, string>) => new NextRequest("https://app.example/api/auth/confirm", { method: "POST", body: new URLSearchParams(o) });
  it("spends the token, marks the sign-up confirmed and finishes signing in", async () => {
    verifyOtp.mockResolvedValueOnce({ data: { user: { id: "u-new", email_confirmed_at: "2026-10-28T10:00:00Z" } }, error: null });
    const res = await confirmPost(form({ token_hash: "hashtok1234567", type: "signup", next: "/dashboard" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://app.example/login?finish=1&next=%2Fdashboard");
    expect(db.calls.find(c => c.table === "signup_requests" && c.op === "update")?.payload).toMatchObject({ confirmed_how: "email" });
  });
  it("sends a used or expired link back to sign in with a plain message", async () => {
    verifyOtp.mockResolvedValueOnce({ data: { user: null }, error: { message: "expired" } });
    const res = await confirmPost(form({ token_hash: "old", type: "recovery", next: "/account/security?reset=1" }));
    expect(res.headers.get("location")).toMatch(/^https:\/\/app\.example\/login\?error=That%20link%20has%20expired/);
  });
});

describe("onboarding a school with a one-time code", () => {
  it("checks the code first, and tells the school who it was made for and when it runs out", async () => {
    const ok = await checkCode(post("/api/auth/school-code", { code: "ssc abcd efgh jkmn" }));
    expect(await ok.json()).toEqual({ ok: true, school: "Greenfield College", expires_at: "2099-01-01T00:00:00Z", fixed: false });
    const bad = await checkCode(post("/api/auth/school-code", { code: "SSC-AAAA-BBBB-CCCC" }));
    expect(bad.status).toBe(404);
    expect(db.calls.find(c => c.table === "auth_mail_log" && c.op === "insert")?.payload).toMatchObject({ kind: "code_miss" });
  });
  it("uses the code up the moment the account is made, so confirming the email later can't outrun the 20 minutes", async () => {
    const res = await register(post("/api/auth/register", { as: "school", email: "head@greenfield.ng", password: "longenough", full_name: "Ngozi Okonkwo", school_name: "Greenfield College", school_code: "SSC-ABCD-EFGH-JKMN" }));
    expect((await res.json()).status).toBe("sent");
    const meta = db.admin.generateLink.mock.calls[0][0].options.data;
    expect(meta).toEqual({ full_name: "Ngozi Okonkwo", signup_as: "school", school_name: "Greenfield College" });   // the code itself is not kept
    expect(db.calls.find(c => c.table === "signup_requests" && c.op === "upsert")?.payload).toMatchObject({ kind: "school", tenant_id: null, detail: "Greenfield College" });
  });
  it("takes the account back if someone else used the code a moment earlier", async () => {
    db.claim = null;
    const res = await register(post("/api/auth/register", { as: "school", email: "head@greenfield.ng", password: "longenough", full_name: "N", school_name: "Greenfield College", school_code: "SSC-ABCD-EFGH-JKMN" }));
    expect(res.status).toBe(403);
    expect(db.admin.deleteUser).toHaveBeenCalledWith("u-new");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
