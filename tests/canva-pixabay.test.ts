import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
const uploads: { path: string; size: number }[] = [];
const media: Record<string, unknown>[] = [];
vi.mock("@/live/lib/supabase/service", () => ({
  createServiceClient: () => ({
    storage: { from: () => ({ upload: async (path: string, bytes: Uint8Array) => { uploads.push({ path, size: bytes.byteLength }); return { error: null }; } }) },
    from: () => {
      const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null }), insert: (row: Record<string, unknown>) => { media.push(row); return Promise.resolve({ error: null }); } };
      return q;
    }
  })
}));

import { seal, unseal, pkcePair, authorizeUrl, importDeck, CanvaAuthError, PPTX } from "@/lib/canva";
import { findPhoto } from "@/live/lib/ai-slides";
import { designSlide, THEMES } from "@/live/slides/ai-deck";

describe("Canva", () => {
  beforeEach(() => { process.env.CANVA_CLIENT_ID = "client-1"; process.env.CANVA_CLIENT_SECRET = "secret-1"; });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps tokens encrypted and refuses tampered ones", () => {
    const s = seal("access-token-123");
    expect(s).not.toContain("access-token");
    expect(unseal(s)).toBe("access-token-123");
    const parts = s.split(".");
    parts[3] = parts[3]!.slice(0, -2) + (parts[3]!.endsWith("AA") ? "BB" : "AA");
    expect(() => unseal(parts.join("."))).toThrow();
  });

  it("asks Canva to sign in with PKCE and only the scopes it needs", () => {
    const p = pkcePair();
    expect(p.verifier.length).toBeGreaterThanOrEqual(43);
    expect(p.challenge).not.toBe(p.verifier);
    const u = new URL(authorizeUrl({ challenge: p.challenge, state: p.state, redirectUri: "https://school.ng/api/canva/callback" }));
    expect(u.origin + u.pathname).toBe("https://www.canva.com/api/oauth/authorize");
    expect(u.searchParams.get("code_challenge_method")).toBe("s256");
    expect(u.searchParams.get("scope")).toBe("design:content:write design:meta:read");
    expect(u.searchParams.get("client_id")).toBe("client-1");
    expect(u.searchParams.get("state")).toBe(p.state);
  });

  it("imports the PowerPoint and waits for the edit link", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ job: { id: "job1", status: "in_progress" } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ job: { id: "job1", status: "success", result: { designs: [{ id: "D1", urls: { edit_url: "https://www.canva.com/design/D1/edit" } }] } } }) });
    vi.stubGlobal("fetch", fetch);
    vi.useFakeTimers();
    const p = importDeck("tok", "Photosynthesis for JSS 2", new Uint8Array(500));
    await vi.advanceTimersByTimeAsync(2500);
    expect(await p).toEqual({ editUrl: "https://www.canva.com/design/D1/edit", designId: "D1" });
    vi.useRealTimers();
    const [url, init] = fetch.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).toBe("https://api.canva.com/rest/v1/imports");
    const meta = JSON.parse(init.headers["Import-Metadata"]!);
    expect(Buffer.from(meta.title_base64, "base64").toString()).toBe("Photosynthesis for JSS 2");
    expect(meta.mime_type).toBe(PPTX);
    expect(String((fetch.mock.calls[1] as unknown[])[0])).toBe("https://api.canva.com/rest/v1/imports/job1");
  });

  it("asks the teacher to connect again when Canva refuses the token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
    await expect(importDeck("old", "x", new Uint8Array(500))).rejects.toBeInstanceOf(CanvaAuthError);
  });
});

describe("Pixabay photos for AI slides", () => {
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.PIXABAY_API_KEY; uploads.length = 0; media.length = 0; });
  const hit = (id: number, w = 1920) => ({ id, pageURL: `https://pixabay.com/photos/leaf-${id}/`, tags: "leaf, green, sunlight", webformatURL: `https://cdn.pixabay.com/w${id}.jpg`,
    largeImageURL: `https://cdn.pixabay.com/l${id}.jpg`, user: "Sunny", imageWidth: w, imageHeight: 1080 });

  it("copies the photo into the school's storage, credits Pixabay and never reuses one in a deck", async () => {
    process.env.PIXABAY_API_KEY = "px";
    const fetch = vi.fn(async (url: string) => url.startsWith("https://pixabay.com/api/")
      ? { ok: true, status: 200, json: async () => ({ hits: [hit(1, 640), hit(2), hit(3)] }) }
      : { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(2048) });
    vi.stubGlobal("fetch", fetch);
    const used = new Set<string>();
    const owner = { tenantId: "t1", userId: "u1" };
    const a = await findPhoto("green leaf sunlight", used, owner);
    const b = await findPhoto("green leaf sunlight", used, owner);
    expect(a?.source).toBe("pixabay");
    expect(a?.media_path).toBe("t1/u1/pixabay-2.jpg");      // the small one (640 px) is skipped
    expect(b?.media_path).toBe("t1/u1/pixabay-3.jpg");      // not the same photo twice
    expect(a?.credit).toBe("Sunny");
    expect(a?.credit_url).toBe("https://pixabay.com/photos/leaf-2/");
    expect(uploads.map(u => u.path)).toEqual(["t1/u1/pixabay-2.jpg", "t1/u1/pixabay-3.jpg"]);
    expect(media[0]).toMatchObject({ tenant_id: "t1", owner_id: "u1", kind: "image", tags: ["pixabay", "ai slides"] });
    // Pixabay asks for searches to be cached: one search for the same words.
    expect(fetch.mock.calls.filter(c => String(c[0]).startsWith("https://pixabay.com/api/")).length).toBe(1);
    const q = new URL(String(fetch.mock.calls[0]![0]));
    expect(q.searchParams.get("safesearch")).toBe("true");
    expect(q.searchParams.get("image_type")).toBe("photo");
  });

  it("puts the stored copy on the slide with a Pixabay credit", () => {
    const photo = { url: "", media_path: "t1/u1/pixabay-2.jpg", alt: "leaf", credit: "Sunny", credit_url: "https://pixabay.com/photos/leaf-2/", download_location: "", source: "pixabay" as const };
    const c = designSlide({ layout: "picture", heading: "Leaves make food", points: ["Sunlight", "Water"], notes: "" }, THEMES.swift, photo);
    const img = (c.elements ?? []).find((e: any) => e.type === "image") as any;
    expect(img.media_path).toBe("t1/u1/pixabay-2.jpg");
    expect(img.url).toBeUndefined();
    expect(JSON.stringify(c.elements)).toContain("Photo: Sunny / Pixabay");
  });
});
