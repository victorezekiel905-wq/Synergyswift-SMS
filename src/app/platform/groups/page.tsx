"use client";
import { useState } from "react";
import Link from "next/link";
import { useApi, send, Page, PageHeader, Alert, Empty, Field } from "@/components/ui";

type Data = { groups: { id: string; name: string; admins: { user_id: string; email: string }[]; schools: { id: string; name: string }[] }[]; tenants: { id: string; name: string; group_id: string | null }[] };

/** Platform: school groups for proprietors who own several branches. */
export default function PlatformGroups() {
  const { data, error, reload } = useApi<Data>("/api/platform/groups");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const act = async (body: Record<string, unknown>, ok: string) => { const r = await send("/api/platform/groups", body); setMsg({ ok: r.ok, text: r.ok ? ok + (r.data?.action_link ? ` Sign-in link: ${r.data.action_link}` : "") : r.error ?? "failed" }); if (r.ok) reload(); };
  return (
    <Page wide>
      <Link href="/platform" className="text-sm text-brand-700 hover:underline">← Schools</Link>
      <PageHeader title="School groups" subtitle="Group branches owned by one proprietor. Group admins see their own schools side by side and nothing else; schools still cannot see each other." />
      {error && <Alert>{error}</Alert>}
      {msg && <div className="mb-3 break-all"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      <form className="card mb-5 flex gap-2 p-4" onSubmit={e => { e.preventDefault(); act({ action: "create", name }, "Group created."); setName(""); }}>
        <input className="input" placeholder="Group name, e.g. Green Hills Schools" required value={name} onChange={e => setName(e.target.value)} aria-label="Group name" />
        <button className="btn btn-primary">Create group</button>
      </form>
      {!data?.groups.length ? <Empty>No groups yet.</Empty> : data.groups.map(g => (
        <section key={g.id} className="card mb-4 p-5">
          <h2 className="mb-2 font-semibold">{g.name}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="label">Schools</p>
              <ul className="mb-2 space-y-1 text-sm">{g.schools.map(s => <li key={s.id} className="flex justify-between">{s.name}<button className="text-xs text-rose-600" onClick={() => act({ action: "assign", tenant_id: s.id, group_id: null }, "Removed.")}>Remove</button></li>)}</ul>
              <select className="input" value="" onChange={e => e.target.value && act({ action: "assign", tenant_id: e.target.value, group_id: g.id }, "School added.")} aria-label="Add school">
                <option value="">Add a school…</option>{(data.tenants ?? []).filter(t => t.group_id !== g.id).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <p className="label">Group admins (proprietors)</p>
              <ul className="mb-2 space-y-1 text-sm">{g.admins.map(a => <li key={a.user_id} className="flex justify-between">{a.email}<button className="text-xs text-rose-600" onClick={() => act({ action: "remove_admin", group_id: g.id, user_id: a.user_id }, "Removed.")}>Remove</button></li>)}</ul>
              <form className="flex gap-2" onSubmit={e => { e.preventDefault(); const em = (e.currentTarget.elements.namedItem("email") as HTMLInputElement).value; act({ action: "add_admin", group_id: g.id, email: em }, "Admin added."); e.currentTarget.reset(); }}>
                <Field label=""><input name="email" className="input" type="email" placeholder="proprietor@email.com" required /></Field>
                <button className="btn btn-ghost border border-slate-200">Add</button>
              </form>
            </div>
          </div>
        </section>
      ))}
    </Page>
  );
}
