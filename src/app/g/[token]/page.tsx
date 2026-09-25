"use client";
import GuardianPortal, { postTo } from "@/components/parent/GuardianPortal";

/** Passwordless guardian portal opened from the WhatsApp / email link. */
export default function TokenPortal({ params }: { params: { token: string } }) {
  return (
    <main className="min-h-screen bg-slate-50">
      <GuardianPortal mode="token" api={`/api/g/${params.token}`} act={(b) => postTo(`/api/g/${params.token}`, b)} />
    </main>
  );
}
