import { describe, it, expect, vi, beforeEach } from "vitest";

const pay = vi.hoisted(() => ({ init: vi.fn(), verify: vi.fn(), configured: vi.fn(() => true) }));
vi.mock("@/lib/payments", () => ({
  initializePayment: pay.init, verifyPayment: pay.verify, providerConfigured: pay.configured,
  matchesExpected: (v: { status: string; amount: number; currency: string }, amount: number, cur: string) => v.status === "success" && Math.abs(v.amount - amount) < 0.005 && v.currency === cur
}));
const billing = vi.hoisted(() => ({ paid: vi.fn(async () => ({})) }));
vi.mock("@/lib/saas-server", () => ({ markInvoicePaid: billing.paid, platformSetting: async (_s: unknown, _k: string, d: unknown) => d }));
vi.mock("@/lib/messaging/providers", () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));

process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
import { payToken, invoiceFromToken, newInvoiceReference, invoiceFromReference, payLink } from "@/lib/invoice-link";
import { confirmInvoicePayment, startInvoicePayment } from "@/lib/platform-pay";

const ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const invoice = (o: Record<string, unknown> = {}) => ({ id: ID, tenant_id: "t1", number: "SS-2026-0007", status: "open", kind: "renewal", amount_cents: 90_000_000, currency: "NGN",
  lines: [], period_start: "2027-01-01", period_end: "2027-12-31", due_at: null, paid_at: null, tenants: { name: "Greenfield College", contact_email: "bursar@gf.ng" }, ...o });
const svcWith = (inv: unknown) => ({ from: () => { const q: any = { select: () => q, eq: () => q, insert: async () => ({}), maybeSingle: async () => ({ data: inv }) }; return q; } });

beforeEach(() => { pay.init.mockReset(); pay.verify.mockReset(); billing.paid.mockClear(); pay.configured.mockReturnValue(true); });

describe("private pay links", () => {
  it("open the right invoice and can't be guessed or altered", () => {
    const t = payToken(ID);
    expect(invoiceFromToken(t)).toBe(ID);
    const other = "8c9e6679-7425-40de-944b-e07fc1f90ae7".replace(/-/g, "");
    expect(invoiceFromToken(`${other}.${t.split(".")[1]}`)).toBeNull();     // someone else's invoice with this signature
    expect(invoiceFromToken(`${t.slice(0, -2)}xx`)).toBeNull();             // a changed signature
    expect(invoiceFromToken("not-a-link")).toBeNull();
    expect(payLink("https://app.example/", ID)).toBe(`https://app.example/billing/${t}`);
  });
  it("payment references carry the invoice", () => {
    const ref = newInvoiceReference(ID);
    expect(ref).toMatch(/^SSI-[0-9a-f]{32}-[0-9a-f]{8}$/);
    expect(invoiceFromReference(ref)).toBe(ID);
    expect(invoiceFromReference("DON-123")).toBeNull();
  });
});

describe("paying a Synergy Swift invoice", () => {
  it("starts a Paystack checkout to the platform's own account for the exact amount", async () => {
    pay.init.mockResolvedValue({ ok: true, url: "https://checkout.paystack.com/abc" });
    expect(await startInvoicePayment(svcWith(invoice()), ID, "bursar@gf.ng", "https://app.example")).toEqual({ url: "https://checkout.paystack.com/abc" });
    const req = pay.init.mock.calls[0][0];
    expect(req).toMatchObject({ provider: "paystack", amount: 900_000, currency: "NGN", email: "bursar@gf.ng", callbackUrl: "https://app.example/api/pay/verify" });
    expect(req.subaccount).toBeUndefined();
    expect(invoiceFromReference(req.reference)).toBe(ID);
  });
  it("won't charge for a paid or cancelled invoice, or before Paystack is set up", async () => {
    expect(await startInvoicePayment(svcWith(invoice({ status: "paid" })), ID, "a@b.co", "x")).toMatchObject({ error: expect.stringMatching(/already paid/) });
    expect(await startInvoicePayment(svcWith(invoice({ status: "void" })), ID, "a@b.co", "x")).toMatchObject({ status: 409 });
    pay.configured.mockReturnValue(false);
    expect(await startInvoicePayment(svcWith(invoice()), ID, "a@b.co", "x")).toMatchObject({ status: 503 });
    expect(pay.init).not.toHaveBeenCalled();
  });
  it("marks the invoice paid only when Paystack confirms the full amount", async () => {
    const ref = newInvoiceReference(ID);
    pay.verify.mockResolvedValue({ status: "success", amount: 899_000, currency: "NGN" });
    expect((await confirmInvoicePayment(svcWith(invoice()), ref)).status).toBe("pending");
    expect(billing.paid).not.toHaveBeenCalled();
    pay.verify.mockResolvedValue({ status: "success", amount: 900_000, currency: "NGN" });
    const done = await confirmInvoicePayment(svcWith(invoice()), ref);
    expect(done).toEqual({ status: "success", token: payToken(ID) });
    expect(billing.paid).toHaveBeenCalledWith(expect.anything(), ID, { method: "paystack", reference: ref }, null);
  });
  it("does nothing more for an invoice already paid (the webhook and the return page both call it)", async () => {
    expect((await confirmInvoicePayment(svcWith(invoice({ status: "paid" })), newInvoiceReference(ID))).status).toBe("success");
    expect(pay.verify).not.toHaveBeenCalled();
    expect(billing.paid).not.toHaveBeenCalled();
  });
});
