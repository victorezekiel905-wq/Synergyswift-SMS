import "server-only";
import { DECK_LAYOUTS, type Outline, type Photo } from "@/live/slides/ai-deck";
import * as z from "zod/v4";
import { generateJson, aiConfigured, AiUnavailable, AiDeclined } from "@/lib/ai";

/*
 * "Create slides with AI". Gemini writes a lesson outline (what each slide says and
 * which photo would help, plus notes for the teacher); Pixabay (or Unsplash) finds the photos;
 * src/slides/ai-deck.ts designs the slides. Keys live on the server only:
 * GEMINI_API_KEY (through src/lib/ai.ts), UNSPLASH_ACCESS_KEY.
 */

export class SlidesUnavailable extends Error {}

export const slidesConfigured = aiConfigured;
export const photosConfigured = () => Boolean(process.env.PIXABAY_API_KEY?.trim() || process.env.UNSPLASH_ACCESS_KEY?.trim());

export type SlidesRequest = { topic: string; level: string; subject?: string; count: number; notes?: string; pictures: boolean; tenantId?: string; userId?: string };

const SYSTEM = `You plan lesson slides for Synergy Swift, a live lesson platform used by teachers in Nigerian schools and elsewhere.

Plan slides a good teacher would be proud to project:
- Accurate, and pitched at the class level given. Clear, simple English. Use Nigerian and everyday contexts (names, naira, places, foods) where an example helps.
- Few words on each slide: a heading of at most 8 words; at most 5 points of at most 12 words each. The detail goes in the teacher's notes, not on the slide.
- Teach in a sensible order: what we will learn, then the ideas one at a time with examples, a moment to think, and a recap.
- Use the layouts:
  title: the first slide only. heading = lesson title, subheading = one line on what it is about.
  objectives: "In this lesson we will", 3 or 4 points that start with a verb.
  points: a heading and 3 to 5 points.
  picture: a heading, 2 to 4 points, and a photo that shows the idea.
  big_picture: a striking photo with a one-line caption as the heading.
  compare: two things side by side: left_heading/left_points and right_heading/right_points (2 to 4 points each).
  key_fact: one important fact or rule as the heading (at most 14 words); subheading explains it in one line.
  question: a question for the class to discuss as the heading; subheading is an optional hint.
  summary: the last slide: "Remember" and 3 to 5 key points.
- image_query: for picture, big_picture and (optionally) title: 2 to 4 plain English words for a real photograph that exists on a stock photo site, e.g. "green leaf sunlight", "market in Lagos". Never ask for diagrams, text, logos or famous people. Leave it empty on other layouts.
- notes: 2 to 4 sentences the teacher can say or do for that slide (an example, a question to ask, a quick activity).`;

const Slide = z.object({
  layout: z.enum(DECK_LAYOUTS),
  heading: z.string(),
  subheading: z.string().optional(),
  points: z.array(z.string()).optional(),
  left_heading: z.string().optional(),
  left_points: z.array(z.string()).optional(),
  right_heading: z.string().optional(),
  right_points: z.array(z.string()).optional(),
  image_query: z.string().optional(),
  notes: z.string()
});
const OutlineSchema = z.object({ title: z.string(), slides: z.array(Slide) });

/** Asks Gemini for the outline. Throws SlidesUnavailable for anything the teacher should be told plainly. */
export async function outlineSlides(req: SlidesRequest): Promise<Outline> {
  if (!slidesConfigured()) throw new SlidesUnavailable("Creating slides with AI isn't set up on this site yet. Ask your Synergy Swift administrator to add a Gemini API key.");
  const brief = [
    `Plan ${req.count} slides on "${req.topic}" for ${req.level}${req.subject ? `, ${req.subject}` : ""}.`,
    req.pictures ? "Use picture or big_picture layouts on about a third of the slides." : "Don't use the picture or big_picture layouts, and leave image_query empty.",
    req.notes ? `Base the slides on these notes from the teacher, and stay inside them:\n<notes>\n${req.notes}\n</notes>` : ""
  ].filter(Boolean).join("\n\n");
  try {
    return await generateJson({ task: "slides", schema: OutlineSchema, system: SYSTEM, prompt: brief, temperature: 0.6, maxTokens: 16384,
      quality: "best", timeoutMs: 90_000, tenantId: req.tenantId ?? null, userId: req.userId ?? null });
  } catch (e) {
    if (e instanceof AiUnavailable || e instanceof AiDeclined) throw new SlidesUnavailable(e instanceof AiDeclined ? "The AI wouldn't plan slides for that. Try wording the topic differently." : e.message);
    throw e;
  }
}

type UnsplashPhoto = {
  alt_description: string | null; description: string | null;
  urls: { regular: string }; links: { html: string; download_location: string };
  user: { name: string; links: { html: string } };
};
const UTM = "utm_source=synergyswift&utm_medium=referral";

/**
 * The best landscape photo for a search, skipping ones already used in this deck: Pixabay first
 * (PIXABAY_API_KEY), then Unsplash (UNSPLASH_ACCESS_KEY). Never throws.
 */
export async function findPhoto(query: string, used: Set<string>, owner?: { tenantId: string; userId: string }): Promise<Photo | undefined> {
  if (process.env.PIXABAY_API_KEY?.trim() && owner) {
    const p = await pixabayPhoto(query, used, owner);
    if (p) return p;
  }
  return unsplashPhoto(query, used);
}

type PixabayHit = { id: number; pageURL: string; tags: string; webformatURL: string; largeImageURL: string; user: string; imageWidth: number; imageHeight: number };
// Pixabay asks for search results to be cached for 24 hours.
const pixabayCache = new Map<string, { at: number; hits: PixabayHit[] }>();

export async function pixabaySearch(q: string): Promise<PixabayHit[]> {
  const hit = pixabayCache.get(q);
  if (hit && Date.now() - hit.at < 24 * 3600_000) return hit.hits;
  const url = `https://pixabay.com/api/?key=${encodeURIComponent(process.env.PIXABAY_API_KEY!.trim())}&q=${encodeURIComponent(q.slice(0, 100))}&image_type=photo&orientation=horizontal&safesearch=true&per_page=12&order=popular`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) { console.error("[ai-slides] Pixabay", res.status); return []; }
  const { hits } = (await res.json()) as { hits?: PixabayHit[] };
  const list = (hits ?? []).filter(h => h.imageWidth >= 960);
  pixabayCache.set(q, { at: Date.now(), hits: list });
  if (pixabayCache.size > 500) pixabayCache.delete(pixabayCache.keys().next().value!);
  return list;
}

/**
 * Pixabay doesn't allow lasting hotlinks, so the chosen photo is downloaded once into the school's
 * own lesson media (and its media library), and the slide points at that copy.
 */
async function pixabayPhoto(query: string, used: Set<string>, owner: { tenantId: string; userId: string }): Promise<Photo | undefined> {
  const q = query.trim();
  if (!q) return undefined;
  try {
    const p = (await pixabaySearch(q)).find(h => !used.has(`pixabay:${h.id}`));
    if (!p) return undefined;
    used.add(`pixabay:${p.id}`);
    const img = await fetch(p.largeImageURL || p.webformatURL, { signal: AbortSignal.timeout(15_000) });
    if (!img.ok) return undefined;
    const bytes = new Uint8Array(await img.arrayBuffer());
    if (bytes.byteLength > 8_000_000) return undefined;
    const { createServiceClient } = await import("@/live/lib/supabase/service");
    const svc = createServiceClient();
    const path = `${owner.tenantId}/${owner.userId}/pixabay-${p.id}.jpg`;
    const { error } = await svc.storage.from("live-lesson-media").upload(path, bytes, { contentType: "image/jpeg", upsert: true });
    if (error) { console.error("[ai-slides] photo copy", error.message); return undefined; }
    const alt = (p.tags || q).slice(0, 200);
    const { data: had } = await svc.from("lesson_media").select("id").eq("tenant_id", owner.tenantId).eq("storage_path", path).maybeSingle();
    if (!had) await svc.from("lesson_media").insert({ tenant_id: owner.tenantId, owner_id: owner.userId, storage_path: path, kind: "image", mime_type: "image/jpeg",
      bytes: bytes.byteLength, title: `${q} (Pixabay)`.slice(0, 200), alt_text: alt, tags: ["pixabay", "ai slides"] }).then(() => null, () => null);
    return { url: "", media_path: path, alt, credit: p.user, credit_url: p.pageURL, download_location: "", source: "pixabay" };
  } catch { return undefined; }
}

async function unsplashPhoto(query: string, used: Set<string>): Promise<Photo | undefined> {
  const key = process.env.UNSPLASH_ACCESS_KEY?.trim();
  const q = query.trim().slice(0, 80);
  if (!key || !q) return undefined;
  try {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=6&orientation=landscape&content_filter=high`;
    const res = await fetch(url, { headers: { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) { console.error("[ai-slides] Unsplash", res.status); return undefined; }
    const { results } = (await res.json()) as { results?: UnsplashPhoto[] };
    const p = (results ?? []).find((r) => !used.has(r.urls.regular));
    if (!p) return undefined;
    used.add(p.urls.regular);
    return {
      url: p.urls.regular, alt: (p.alt_description || p.description || q).slice(0, 200),
      credit: p.user.name, credit_url: `${p.user.links.html}?${UTM}`, download_location: p.links.download_location, source: "unsplash"
    };
  } catch { return undefined; }
}

/** Unsplash asks apps to report when a photo is actually used (added to a lesson, or downloaded). */
export async function reportPhotoUse(locations: string[]) {
  const key = process.env.UNSPLASH_ACCESS_KEY?.trim();
  if (!key) return;
  await Promise.all(locations.filter((l) => /^https:\/\/api\.unsplash\.com\/photos\/[\w-]+\/download(\?[\w=&%.-]*)?$/.test(l)).slice(0, 30)
    .map((l) => fetch(l, { headers: { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" }, signal: AbortSignal.timeout(8000) }).catch(() => undefined)));
}
