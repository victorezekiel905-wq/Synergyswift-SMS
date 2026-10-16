import { describe, it, expect } from "vitest";
import { newKey, hashKey, keyFrom, paging, signPayload, verifySignature, retryIn, parseGraphQL, project, rss, slugify } from "@/lib/open-api";

const H = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });

describe("keys", () => {
  it("makes keys that are stored only as a hash", () => {
    const k = newKey();
    expect(k.key).toMatch(/^ssk_[0-9A-Za-z]{32}$/);
    expect(k.prefix).toBe(k.key.slice(0, 12));
    expect(k.hash).toBe(hashKey(k.key));
    expect(k.hash).not.toContain(k.key.slice(4));
    expect(newKey().key).not.toBe(k.key);
  });
  it("reads the key from the request", () => {
    const k = newKey().key;
    expect(keyFrom(H({ authorization: `Bearer ${k}` }))).toBe(k);
    expect(keyFrom(H({ "x-api-key": k }))).toBe(k);
    expect(keyFrom(H({ authorization: "Bearer nope" }))).toBeNull();
    expect(keyFrom(H({}))).toBeNull();
  });
  it("pages", () => {
    expect(paging(new URLSearchParams("limit=500&offset=-3"))).toEqual({ limit: 200, offset: 0 });
    expect(paging(new URLSearchParams(""))).toEqual({ limit: 50, offset: 0 });
  });
});

describe("webhook signatures", () => {
  it("sign and verify, rejecting tampering and old messages", () => {
    const body = JSON.stringify({ event: "payment.received" });
    const sig = signPayload("s3cret", body, 1_800_000_000);
    expect(sig).toMatch(/^t=1800000000,v1=[0-9a-f]{64}$/);
    expect(verifySignature("s3cret", sig, body, 1_800_000_100)).toBe(true);
    expect(verifySignature("s3cret", sig, body + " ", 1_800_000_100)).toBe(false);
    expect(verifySignature("other", sig, body, 1_800_000_100)).toBe(false);
    expect(verifySignature("s3cret", sig, body, 1_800_001_000)).toBe(false);
    expect(verifySignature("s3cret", "garbage", body)).toBe(false);
  });
  it("back off, then give up", () => {
    expect([1, 2, 3, 7].map(retryIn)).toEqual([1, 5, 15, 720]);
    expect(retryIn(8)).toBeNull();
  });
});

describe("GraphQL", () => {
  it("reads fields, aliases, arguments, variables and nesting", () => {
    const q = parseGraphQL(`query Roll($c: String, $n: Int) {
      # comment
      pupils: students(class: $c, limit: $n, status: active, ids: ["a", "b"]) { id name class { name } }
      news(limit: 2) { title }
    }`, { c: "JSS1A", n: 5 });
    expect(q).toHaveLength(2);
    expect(q[0]).toMatchObject({ name: "students", alias: "pupils", args: { class: "JSS1A", limit: 5, status: "active", ids: ["a", "b"] } });
    expect(q[0].fields.map(f => f.name)).toEqual(["id", "name", "class"]);
    expect(q[0].fields[2].fields[0].name).toBe("name");
    expect(parseGraphQL("{ classes { id } }")[0].args).toEqual({});
  });
  it("explains what it cannot do", () => {
    expect(() => parseGraphQL("mutation { x }")).toThrow(/only queries/);
    expect(() => parseGraphQL("{ students { ...F } }")).toThrow(/fragments/);
    expect(() => parseGraphQL("{ students(class: $c) { id } }")).toThrow(/variable \$c/);
    expect(() => parseGraphQL("{ students { id }")).toThrow(/unclosed/);
    expect(() => parseGraphQL("{ a } { b }")).toThrow(/one operation/);
  });
  it("projects only the asked-for fields", () => {
    const fields = parseGraphQL("{ s: students { id who: name class { name } } }")[0].fields;
    expect(project([{ id: 1, name: "Ada", secret: "x", class: { name: "JSS1", id: 9 } }], fields)).toEqual([{ id: 1, who: "Ada", class: { name: "JSS1" } }]);
    expect(project({ id: 1 }, parseGraphQL("{ x { missing } }")[0].fields)).toEqual({ missing: null });
  });
});

describe("website", () => {
  it("escapes RSS", () => {
    const r = rss({ title: "A & B", link: "https://s/x", description: "d" }, [{ title: "<Sports>", link: "https://s/n/1", summary: "Fun & games", published_at: "2026-10-16T10:00:00Z", guid: "1" }]);
    expect(r).toContain("<title>A &amp; B</title>");
    expect(r).toContain("<title>&lt;Sports&gt;</title>");
    expect(r).toContain("<pubDate>Fri, 16 Oct 2026 10:00:00 GMT</pubDate>");
  });
  it("slugifies", () => {
    expect(slugify("Inter-House Sports — Day 1!")).toBe("inter-house-sports-day-1");
    expect(slugify("Café débat")).toBe("cafe-debat");
    expect(slugify("!!!")).toBe("post");
  });
});

import { safeWebhookUrl } from "@/lib/open-api";
describe("safeWebhookUrl", () => {
  it("allows public https sites only", () => {
    expect(safeWebhookUrl("https://hooks.example.org/x")).toBeNull();
    expect(safeWebhookUrl("http://hooks.example.org")).toMatch(/https/);
    for (const bad of ["https://localhost/x", "https://127.0.0.1/", "https://10.1.2.3", "https://192.168.0.5", "https://172.20.0.1", "https://169.254.169.254/latest", "https://[::1]/", "https://intranet/", "https://user:pw@example.org"]) {
      expect(safeWebhookUrl(bad)).not.toBeNull();
    }
    expect(safeWebhookUrl("nonsense")).toMatch(/valid/);
  });
});
