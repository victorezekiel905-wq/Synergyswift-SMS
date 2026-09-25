import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import WebRtcMesh from "@/components/live/WebRtcMesh";

export default async function StudentWebRtcPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/student/join");

  const { data: session } = await sb.from("class_sessions").select("id").eq("id", params.id).maybeSingle();
  if (!session) return <main className="mx-auto max-w-3xl px-6 py-12">Session not found.</main>;

  return (
    <WebRtcMesh
      sessionId={session.id}
      roleLabel="student"
      canHost={false}
      backHref={`/student/live/${session.id}`}
      backLabel="Back to class"
    />
  );
}
