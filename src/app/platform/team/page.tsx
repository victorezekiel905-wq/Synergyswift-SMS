"use client";
import { useState } from "react";
import { useApi, send, Page, PageHeader, Alert, Badge, Field, Loading, fmtDate } from "@/components/ui";
import PlatformNav from "@/components/platform/PlatformNav";

type Admin = { user_id: string; role: "owner" | "admin" | "support"; email: string | null; created_at: string };
const ROLE_TEXT: Record<string, string> = {
  owner: "Everything, including deleting schools and choosing the platform team",
  admin: "Create, change, pause and bill schools; answer requests",
  support: "Look only: schools, billing and history, without changing anything"
};

/** Who runs Synergy Swift itself. Only the owner changes this list. */
export default function TeamPage() {
  const { data, reload } = useApi<{ admins: Admin[]; me: string; my_role: string }>("/api/platform/admins");
  const [f, setF] = useState({ email: "", role: "admin" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!data) return <Page wide><PlatformNav /><Loading /></Page>;
  const owner = data.my_role === "owner";
  const act = async (body: Record<string, unknown>, ok: string, method = "PATCH") => {
    const r = await send("/api/platform/admins", body, method);
    setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" });
    if (r.ok) reload();
  };
  return (
    <Page wide>
      <PlatformNav />
      <PageHeader eyebrow="Synergy Swift platform" title="Platform team" subtitle="People with access to every school's platform settings. School staff never appear here and never see this console." />
      {msg && <div className="mb-4"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      <section className="card mb-5 p-5">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">Email</th><th>Role</th><th>Can</th><th>Since</th><th /></tr></thead>
          <tbody>
            {data.admins.map(a => (
              <tr key={a.user_id} className="border-t border-slate-100">
                <td className="py-2">{a.email ?? a.user_id}{a.user_id === data.me && <span className="ml-1 text-xs text-slate-500">(you)</span>}</td>
                <td>{owner && a.role !== "owner" && a.user_id !== data.me
                  ? <select className="input w-28 py-1" value={a.role} onChange={e => act({ user_id: a.user_id, role: e.target.value }, "Role changed")}><option value="admin">Admin</option><option value="support">Support</option></select>
                  : <Badge tone={a.role === "owner" ? "blue" : a.role === "admin" ? "green" : "slate"}>{a.role}</Badge>}</td>
                <td className="text-xs text-slate-600">{ROLE_TEXT[a.role]}</td>
                <td className="text-slate-500">{fmtDate(a.created_at)}</td>
                <td className="text-right">{owner && a.role !== "owner" && a.user_id !== data.me && <button className="btn btn-ghost px-2 py-1 text-xs text-rose-700" onClick={() => act({ user_id: a.user_id, remove: true }, "Access removed")}>Remove</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {owner ? (
        <section className="card grid gap-3 p-5 sm:grid-cols-[1fr_160px_auto] sm:items-end">
          <Field label="Add someone by email" hint="New people get an invitation to set a password. Use an email that is not a school account."><input className="input" type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Role"><select className="input" value={f.role} onChange={e => setF({ ...f, role: e.target.value })}><option value="admin">Admin</option><option value="support">Support</option></select></Field>
          <button className="btn btn-primary" onClick={() => act(f, `${f.email} added`, "POST")}>Add</button>
        </section>
      ) : <p className="text-sm text-slate-600">Only the platform owner adds or removes people.</p>}
    </Page>
  );
}
