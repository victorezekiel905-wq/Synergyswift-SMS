import { describe, it, expect, vi } from "vitest";

// School logo, signature and stamp images: served without signing in, but only uploaded branding images.
const downloads: string[] = [];
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ storage: { from: () => ({
  download: async (p: string) => { downloads.push(p); return { data: new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])]), error: null }; }
}) } }) }));

const { GET } = await import("@/app/api/public/branding/[...path]/route");
const get = (path: string) => GET(new Request(`https://x/api/public/branding/${path}`) as never, { params: Promise.resolve({ path: path.split("/") }) });
const school = "0a1b2c3d-0000-0000-0000-000000000001";

describe("school branding images", () => {
  it("serves an uploaded logo, signature or stamp, as an image and nothing else", async () => {
    const r = await get(`${school}/branding/signature-${"a1".repeat(12)}.png`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  });
  it("refuses anything outside the branding folder, or with a guessable name", async () => {
    downloads.length = 0;
    for (const p of [`${school}/branding/../../students/photo.png`, `${school}/documents/report.pdf`, `${school}/branding/logo.png`,
      `${school}/branding/logo-${"a1".repeat(12)}.svg`, `../${school}/branding/logo-${"a1".repeat(12)}.png`])
      expect((await get(p)).status, p).toBe(404);
    expect(downloads).toEqual([]);   // nothing was even looked up
  });
});
