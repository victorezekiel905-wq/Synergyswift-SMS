"use client";
import { useState } from "react";
import { useApi, money } from "@/components/ui";

const KIND: Record<string, string> = { fee_discount: "off your fees", wallet_credit: "wallet credit", gift: "gift", cash: "cash" };

/** "Recommend the school": the parent's personal referral link. Hidden when the school has no public admissions page. */
export default function ReferralCard() {
  const { data } = useApi<{ code: string; link: string | null; referred: number; enrolled: number; currency: string; rewards: { kind: string; amount: number; status: string }[]; offer: { kind: string; amount: number } | null }>("/api/parent/referral");
  const [copied, setCopied] = useState(false);
  if (!data?.link) return null;
  const text = `I recommend my children's school. Ask about admission here: ${data.link}`;
  return (
    <section className="card mb-6 p-4 text-sm">
      <h2 className="font-semibold">Recommend the school</h2>
      <p className="text-slate-600">Share your personal link with friends and family. When they enquire through it, the school knows you referred them.{data.offer ? ` When a family you referred enrols, you receive ${money(data.offer.amount, data.currency)} ${KIND[data.offer.kind] ?? ""}.` : ""}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="flex-1 truncate rounded bg-slate-50 px-2 py-1 text-xs">{data.link}</code>
        <button className="btn btn-outline px-3 py-1 text-xs" onClick={() => { navigator.clipboard?.writeText(data.link!); setCopied(true); }}>{copied ? "Copied" : "Copy"}</button>
        <a className="btn btn-success px-3 py-1 text-xs" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">Share on WhatsApp</a>
      </div>
      {data.referred > 0 && <p className="mt-2 text-xs text-slate-500">You have referred {data.referred} famil{data.referred === 1 ? "y" : "ies"}{data.enrolled ? `; ${data.enrolled} enrolled` : ""}. Thank you!</p>}
      {data.rewards.length > 0 && <p className="mt-1 text-xs text-emerald-700">Rewards: {data.rewards.map(r => `${money(r.amount, data.currency)} ${KIND[r.kind] ?? r.kind} (${r.status === "issued" ? "given" : "on its way"})`).join(" · ")}</p>}
    </section>
  );
}
