"use client";
import { useState } from "react";
import { useApi, send, Page, PageHeader, Alert, Badge, Empty, Field, Loading, Modal, fmtDate } from "@/components/ui";

type Tool = { id: string; name: string; description: string | null; active: boolean; grades: boolean; client_id?: string; deployment_id?: string; oidc_login_url?: string; target_link_uri?: string;
  redirect_uris?: string[]; jwks_url?: string | null; public_key_pem?: string | null; custom?: Record<string, string>; send_name?: boolean; send_email?: boolean };
type Link = { id: string; title: string; tool_id: string; class_group_id: string | null; homework_id: string | null; score_maximum: number | null; created_by: string; created_at: string;
  lti_tools: { name: string } | null; class_groups: { name: string } | null; subjects: { name: string } | null; homework: { title: string } | null };
type Data = { admin: boolean; me: string; tools: Tool[]; links: Link[]; classes: { id: string; name: string }[]; subjects: { id: string; name: string }[];
  homework: { id: string; title: string; class_group_id: string; due_at: string }[]; platform: { issuer: string; auth_url: string; token_url: string; jwks_url: string } | null };

const lines = (s: string) => s.split(/\n/).map(x => x.trim()).filter(Boolean);
const toCustom = (s: string) => Object.fromEntries(lines(s).map(l => l.split("=")).filter(p => p.length >= 2 && p[0].trim()).map(([k, ...v]) => [k.trim(), v.join("=").trim()]));
const blankTool = { id: null as string | null, name: "", description: "", oidc_login_url: "", target_link_uri: "", redirect_uris: "", jwks_url: "", public_key_pem: "", custom: "", send_name: true, send_email: false, grades: true, active: true };

/** Outside learning tools (LTI 1.3): admins register them, teachers add them to classes and see the scores they send back. */
export default function ToolsPage() {
  const { data, error, reload } = useApi<Data>("/api/lti/manage");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [tool, setTool] = useState(blankTool);
  const [link, setLink] = useState({ tool_id: "", title: "", class_group_id: "", subject_id: "", homework_id: "", target_link_uri: "", score_maximum: "" });
  const [scoresFor, setScoresFor] = useState<Link | null>(null);
  const scores = useApi<{ scores: { student: string; score_given: number | null; score_maximum: number | null; grading_progress: string; received_at: string }[] }>(scoresFor ? `/api/lti/manage?link_id=${scoresFor.id}` : null);
  if (error) return <Page><Alert>{error}</Alert></Page>;
  if (!data) return <Page><Loading /></Page>;
  async function act(body: Record<string, unknown>, ok: string) {
    const r = await send("/api/lti/manage", body);
    setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" });
    if (r.ok) reload();
    return r;
  }
  const active = data.tools.filter(t => t.active);
  return (
    <Page wide>
      <PageHeader eyebrow="Teaching" title="Learning tools" subtitle="Outside tools (simulations, publisher content, practice sites) opened from the school system with no extra passwords, sending scores back (LTI 1.3)." />
      {msg && <div className="mb-4"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <section className="card space-y-3 p-4">
            <h2 className="font-semibold">Add a tool to a class</h2>
            {!active.length ? <p className="text-sm text-slate-500">No tools are registered yet{data.admin ? "; register one on the right." : ". Ask an admin to register one."}</p> : <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Tool"><select className="input" value={link.tool_id} onChange={e => setLink({ ...link, tool_id: e.target.value })}><option value="">Choose…</option>{active.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
                <Field label="Title students see"><input className="input" value={link.title} onChange={e => setLink({ ...link, title: e.target.value })} placeholder="e.g. Circuits lab" /></Field>
                <Field label="Class"><select className="input" value={link.class_group_id} onChange={e => setLink({ ...link, class_group_id: e.target.value, homework_id: "" })}><option value="">Everyone</option>{data.classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
                <Field label="Subject"><select className="input" value={link.subject_id} onChange={e => setLink({ ...link, subject_id: e.target.value })}><option value="">—</option>{data.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
                <Field label="Marks go to homework (optional)" hint="Final scores from the tool become the homework mark, unless you mark it yourself."><select className="input" value={link.homework_id} onChange={e => setLink({ ...link, homework_id: e.target.value })}><option value="">—</option>{data.homework.filter(h => !link.class_group_id || h.class_group_id === link.class_group_id).map(h => <option key={h.id} value={h.id}>{h.title} (due {fmtDate(h.due_at)})</option>)}</select></Field>
                <Field label="Exact page in the tool (optional)"><input className="input" value={link.target_link_uri} onChange={e => setLink({ ...link, target_link_uri: e.target.value })} placeholder="https://…" /></Field>
              </div>
              <button className="btn btn-primary" disabled={!link.tool_id || !link.title.trim()} onClick={async () => {
                const r = await act({ action: "add_link", tool_id: link.tool_id, title: link.title, class_group_id: link.class_group_id || null, subject_id: link.subject_id || null, homework_id: link.homework_id || null,
                  target_link_uri: link.target_link_uri || null, score_maximum: link.score_maximum ? Number(link.score_maximum) : null }, "Added. Students in the class see it on their page.");
                if (r.ok) setLink({ ...link, title: "", homework_id: "", target_link_uri: "" });
              }}>Add</button>
            </>}
          </section>
          <section>
            <h2 className="mb-2 font-semibold">Tools in classes</h2>
            {!data.links.length ? <Empty>None yet.</Empty> : (
              <ul className="space-y-2">{data.links.map(l => (
                <li key={l.id} className="card flex flex-wrap items-center gap-2 p-3 text-sm">
                  <span className="font-medium">{l.title}</span>
                  <span className="text-xs text-slate-500">{l.lti_tools?.name} · {l.class_groups?.name ?? "everyone"}{l.subjects ? ` · ${l.subjects.name}` : ""}{l.homework ? ` · marks to “${l.homework.title}”` : ""}</span>
                  <span className="ml-auto flex gap-3 text-xs">
                    <a className="text-brand-700 hover:underline" href={`/api/lti/launch/${l.id}`} target="_blank" rel="noreferrer">Open</a>
                    <button className="text-brand-700 hover:underline" onClick={() => setScoresFor(l)}>Scores</button>
                    {(l.created_by === data.me || data.admin) && <button className="text-rose-600 hover:underline" onClick={() => confirm("Remove this tool from the class?") && act({ action: "delete_link", id: l.id }, "Removed.")}>Remove</button>}
                  </span>
                </li>))}</ul>
            )}
          </section>
        </div>

        {data.admin && (
          <aside className="space-y-4">
            {data.platform && (
              <section className="card space-y-1 p-4 text-xs">
                <h2 className="mb-1 text-sm font-semibold">Give these to the tool’s makers</h2>
                <p><b>Issuer / platform ID:</b> <span className="break-all font-mono">{data.platform.issuer}</span></p>
                <p><b>Login (authorisation) URL:</b> <span className="break-all font-mono">{data.platform.auth_url}</span></p>
                <p><b>Access token URL:</b> <span className="break-all font-mono">{data.platform.token_url}</span></p>
                <p><b>Public keys (JWKS):</b> <span className="break-all font-mono">{data.platform.jwks_url}</span></p>
                <p className="pt-1 text-slate-500">Each tool also gets its own client ID and deployment ID once you save it.</p>
              </section>
            )}
            <section className="card space-y-2 p-4 text-sm">
              <h2 className="font-semibold">{tool.id ? "Edit tool" : "Register a tool"}</h2>
              <Field label="Name"><input className="input" value={tool.name} onChange={e => setTool({ ...tool, name: e.target.value })} /></Field>
              <Field label="Tool’s login (OIDC initiation) URL"><input className="input" value={tool.oidc_login_url} onChange={e => setTool({ ...tool, oidc_login_url: e.target.value })} /></Field>
              <Field label="Tool’s launch (target link) URL"><input className="input" value={tool.target_link_uri} onChange={e => setTool({ ...tool, target_link_uri: e.target.value })} /></Field>
              <Field label="Redirect URLs (one per line; blank = launch URL)"><textarea className="input" rows={2} value={tool.redirect_uris} onChange={e => setTool({ ...tool, redirect_uris: e.target.value })} /></Field>
              <Field label="Tool’s public keys (JWKS URL)"><input className="input" value={tool.jwks_url} onChange={e => setTool({ ...tool, jwks_url: e.target.value })} /></Field>
              <Field label="…or its public key (PEM)"><textarea className="input font-mono text-xs" rows={2} value={tool.public_key_pem} onChange={e => setTool({ ...tool, public_key_pem: e.target.value })} /></Field>
              <Field label="Custom parameters (key=value per line)"><textarea className="input" rows={2} value={tool.custom} onChange={e => setTool({ ...tool, custom: e.target.value })} /></Field>
              <label className="flex items-center gap-2"><input type="checkbox" checked={tool.send_name} onChange={e => setTool({ ...tool, send_name: e.target.checked })} /> Share names</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={tool.send_email} onChange={e => setTool({ ...tool, send_email: e.target.checked })} /> Share email addresses</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={tool.grades} onChange={e => setTool({ ...tool, grades: e.target.checked })} /> Accept scores from the tool</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={tool.active} onChange={e => setTool({ ...tool, active: e.target.checked })} /> Switched on</label>
              <p className="text-xs text-slate-500">Share only what the tool needs. Check its privacy terms before sharing names or emails of children.</p>
              <div className="flex gap-2">
                <button className="btn btn-primary" disabled={!tool.name || !tool.oidc_login_url || !tool.target_link_uri} onClick={async () => {
                  const r = await act({ action: "save_tool", id: tool.id, name: tool.name, description: tool.description || null, oidc_login_url: tool.oidc_login_url, target_link_uri: tool.target_link_uri,
                    redirect_uris: lines(tool.redirect_uris), jwks_url: tool.jwks_url || null, public_key_pem: tool.public_key_pem || null, custom: toCustom(tool.custom),
                    send_name: tool.send_name, send_email: tool.send_email, grades: tool.grades, active: tool.active }, "Tool saved.");
                  if (r.ok) setTool(blankTool);
                }}>Save tool</button>
                {tool.id && <button className="btn btn-ghost" onClick={() => setTool(blankTool)}>Cancel</button>}
              </div>
            </section>
            <ul className="space-y-2">{data.tools.map(t => (
              <li key={t.id} className="card p-3 text-xs">
                <div className="flex items-center gap-2"><span className="text-sm font-medium">{t.name}</span>{!t.active && <Badge tone="slate">off</Badge>}</div>
                <p className="mt-1">Client ID: <span className="font-mono">{t.client_id}</span></p>
                <p>Deployment ID: <span className="font-mono">{t.deployment_id}</span></p>
                <div className="mt-1 flex gap-3">
                  <button className="text-brand-700 hover:underline" onClick={() => setTool({ id: t.id, name: t.name, description: t.description ?? "", oidc_login_url: t.oidc_login_url ?? "", target_link_uri: t.target_link_uri ?? "",
                    redirect_uris: (t.redirect_uris ?? []).join("\n"), jwks_url: t.jwks_url ?? "", public_key_pem: t.public_key_pem ?? "", custom: Object.entries(t.custom ?? {}).map(([k, v]) => `${k}=${v}`).join("\n"),
                    send_name: t.send_name ?? true, send_email: t.send_email ?? false, grades: t.grades, active: t.active })}>Edit</button>
                  <button className="text-rose-600 hover:underline" onClick={() => confirm(`Delete ${t.name}? It is removed from every class.`) && act({ action: "delete_tool", id: t.id }, "Deleted.")}>Delete</button>
                </div>
              </li>))}</ul>
          </aside>
        )}
      </div>
      <Modal open={Boolean(scoresFor)} onClose={() => setScoresFor(null)} title={`Scores: ${scoresFor?.title ?? ""}`}>
        {!scores.data ? <Loading /> : !scores.data.scores.length ? <Empty>No scores sent back yet.</Empty> : (
          <table className="w-full text-sm"><thead className="text-xs text-slate-500"><tr><th className="p-1 text-left">Student</th><th className="p-1">Score</th><th className="p-1">Status</th><th className="p-1">When</th></tr></thead>
            <tbody>{scores.data.scores.map((s, i) => <tr key={i} className="border-t border-slate-100"><td className="p-1">{s.student}</td><td className="p-1 text-center">{s.score_given ?? "—"}{s.score_maximum ? ` / ${s.score_maximum}` : ""}</td><td className="p-1 text-center text-xs">{s.grading_progress}</td><td className="p-1 text-xs">{fmtDate(s.received_at, true)}</td></tr>)}</tbody></table>
        )}
      </Modal>
    </Page>
  );
}
