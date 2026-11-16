import "server-only";
import { DECK_LAYOUTS, type Outline, type OutlineSlide, type Photo } from "@/live/slides/ai-deck";
import { bestMatch, pictureNeed, type PictureNeed } from "@/live/slides/photo-match";
import { createHash } from "crypto";
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
- Pictures, for picture, big_picture and (optionally) title layouts. The picture must show exactly what that slide teaches, so a student looking at it learns from it:
  image_subject: the one concrete, visible thing the picture must show, in 1 to 4 plain words, e.g. "plant leaf" for photosynthesis, "volcano eruption", "human heart", "Nigerian naira notes", "solar panels on a roof". Name the actual object, living thing, place or process, never an abstract idea ("success", "learning", "science").
  image_query: 2 to 4 words to search a stock photo site for that subject, most specific first, e.g. "green leaf sunlight".
  image_queries: 2 more searches for the same subject, a little broader each time, e.g. ["leaf close up", "green plant"].
  Never ask for diagrams, text, charts, logos or famous people. Leave all three empty on other layouts.
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
  image_queries: z.array(z.string()).optional(),
  image_subject: z.string().optional(),
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
export async function findPhoto(query: string, used: Set<string>, owner?: { tenantId: string; userId: string }, need?: PictureNeed): Promise<Photo | undefined> {
  if (process.env.PIXABAY_API_KEY?.trim() && owner) {
    const p = await pixabayPhoto(query, used, owner, need);
    if (p) return p;
  }
  return unsplashPhoto(query, used, need);
}

/** Pictures the AI may make for one deck when no stock photo fits (they cost money). */
export const AI_IMAGES_PER_DECK = 4;
/** Making pictures with AI: OpenAI's image model (OPENAI_API_KEY), unless AI_SLIDE_IMAGES=off. */
export const aiImagesConfigured = () => Boolean(openAiKey()) && (process.env.AI_SLIDE_IMAGES ?? "").trim().toLowerCase() !== "off";
function openAiKey(): string | undefined {
  for (const [k, v] of Object.entries(process.env)) if (v?.trim() && ["OPENAIAPIKEY", "OPENAIKEY", "OPENAIAPI"].includes(k.toUpperCase().replace(/[^A-Z0-9]/g, ""))) return v.trim();
  return undefined;
}

/**
 * The picture for one slide, that really shows what the slide is about: each search the AI gave
 * (most specific first) on Pixabay and Unsplash, keeping only a photo whose own tags or description
 * name the subject; when none fits, a picture made by AI (within the deck's allowance); else none,
 * and the slide is laid out without one. Never throws.
 */
export async function findPhotoFor(s: OutlineSlide, used: Set<string>, owner: { tenantId: string; userId: string },
  lesson: { topic: string; level: string; subject?: string }, allowance: { ai: number }): Promise<Photo | undefined> {
  const queries = [...new Set([s.image_query, ...(s.image_queries ?? [])].map(q => (q ?? "").trim()).filter(Boolean))].slice(0, 3);
  if (!queries.length && !s.image_subject?.trim()) return undefined;
  const need = pictureNeed({ subject: s.image_subject, queries, heading: s.heading });
  for (const q of queries) {
    const p = await findPhoto(q, used, owner, need);
    if (p) return p;
  }
  if (allowance.ai > 0 && aiImagesConfigured()) {
    allowance.ai--;
    return aiPicture(s.image_subject?.trim() || queries[0] || s.heading, lesson, owner);
  }
  return undefined;
}

/** An AI picture for a slide (what it must show, else its search words, else its heading). */
export function aiPictureFor(s: OutlineSlide, lesson: { topic: string; level: string; subject?: string }, owner: { tenantId: string; userId: string }) {
  const subject = s.image_subject?.trim() || s.image_query?.trim() || s.heading;
  return aiPicture(subject, lesson, owner);
}

/**
 * A picture made by OpenAI's image model for a slide no stock photo fits: realistic, clear, no
 * words in it (image models misspell them). Stored in the school's lesson media like a Pixabay photo.
 */
async function aiPicture(subject: string, lesson: { topic: string; level: string; subject?: string }, owner: { tenantId: string; userId: string }): Promise<Photo | undefined> {
  const key = openAiKey();
  if (!key) return undefined;
  const model = process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-1";
  const prompt = `A clear, realistic, well-lit educational picture showing ${subject}, for a ${lesson.level}${lesson.subject ? ` ${lesson.subject}` : ""} lesson about "${lesson.topic}". ` +
    "Accurate to the real thing, natural colours, simple uncluttered background, suitable for school children, landscape. Absolutely no text, letters, numbers, labels, captions, logos or watermarks.";
  try {
    const dalle = /^dall-e/i.test(model);
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(90_000),
      body: JSON.stringify({ model, prompt: prompt.slice(0, 3800), n: 1, size: dalle ? "1792x1024" : "1536x1024", ...(dalle ? { response_format: "b64_json" } : {}) })
    });
    if (!res.ok) { console.error("[ai-slides] OpenAI image", res.status, (await res.text().catch(() => "")).slice(0, 200)); return undefined; }
    const j = (await res.json()) as { data?: { b64_json?: string }[] };
    const b64 = j.data?.[0]?.b64_json;
    if (!b64) return undefined;
    const bytes = new Uint8Array(Buffer.from(b64, "base64"));
    if (bytes.byteLength > 12_000_000) return undefined;
    const { createServiceClient } = await import("@/live/lib/supabase/service");
    const svc = createServiceClient();
    const path = `${owner.tenantId}/${owner.userId}/ai-${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.png`;
    const { error } = await svc.storage.from("live-lesson-media").upload(path, bytes, { contentType: "image/png", upsert: true });
    if (error) { console.error("[ai-slides] AI picture copy", error.message); return undefined; }
    const alt = subject.slice(0, 200);
    await svc.from("lesson_media").insert({ tenant_id: owner.tenantId, owner_id: owner.userId, storage_path: path, kind: "image", mime_type: "image/png",
      bytes: bytes.byteLength, title: `${subject} (AI-generated)`.slice(0, 200), alt_text: alt, tags: ["ai image", "ai slides"] }).then(() => null, () => null);
    return { url: "", media_path: path, alt, credit: "AI", credit_url: "", download_location: "", source: "ai" };
  } catch (e) { console.error("[ai-slides] AI picture", (e as Error).message); return undefined; }
}

type PixabayHit = { id: number; pageURL: string; tags: string; webformatURL: string; largeImageURL: string; user: string; imageWidth: number; imageHeight: number };
// Pixabay asks for search results to be cached for 24 hours.
const pixabayCache = new Map<string, { at: number; hits: PixabayHit[] }>();

export async function pixabaySearch(q: string): Promise<PixabayHit[]> {
  const hit = pixabayCache.get(q);
  if (hit && Date.now() - hit.at < 24 * 3600_000) return hit.hits;
  const url = `https://pixabay.com/api/?key=${encodeURIComponent(process.env.PIXABAY_API_KEY!.trim())}&q=${encodeURIComponent(q.slice(0, 100))}&image_type=photo&orientation=horizontal&safesearch=true&per_page=20&order=popular`;
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
async function pixabayPhoto(query: string, used: Set<string>, owner: { tenantId: string; userId: string }, need?: PictureNeed): Promise<Photo | undefined> {
  const q = query.trim();
  if (!q) return undefined;
  try {
    // Only a photo whose own tags name what the slide must show (when that is known).
    const fresh = (await pixabaySearch(q)).filter(h => !used.has(`pixabay:${h.id}`));
    const p = need ? bestMatch(need, fresh, h => h.tags) : fresh[0];
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

async function unsplashPhoto(query: string, used: Set<string>, need?: PictureNeed): Promise<Photo | undefined> {
  const key = process.env.UNSPLASH_ACCESS_KEY?.trim();
  const q = query.trim().slice(0, 80);
  if (!key || !q) return undefined;
  try {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=12&orientation=landscape&content_filter=high`;
    const res = await fetch(url, { headers: { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) { console.error("[ai-slides] Unsplash", res.status); return undefined; }
    const { results } = (await res.json()) as { results?: UnsplashPhoto[] };
    // Only a photo whose own description names what the slide must show (when that is known).
    const fresh = (results ?? []).filter((r) => !used.has(r.urls.regular));
    const p = need ? bestMatch(need, fresh, (r) => `${r.alt_description ?? ""} ${r.description ?? ""}`) : fresh[0];
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
