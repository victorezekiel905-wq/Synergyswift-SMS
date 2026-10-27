import { requireRole } from "@/live/lib/session";
import { PageHeader } from "@/live/components/ui";
import { CharacterCollection } from "./CharacterCollection";

export const metadata = { title: "My characters" };

export default async function Characters() {
  await requireRole(["student"]);
  return (
    <div className="page max-w-4xl">
      <PageHeader eyebrow="Live lessons" title="My characters" subtitle="Every right answer in lessons and games earns XP. XP unlocks new characters to play as." />
      <CharacterCollection />
    </div>
  );
}
