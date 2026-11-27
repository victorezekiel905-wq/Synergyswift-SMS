import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readFileSync } from "node:fs";
import { enqueue } from "@/lib/messaging/outbox";

// A parent with email and WhatsApp got one email row (no template_params) and one WhatsApp row (with
// them) in the same insert; the database was sent null for the email's template_params and refused the
// batch ("outbox insert failed: null value in column template_params"). Found on Reset sign-in.
function fakeSvc() {
  const inserted: Record<string, unknown>[] = [];
  const svc = {
    from: (table: string) => ({
      select: () => ({ in: async () => ({ data: [] }) }),
      insert: (rows: Record<string, unknown>[]) => {
        if (table === "message_outbox") inserted.push(...rows);
        return { select: async () => ({ data: rows.map((_, i) => ({ id: `m${i}` })), error: null }) };
      }
    })
  };
  return { svc, inserted };
}

describe("messages queued together", () => {
  it("every row carries template_params, empty when the channel does not use them", async () => {
    const { svc, inserted } = fakeSvc();
    const ids = await enqueue(svc, [
      { tenant_id: "t", channel: "email", to_address: "a@b.co", kind: "account_key", body_text: "hi" },
      { tenant_id: "t", channel: "whatsapp", to_address: "2348000000000", kind: "account_key", body_text: "hi", template_name: null, template_params: ["x"] }
    ] as never);
    expect(ids).toHaveLength(2);
    expect(inserted.map(r => r.template_params)).toEqual([[], ["x"]]);
  });

  it("a failed message never hides a new student password", () => {
    const src = readFileSync("src/lib/accounts-server.ts", "utf8");
    expect(src.match(/await enqueue\(svc, rows\)\.then\(\(\) => rows\.length, \(\) => 0\)/g)?.length).toBe(2);
  });
});
