"use client";
import { useState } from "react";
import { useApi, send, Alert, Badge, Loading, Empty, fmtDate } from "@/components/ui";

type Row = { user_id: string; email: string; full_name: string; kind: string; detail: string | null; school: string | null;
  created_at: string; last_sent_at: string | null; sent_count: number; confirmed_at: string | null; confirmed_how: string | null };
type Data = { email_ready: boolean; can_act?: boolean; waiting: Row[]; confirmed: Row[] };

const KIND: Record<string, string> = { school: "New school", student: "Student", parent: "Parent", staff: "Staff", member: "Member" };
const HOW: Record<string, string> = { email: "by email link", school_admin: "by the school", platform: "by Synergy Swift" };

/** New accounts waiting to be confirmed, with Confirm / Send again / Remove. Shared by the platform console and the school. */
export default function SignupsTable({ api, platform = false }: { api: string; platform?: boolean }) {
  const { data, error, reload } = useApi<Data>(api);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const canAct = data.can_act !== false;

  async function act(r: Row, action: "confirm" | "resend" | "remove") {
    if (action === "remove" && !confirm(`Remove the account for ${r.email}? They can sign up again later.`)) return;
    setBusy(r.user_id + action);
    const res = await send(api, { action, user_id: r.user_id });
    setBusy(null);
    const done = { confirm: `${r.email} is confirmed and can sign in now.`, resend: `A new link is on its way to ${r.email}.`, remove: `The account for ${r.email} was removed.` }[action];
    setMsg({ ok: res.ok, text: res.ok ? done : res.error ?? "failed" });
    reload();
  }

  return (
    <div className="space-y-6">
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      {!data.email_ready && (
        <Alert tone="amber">No email service is set up yet, so new accounts get no confirmation email. Confirm them here.{platform ? " To send emails, set EMAIL_PROVIDER=sendgrid, SENDGRID_API_KEY and EMAIL_FROM on Render." : ""}</Alert>
      )}
      {!canAct && <Alert tone="amber">Your platform role can only view sign-ups.</Alert>}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Waiting to be confirmed ({data.waiting.length})</h2>
        {!data.waiting.length ? <Empty>Nobody is waiting.</Empty> : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="p-2">Person</th><th className="p-2">Signing up as</th><th className="p-2">Signed up</th><th className="p-2">Email</th><th className="p-2" /></tr></thead>
              <tbody className="divide-y divide-slate-100">{data.waiting.map(r => (
                <tr key={r.user_id}>
                  <td className="p-2"><span className="font-medium">{r.full_name || "—"}</span><span className="block text-xs text-slate-500">{r.email}</span></td>
                  <td className="p-2"><Badge tone={r.kind === "school" ? "violet" : "blue"}>{KIND[r.kind] ?? r.kind}</Badge>
                    {platform && <span className="block text-xs text-slate-500">{r.kind === "school" ? r.detail : r.school}</span>}</td>
                  <td className="p-2 text-xs">{fmtDate(r.created_at, true)}</td>
                  <td className="p-2 text-xs text-slate-600">{r.sent_count ? `Sent ${r.sent_count}×, last ${fmtDate(r.last_sent_at, true)}` : "Not sent"}</td>
                  <td className="whitespace-nowrap p-2 text-right">{canAct && <div className="flex justify-end gap-2">
                    <button className="btn btn-primary btn-sm" disabled={busy !== null} onClick={() => act(r, "confirm")}>{busy === r.user_id + "confirm" ? "Confirming…" : "Confirm"}</button>
                    {data.email_ready && <button className="btn btn-outline btn-sm" disabled={busy !== null} onClick={() => act(r, "resend")}>Send again</button>}
                    <button className="text-xs text-rose-700 underline" disabled={busy !== null} onClick={() => act(r, "remove")}>Remove</button>
                  </div>}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </section>
      {data.confirmed.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Recently confirmed</h2>
          <div className="card divide-y divide-slate-100 text-sm">{data.confirmed.map(r => (
            <div key={r.user_id} className="flex flex-wrap items-center justify-between gap-2 p-2">
              <span><span className="font-medium">{r.full_name || r.email}</span> <span className="text-xs text-slate-500">{r.email}</span></span>
              <span className="text-xs text-slate-500">{KIND[r.kind] ?? r.kind}, confirmed {HOW[r.confirmed_how ?? ""] ?? ""} {fmtDate(r.confirmed_at, true)}</span>
            </div>))}</div>
        </section>
      )}
    </div>
  );
}
