import Link from "next/link";
import { PageHeader } from "@/live/components/ui";
import { AiSlides } from "@/live/components/studio/AiSlides";
import { requireRole, TEACHERS } from "@/live/lib/session";

export const metadata = { title: "Create slides with AI" };

/** A new lesson from a topic: AI plans the slides, with photos, in a lesson theme. */
export default async function AiSlidesPage() {
  await requireRole(TEACHERS);
  return (
    <div className="page max-w-5xl">
      <p className="mb-2 text-sm"><Link href="/live/teacher/lessons">← Lessons</Link></p>
      <PageHeader eyebrow="Live lessons" title="Create slides with AI" subtitle="Say what the lesson is about. You check the slides before anything is saved." />
      <div className="card card-pad"><AiSlides /></div>
    </div>
  );
}
