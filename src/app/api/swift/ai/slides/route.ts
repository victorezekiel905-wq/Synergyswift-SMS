import { fail, ok, readJson, requireProfile, withErrorLog } from "@/live/lib/api";
import { AI_IMAGES_PER_DECK, aiImagesConfigured, aiPictureFor, findPhotoFor, outlineSlides, photosConfigured, SlidesUnavailable } from "@/live/lib/ai-slides";
import { allowShared } from "@/live/lib/rate-limit";
import { TEACHERS } from "@/live/lib/session";
import { buildDeck, THEMES, tidyOutline, type ThemeKey } from "@/live/slides/ai-deck";

export const maxDuration = 240;

/**
 * "Create slides with AI": a topic (and optionally the teacher's notes) in, designed
 * slides out, for the teacher to check. Nothing is saved here: the page adds them to
 * a lesson, or downloads them, when the teacher chooses.
 */
export const POST = withErrorLog(async function POST(req: Request) {
  const { me, response } = await requireProfile(TEACHERS);
  if (response) return response;
  if (!(await allowShared(`ai-s:${me.id}`, 4)) || !(await allowShared(`ai-s-school:${me.tenant_id}`, 30))) {
    return fail(429, "You've made a lot of slides in a short time. Wait a minute and try again.");
  }
  const body = await readJson<{ topic?: string; level?: string; subject?: string; count?: number; notes?: string; pictures?: boolean; theme?: string }>(req, 200_000);
  const topic = body?.topic?.trim().slice(0, 200);
  if (!topic) return fail(400, "Type what the lesson is about.");
  const count = Math.min(15, Math.max(4, Math.round(Number(body?.count) || 8)));
  const theme: ThemeKey = body?.theme && body.theme in THEMES ? (body.theme as ThemeKey) : "swift";
  // Making the pictures can take a while (several searches, and AI pictures): allowed up to 4 minutes.
  const pictures = body?.pictures !== false && (photosConfigured() || aiImagesConfigured());
  try {
    const outline = tidyOutline(await outlineSlides({
      topic, count, pictures, tenantId: me.tenant_id, userId: me.id,
      level: body?.level?.trim().slice(0, 60) || "a secondary school class",
      subject: body?.subject?.trim().slice(0, 60) || undefined,
      notes: body?.notes?.trim().slice(0, 30_000) || undefined
    }), count);
    // Pictures one after another, so no two slides get the same one; each must show what its slide is
    // about (a picture made by AI when no stock photo fits, a few per deck at most).
    const used = new Set<string>();
    const owner = { tenantId: me.tenant_id, userId: me.id };
    const lesson = { topic, level: body?.level?.trim().slice(0, 60) || "a secondary school class", subject: body?.subject?.trim().slice(0, 60) || undefined };
    const wants = (s: (typeof outline.slides)[number]) => pictures && !!(s.image_query || s.image_subject) && ["title", "picture", "big_picture"].includes(s.layout);
    // Stock photos first (each checked against its slide)…
    const photos: (Awaited<ReturnType<typeof findPhotoFor>>)[] = [];
    for (const s of outline.slides) photos.push(wants(s) ? await findPhotoFor(s, used, owner, lesson, { ai: 0 }) : undefined);
    // …then AI pictures for the slides no stock photo fits, made at the same time (picture slides first, a few per deck).
    const missing = outline.slides.map((s, i) => ({ s, i })).filter(({ s, i }) => wants(s) && !photos[i])
      .sort((a, b) => Number(a.s.layout === "title") - Number(b.s.layout === "title")).slice(0, aiImagesConfigured() ? AI_IMAGES_PER_DECK : 0);
    const made = await Promise.all(missing.map(({ s }) => aiPictureFor(s, lesson, owner)));
    missing.forEach(({ i }, k) => { photos[i] = made[k]; });
    return ok({ title: outline.title, slides: buildDeck(outline, photos, theme), pictures });
  } catch (e) {
    if (e instanceof SlidesUnavailable) return fail(503, e.message);
    throw e;
  }
});
