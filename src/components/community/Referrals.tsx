"use client";
import { useState } from "react";
import { useApi, send, Alert, Badge, Empty, Field, Loading, Stat, fmtDate, money, statusTone } from "@/components/ui";

type Data = {
  items: { id: string; kind: string; amount: number; status: string; note: string | null; created_at: string; issued_at: string | null;
    guardians: { id: string; full_name: string; phone: string | null } | null; admission_leads: { parent_name: string; child_name: string | null; stage: string } | null }[];
  settings: { kind: string; amount: number }; currency: string;
  top: { id: string; name: string; referred: number; enrolled: number }[]; totals: { referred: number; enrolled: number };
};
const KIND_LABEL: Record<string, string> = { fee_discount: "Fee discount", wallet_credit: "Wallet credit", gift: "Gift", cash: "Cash" };

/** Rewards for families whose referrals enrol: the standard reward, approval and issue, and the top referrers. */
export default function Referrals({ admin }: { admin: boolean }) {
  const { data, error, reload } = useApi<Data>("/api/community/referrals");
  const [s, setS] = useState<{ kind: string; amount: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const set = s ?? { kind: data.settings.kind, amount: String(data.settings.amount) };
  const act = async (body: Record<string, unknown>, ok: string) => {
    const r = await send("/api/community/referrals", body);
    setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" });
    reload();
  };
  const owed = data.items.filter(i => ["pending", "approved"].includes(i.status));
  return (
    <div className="space-y-4 text-sm">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Families referred" value={data.totals.referred} />
        <Stat label="Referrals enrolled" value={data.totals.enrolled} tone="good" />
        <Stat label="Rewards to give" value={owed.length} hint={money(owed.reduce((a, i) => a + Number(i.amount), 0), data.currency)} tone={owed.length ? "warn" : undefined} />
        <Stat label="Rewards given" value={data.items.filter(i => i.status === "issued").length} />
      </div>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <form className="card flex flex-wrap items-end gap-3 p-4" onSubmit={e => { e.preventDefault(); act({ action: "settings", kind: set.kind, amount: Number(set.amount) || 0 }, "Saved. New enrolments from referrals earn this reward."); }}>
        <p className="w-full text-slate-600">When a family that came through a parent&apos;s referral link enrols, that parent earns this reward automatically. Set 0 to turn rewards off.</p>
        <Field label="Reward"><select className="input" value={set.kind} disabled={!admin} onChange={e => setS({ ...set, kind: e.target.value })}>{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label={`Value (${data.currency})`}><input className="input w-40" type="number" min={0} value={set.amount} disabled={!admin} onChange={e => setS({ ...set, amount: e.target.value })} /></Field>
        {admin && <button className="btn btn-primary">Save</button>}
      </form>
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <h3 className="mb-2 font-semibold">Rewards</h3>
          {!data.items.length ? <Empty>No rewards yet.</Empty> : (
            <ul className="card divide-y divide-slate-100">{data.items.map(i => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 p-3">
                <span className="min-w-48 flex-1"><b>{i.guardians?.full_name ?? "Family"}</b> <span className="text-xs text-slate-500">{i.guardians?.phone ?? ""}</span>
                  <span className="block text-xs text-slate-500">{i.admission_leads ? `for referring ${i.admission_leads.parent_name}${i.admission_leads.child_name ? ` (${i.admission_leads.child_name})` : ""}` : i.note ?? "added by staff"} · {fmtDate(i.created_at)}</span></span>
                <span>{KIND_LABEL[i.kind]} {Number(i.amount) ? money(i.amount, data.currency) : ""}</span>
                <Badge tone={statusTone(i.status === "issued" ? "approved" : i.status)}>{i.status}</Badge>
                {i.status === "pending" && <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => act({ action: "status", id: i.id, status: "approved" }, "Approved.")}>Approve</button>}
                {["pending", "approved"].includes(i.status) && <button className="btn btn-success px-2 py-1 text-xs" onClick={() => act({ action: "status", id: i.id, status: "issued" }, "Marked as given.")}>Mark given</button>}
                {["pending", "approved"].includes(i.status) && <button className="btn btn-outline px-2 py-1 text-xs text-rose-700" onClick={() => { if (confirm("Cancel this reward?")) act({ action: "status", id: i.id, status: "cancelled" }, "Cancelled."); }}>Cancel</button>}
              </li>
            ))}</ul>
          )}
          <p className="mt-2 text-xs text-slate-500">Fee discounts are applied by the bursar on the family&apos;s next invoice; mark the reward as given once done.</p>
        </section>
        <section>
          <h3 className="mb-2 font-semibold">Top referrers</h3>
          {!data.top.length ? <Empty>No referrals yet. Parents find their link on their portal.</Empty> : (
            <ol className="card divide-y divide-slate-100">{data.top.map((t, i) => <li key={t.id} className="flex justify-between p-2"><span>{i + 1}. {t.name}</span><span className="text-xs">{t.enrolled} enrolled / {t.referred}</span></li>)}</ol>
          )}
        </section>
      </div>
    </div>
  );
}
