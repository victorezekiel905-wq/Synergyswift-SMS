import { notFound } from "next/navigation";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyCard } from "@/lib/report-sign";
import ReportCardView from "@/components/results/ReportCardView";
import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Report card", robots: { index: false, follow: false } };

/**
 * Public, printable report card reached from the parent's WhatsApp / email
 * link or the QR code on a printed card. The 48-hex token is the only key;
 * only PUBLISHED cards of ACTIVE schools render. Staff can preview drafts
 * while signed in via the same URL. Published cards show whether their
 * figures still match the school's signature.
 */
export default async function ReportCardPage(props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  if (!/^[0-9a-f]{32,128}$/i.test(params.token)) notFound();
  const svc = createServiceClient();
  const { data: card } = await svc.from("report_cards")
    .select("*,tenants(status,name),students(first_name,last_name,other_names,admission_no,photo_url,gender,date_of_birth)")
    .eq("access_token", params.token).maybeSingle();
  if (!card || card.tenants?.status !== "active") notFound();

  if (card.status !== "published") {
    // Drafts are only visible to signed-in staff of the same school.
    const { createClient } = await import("@/lib/supabase/server");
    const sb = await createClient();
    const { data: { user } } = await sb.auth.getUser();
    const { data: me } = user ? await sb.from("users").select("tenant_id,role").eq("id", user.id).maybeSingle() : { data: null };
    if (!me || me.tenant_id !== card.tenant_id || ["student", "parent"].includes(me.role)) notFound();
  }
  const { data: school } = await svc.from("tenant_settings").select("*").eq("tenant_id", card.tenant_id).maybeSingle();
  const h = await headers();
  const env = process.env.NEXT_PUBLIC_APP_URL;
  const origin = env && !env.includes("localhost") ? env.replace(/\/$/, "") : `${h.get("x-forwarded-proto")?.split(",")[0] ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;

  return (
    <main>
      {card.status === "published" && verifyCard(card) === "valid" && (
        <p className="mx-auto mt-4 max-w-4xl rounded bg-emerald-50 p-2 text-center text-xs font-semibold text-emerald-800 print:hidden">✓ Genuine: these figures match the copy {card.tenants?.name} signed on {new Date(card.signed_at ?? card.published_at).toLocaleDateString(undefined, { dateStyle: "long" })}.</p>
      )}
      <ReportCardView card={card} school={school} studentPhoto={card.students?.photo_url} tenantName={card.tenants?.name}
        verifyUrl={`${origin}/r/${card.access_token}`} verification={card.status === "published" ? verifyCard(card) : null} />
      <div className="mb-8 mt-2 text-center print:hidden"><PrintButton /></div>
    </main>
  );
}
