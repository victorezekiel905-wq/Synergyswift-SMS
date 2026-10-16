"use client";
import { useState } from "react";
import Link from "next/link";
import { useApi, send, Page, PageHeader, Tabs, Alert, Badge, Empty, Field, Loading, fmtDate } from "@/components/ui";

type News = { id: string; title: string; slug: string; summary: string | null; body: string; image_url: string | null; status: "draft" | "published"; published_at: string | null; updated_at: string };
type Data = {
  base: string; slug: string | null; admin: boolean; news: News[]; events: { id: string; title: string; starts_at: string; show_on_website: boolean }[];
  scopes?: { id: string; label: string }[]; events_list?: string[];
  keys?: { id: string; name: string; prefix: string; scopes: string[]; created_at: string; last_used_at: string | null; expires_at: string | null; revoked_at: string | null }[];
  endpoints?: { id: string; url: string; description: string | null; events: string[]; secret: string; active: boolean; failures: number; last_status: number | null; last_delivered_at: string | null }[];
  deliveries?: { id: string; endpoint_id: string; event: string; status: string; attempts: number; response_code: number | null; last_error: string | null; created_at: string }[];
  services?: { name: string; area: string; on: boolean }[];
};
type Tab = "website" | "keys" | "webhooks" | "services";

const blankNews = { id: null as string | null, title: "", slug: "", summary: "", body: "", image_url: "", status: "draft" as "draft" | "published" };

/** Integrations: the school website (news, events, embedded forms), API keys, webhooks and connected services. */
export default function IntegrationsPage() {
  const { data, error, reload } = useApi<Data>("/api/integrations");
  const [tab, setTab] = useState<Tab>("website");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [keyForm, setKeyForm] = useState({ name: "", scopes: [] as string[], expires_on: "" });
  const [hook, setHook] = useState({ url: "", description: "", events: ["*"] as string[] });
  const [post, setPost] = useState(blankNews);
  const [showSecret, setShowSecret] = useState<string | null>(null);
  if (error) return <Page><Alert>{error}</Alert></Page>;
  if (!data) return <Page><Loading /></Page>;

  async function act(body: Record<string, unknown>, ok: string) {
    const r = await send("/api/integrations", body);
    setMsg({ ok: r.ok, text: r.ok ? (r.data?.note ?? ok) : r.error ?? "failed" });
    if (r.ok) reload();
    return r;
  }
  const tabs = [{ id: "website" as const, label: "School website" }, ...(data.admin ? [{ id: "keys" as const, label: "API keys" }, { id: "webhooks" as const, label: "Webhooks" }, { id: "services" as const, label: "Connected services" }] : [])];
  const s = data.slug;
  const snippet = (kind: string) => `<div data-educlass="${kind}" data-school="${s}"></div>\n<script src="${data.base}/embed.js" async></script>`;

  return (
    <Page wide>
      <PageHeader eyebrow="Administration" title="Integrations"
        subtitle="Put news, events and the admissions forms on your website; give other systems an API key; get webhooks when things happen."
        actions={<a href="/api/v1" target="_blank" rel="noreferrer" className="btn btn-outline text-xs">API description</a>} />
      {msg && <div className="mb-4"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <div className="mt-4 space-y-5">
        {tab === "website" && <>
          {!s ? <Alert tone="amber">Set your school’s web address (public slug) under <Link className="underline" href="/school/admissions">Admissions → settings</Link> first; the feeds and widgets use it.</Alert> : (
            <section className="card space-y-3 p-4 text-sm">
              <h2 className="font-semibold">Add to your website</h2>
              <p className="text-slate-600">Paste a snippet into any page (WordPress: a “Custom HTML” block; Wix and Squarespace: an “Embed code” block). The widgets keep their own look and update by themselves.</p>
              <div className="grid gap-3 md:grid-cols-2">
                {[["news", "Latest news"], ["events", "Upcoming events"], ["apply", "Admissions application form"], ["enquire", "Enquiry form"]].map(([k, l]) => (
                  <div key={k}><p className="mb-1 font-medium">{l}</p><pre className="overflow-x-auto rounded bg-slate-900 p-2 text-xs text-slate-100">{snippet(k)}</pre></div>
                ))}
              </div>
              <p className="text-slate-600">Feeds for developers or other tools: <a className="text-brand-700 underline" href={`${data.base}/api/public/${s}/news`} target="_blank" rel="noreferrer">news (JSON)</a>, <a className="text-brand-700 underline" href={`${data.base}/api/public/${s}/rss`} target="_blank" rel="noreferrer">news (RSS)</a>, <a className="text-brand-700 underline" href={`${data.base}/api/public/${s}/events`} target="_blank" rel="noreferrer">events</a>.</p>
            </section>
          )}
          <section className="card space-y-3 p-4">
            <h2 className="font-semibold">{post.id ? "Edit news post" : "New news post"}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Title"><input className="input" value={post.title} onChange={e => setPost({ ...post, title: e.target.value })} /></Field>
              <Field label="Picture (https link, optional)"><input className="input" value={post.image_url} onChange={e => setPost({ ...post, image_url: e.target.value })} /></Field>
            </div>
            <Field label="Summary (shown in lists)"><input className="input" maxLength={400} value={post.summary} onChange={e => setPost({ ...post, summary: e.target.value })} /></Field>
            <Field label="Story"><textarea className="input" rows={6} value={post.body} onChange={e => setPost({ ...post, body: e.target.value })} /></Field>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-outline" disabled={post.title.trim().length < 2} onClick={async () => { const r = await act({ action: "save_news", ...post, status: "draft" }, "Draft saved."); if (r.ok) setPost(blankNews); }}>Save draft</button>
              <button className="btn btn-primary" disabled={post.title.trim().length < 2} onClick={async () => { const r = await act({ action: "save_news", ...post, status: "published" }, "Published to the website."); if (r.ok) setPost(blankNews); }}>Publish</button>
              {post.id && <button className="btn btn-ghost" onClick={() => setPost(blankNews)}>Cancel</button>}
            </div>
          </section>
          <section>
            <h2 className="mb-2 font-semibold">News posts</h2>
            {!data.news.length ? <Empty>No posts yet.</Empty> : (
              <ul className="space-y-2">{data.news.map(n => (
                <li key={n.id} className="card flex flex-wrap items-center gap-2 p-3 text-sm">
                  <span className="font-medium">{n.title}</span><Badge tone={n.status === "published" ? "green" : "slate"}>{n.status}</Badge>
                  <span className="text-xs text-slate-500">{n.published_at ? `published ${fmtDate(n.published_at)}` : `edited ${fmtDate(n.updated_at)}`}</span>
                  <span className="ml-auto flex gap-3 text-xs">
                    <button className="text-brand-700 hover:underline" onClick={() => setPost({ id: n.id, title: n.title, slug: n.slug, summary: n.summary ?? "", body: n.body, image_url: n.image_url ?? "", status: n.status })}>Edit</button>
                    {n.status === "published" && <button className="text-slate-600 hover:underline" onClick={() => act({ action: "save_news", id: n.id, title: n.title, slug: n.slug, summary: n.summary, body: n.body, image_url: n.image_url ?? "", status: "draft" }, "Taken off the website.")}>Unpublish</button>}
                    <button className="text-rose-600 hover:underline" onClick={() => confirm("Delete this post?") && act({ action: "delete_news", id: n.id }, "Deleted.")}>Delete</button>
                  </span>
                </li>))}</ul>
            )}
          </section>
          <section>
            <h2 className="mb-2 font-semibold">Events on the website</h2>
            {!data.events.length ? <Empty>No upcoming events. Add them under Events &amp; trips.</Empty> : (
              <ul className="card divide-y divide-slate-100">{data.events.map(e => (
                <li key={e.id} className="flex items-center gap-3 p-3 text-sm">
                  <input type="checkbox" checked={e.show_on_website} onChange={ev => act({ action: "event_on_website", id: e.id, show: ev.target.checked }, ev.target.checked ? "Shown on the website." : "Hidden from the website.")} aria-label={`Show ${e.title} on the website`} />
                  <span className="flex-1">{e.title}</span><span className="text-xs text-slate-500">{fmtDate(e.starts_at, true)}</span>
                </li>))}</ul>
            )}
          </section>
        </>}

        {tab === "keys" && data.keys && <>
          {newKey && (
            <div className="rounded-xl border-2 border-emerald-500 bg-emerald-50 p-4 text-sm">
              <p className="font-semibold">Copy this key now. It will not be shown again.</p>
              <p className="my-2 break-all font-mono">{newKey}</p>
              <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => { navigator.clipboard?.writeText(newKey); }}>Copy</button>
              <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setNewKey(null)}>Done</button>
            </div>
          )}
          <section className="card space-y-3 p-4 text-sm">
            <h2 className="font-semibold">New API key</h2>
            <div className="flex flex-wrap gap-3">
              <Field label="What it is for"><input className="input w-64" value={keyForm.name} onChange={e => setKeyForm({ ...keyForm, name: e.target.value })} placeholder="e.g. School website" /></Field>
              <Field label="Expires (optional)"><input type="date" className="input" value={keyForm.expires_on} onChange={e => setKeyForm({ ...keyForm, expires_on: e.target.value })} /></Field>
            </div>
            <div className="grid gap-1 sm:grid-cols-2">{data.scopes!.map(sc => (
              <label key={sc.id} className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={keyForm.scopes.includes(sc.id)}
                onChange={e => setKeyForm({ ...keyForm, scopes: e.target.checked ? [...keyForm.scopes, sc.id] : keyForm.scopes.filter(x => x !== sc.id) })} />
                <span><code className="text-xs">{sc.id}</code> <span className="text-slate-500">{sc.label}</span></span></label>))}</div>
            <p className="text-xs text-slate-500">Give each system only what it needs. A website usually needs news:read, events:read and applications:write.</p>
            <button className="btn btn-primary" disabled={!keyForm.name.trim() || !keyForm.scopes.length} onClick={async () => {
              const r = await act({ action: "create_key", name: keyForm.name, scopes: keyForm.scopes, expires_on: keyForm.expires_on || null }, "Key created.");
              if (r.ok) { setNewKey(r.data.key); setKeyForm({ name: "", scopes: [], expires_on: "" }); }
            }}>Create key</button>
          </section>
          {!data.keys.length ? <Empty>No keys yet.</Empty> : (
            <div className="card overflow-x-auto"><table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-2 text-left">Name</th><th className="p-2 text-left">Key starts</th><th className="p-2 text-left">Scopes</th><th className="p-2">Last used</th><th className="p-2"></th></tr></thead>
              <tbody>{data.keys.map(k => (
                <tr key={k.id} className="border-t border-slate-100">
                  <td className="p-2">{k.name}{k.revoked_at && <Badge tone="red">revoked</Badge>}{k.expires_at && !k.revoked_at && <span className="ml-1 text-xs text-slate-500">expires {fmtDate(k.expires_at)}</span>}</td>
                  <td className="p-2 font-mono text-xs">{k.prefix}…</td><td className="p-2 text-xs">{k.scopes.join(", ")}</td>
                  <td className="p-2 text-center text-xs">{k.last_used_at ? fmtDate(k.last_used_at, true) : "never"}</td>
                  <td className="p-2 text-right">{!k.revoked_at && <button className="text-xs text-rose-600 hover:underline" onClick={() => confirm(`Revoke "${k.name}"? Anything using it stops working.`) && act({ action: "revoke_key", id: k.id }, "Key revoked.")}>Revoke</button>}</td>
                </tr>))}</tbody></table></div>
          )}
        </>}

        {tab === "webhooks" && data.endpoints && <>
          <section className="card space-y-3 p-4 text-sm">
            <h2 className="font-semibold">Add a webhook</h2>
            <p className="text-slate-600">We POST JSON to your address when these happen, signed with the endpoint’s secret (header <code>X-Webhook-Signature</code>; see the API description). Failed sends are retried for about a day; an address that fails 20 times in a row is turned off.</p>
            <div className="flex flex-wrap gap-3">
              <Field label="Address (https)"><input className="input w-96 max-w-full" value={hook.url} onChange={e => setHook({ ...hook, url: e.target.value })} placeholder="https://example.org/school-hooks" /></Field>
              <Field label="Note"><input className="input w-56" value={hook.description} onChange={e => setHook({ ...hook, description: e.target.value })} /></Field>
            </div>
            <div className="flex flex-wrap gap-1.5">{["*", ...data.events_list!].map(ev => { const on = hook.events.includes(ev); return (
              <button key={ev} type="button" onClick={() => setHook({ ...hook, events: ev === "*" ? ["*"] : on ? hook.events.filter(x => x !== ev) : [...hook.events.filter(x => x !== "*"), ev] })}
                className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-brand-500 bg-brand-50" : "border-slate-200"}`}>{ev === "*" ? "Everything" : ev}</button>); })}</div>
            <button className="btn btn-primary" disabled={!hook.url || !hook.events.length} onClick={async () => { const r = await act({ action: "add_endpoint", ...hook, description: hook.description || null }, "Webhook added."); if (r.ok) setHook({ url: "", description: "", events: ["*"] }); }}>Add</button>
          </section>
          {!data.endpoints.length ? <Empty>No webhooks yet.</Empty> : data.endpoints.map(ep => (
            <section key={ep.id} className="card space-y-2 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="break-all font-mono text-xs">{ep.url}</span>
                <Badge tone={ep.active ? "green" : "red"}>{ep.active ? "on" : "off"}</Badge>
                {ep.failures > 0 && <Badge tone="amber">{ep.failures} failed in a row</Badge>}
                <span className="ml-auto flex flex-wrap gap-3 text-xs">
                  <button className="text-brand-700 hover:underline" onClick={() => act({ action: "test_endpoint", id: ep.id }, "Test queued.")}>Send a test</button>
                  <button className="text-brand-700 hover:underline" onClick={() => act({ action: "update_endpoint", id: ep.id, active: !ep.active }, ep.active ? "Turned off." : "Turned on.")}>{ep.active ? "Turn off" : "Turn on"}</button>
                  <button className="text-brand-700 hover:underline" onClick={() => setShowSecret(showSecret === ep.id ? null : ep.id)}>{showSecret === ep.id ? "Hide secret" : "Show secret"}</button>
                  <button className="text-slate-600 hover:underline" onClick={() => confirm("Make a new secret? Update your receiver at once.") && act({ action: "rotate_secret", id: ep.id }, "New secret made.")}>New secret</button>
                  <button className="text-rose-600 hover:underline" onClick={() => confirm("Delete this webhook?") && act({ action: "delete_endpoint", id: ep.id }, "Deleted.")}>Delete</button>
                </span>
              </div>
              <p className="text-xs text-slate-500">{ep.description ? `${ep.description} · ` : ""}{ep.events.includes("*") ? "everything" : ep.events.join(", ")}{ep.last_delivered_at ? ` · last delivered ${fmtDate(ep.last_delivered_at, true)}` : ""}</p>
              {showSecret === ep.id && <p className="break-all rounded bg-slate-100 p-2 font-mono text-xs">{ep.secret}</p>}
              <ul className="divide-y divide-slate-100 text-xs">{(data.deliveries ?? []).filter(d => d.endpoint_id === ep.id).slice(0, 10).map(d => (
                <li key={d.id} className="flex flex-wrap items-center gap-2 py-1">
                  <span className="w-40">{fmtDate(d.created_at, true)}</span><span className="w-44 font-mono">{d.event}</span>
                  <Badge tone={d.status === "delivered" ? "green" : d.status === "failed" ? "red" : "amber"}>{d.status}</Badge>
                  <span className="text-slate-500">{d.response_code ? `HTTP ${d.response_code}` : ""}{d.last_error ? ` ${d.last_error}` : ""}{d.attempts > 1 ? ` · ${d.attempts} tries` : ""}</span>
                  {d.status === "failed" && <button className="ml-auto text-brand-700 hover:underline" onClick={() => act({ action: "retry_delivery", id: d.id }, "Queued again.")}>Retry</button>}
                </li>))}</ul>
            </section>
          ))}
        </>}

        {tab === "services" && data.services && (
          <section className="card divide-y divide-slate-100">
            {data.services.map(sv => (
              <div key={sv.name} className="flex items-center gap-3 p-3 text-sm"><span className="w-24 text-xs text-slate-500">{sv.area}</span><span className="flex-1">{sv.name}</span>
                <Badge tone={sv.on ? "green" : "slate"}>{sv.on ? "connected" : "not set up"}</Badge></div>
            ))}
            <p className="p-3 text-xs text-slate-500">Payments: each school adds its own Paystack/Flutterwave subaccount, Remita or Stripe details under Fees. Zoom: under Online lessons. Messaging and app notifications are set up on the server (see the going-live checklist).</p>
          </section>
        )}
      </div>
    </Page>
  );
}
