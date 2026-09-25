import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import GamePlayer from "@/components/game/GamePlayer";

export default async function StudentGame(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  return <GamePlayer gameId={params.id} />;
}
