"use client";;
import { use } from "react";
import GuardianPortal, { postTo } from "@/components/parent/GuardianPortal";

/** Passwordless guardian portal opened from the WhatsApp / email link. */
export default function TokenPortal(props: { params: Promise<{ token: string }> }) {
  const params = use(props.params);
  return (
    <main className="min-h-screen bg-slate-50">
      <GuardianPortal mode="token" token={params.token} api={`/api/g/${params.token}`} act={(b) => postTo(`/api/g/${params.token}`, b)} />
    </main>
  );
}
