import { requireRole, TEACHERS } from "@/live/lib/session";
import { PageHeader } from "@/live/components/ui";
import { NewGameForm } from "./NewGameForm";

export const metadata = { title: "New game" };

export default async function NewGame(
  props: { searchParams: Promise<{ class?: string; activity?: string; session?: string }> }
) {
  const searchParams = await props.searchParams;
  const { sb } = await requireRole(TEACHERS);
  const [{ data: classes }, { data: activities }] = await Promise.all([
    sb.rpc("my_teaching_classes"),
    sb.from("activities").select("id,title,kind,lessons(title),questions(count)").in("kind", ["quiz", "multiple_choice"]).order("updated_at", { ascending: false }).limit(200)
  ]);
  return (
    <div className="page max-w-3xl">
      <PageHeader eyebrow="Quiz games" title="New game" subtitle="Choice, true/false, gap-fill, matching, ordering and sorting questions are played; questions a teacher marks by hand are skipped." />
      <NewGameForm classes={(classes as { id: string; name: string }[]) ?? []} activities={(activities ?? []) as never}
        defaults={{ classId: searchParams.class, activityId: searchParams.activity, sessionId: searchParams.session }} />
    </div>
  );
}
