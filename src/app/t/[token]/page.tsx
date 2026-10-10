"use client";
import { use, useState } from "react";
import { useApi, send } from "@/components/ui";

type Data = {
  ticket: { ticket_no: string; kind: string; subject: string; body: string; status: string; status_label: string; created_at: string; resolved_at: string | null; satisfaction: number | null; name: string | null };
  messages: { id: string; author: string; body: string; created_at: string; name: string | null }[];
  school: { name: string; logo_url: string | null; brand_color: string | null; phone: string | null };
};
const when = (v: string) => new Date(v).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** A family follows their complaint or request: replies, status, and a rating once it is resolved. */
export default function TicketPage(props: { params: Promise<{ token: string }> }) {
  const { token } = use(props.params);
  const { data, error, reload } = useApi<Data>(`/api/t/${token}`);
  const [reply, setReply] = useState("");
  const [stars, setStars] = useState(0);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (error) return <main className="mx-auto max-w-xl p-6"><p className="rounded-lg bg-slate-100 p-4">{error}</p></main>;
  if (!data) return <main className="p-10 text-center text-sm text-slate-500">Loading…</main>;
  const t = data.ticket;
  const color = data.school.brand_color ?? "#1d5ddb";
  const done = ["resolved", "closed"].includes(t.status);
  const post = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    const r = await send(`/api/t/${token}`, body);
    setBusy(false);
    setMsg(r.ok ? ok : r.error);
    if (r.ok) reload();
    return r.ok;
  };
  return (
    <main className="mx-auto max-w-xl space-y-4 p-6">
      <header className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {data.school.logo_url && <img src={data.school.logo_url} alt="" className="h-10 w-10 rounded" />}
        <p className="font-semibold" style={{ color }}>{data.school.name}</p>
      </header>
      <div>
        <p className="font-mono text-xs text-slate-500">{t.ticket_no}</p>
        <h1 className="text-xl font-bold">{t.subject}</h1>
        <p className="text-sm">Status: <b>{t.status_label}</b></p>
      </div>
      {msg && <p className="rounded bg-slate-100 p-2 text-sm" role="status">{msg}</p>}
      <ol className="space-y-2 text-sm">
        <li className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">{t.name ?? "You"} · {when(t.created_at)}</p><p className="whitespace-pre-wrap">{t.body}</p></li>
        {data.messages.map(m => (
          <li key={m.id} className={"rounded-lg p-3 " + (m.author === "staff" ? "border border-slate-200 bg-white" : "bg-slate-50")}>
            <p className="text-xs text-slate-500">{m.author === "staff" ? `${m.name} · ${data.school.name}` : "You"} · {when(m.created_at)}</p>
            <p className="whitespace-pre-wrap">{m.body}</p>
          </li>
        ))}
      </ol>
      {done && !t.satisfaction && t.status === "resolved" && (
        <section className="rounded-lg border border-slate-200 p-4 text-sm">
          <h2 className="font-semibold">How did we do?</h2>
          <div className="my-2 flex gap-1" role="radiogroup" aria-label="Rating">
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={`${n} star${n === 1 ? "" : "s"}`} onClick={() => setStars(n)}
                className={"text-3xl " + (n <= stars ? "text-amber-400" : "text-slate-300")}>★</button>
            ))}
          </div>
          <textarea className="input min-h-16" value={note} onChange={e => setNote(e.target.value)} placeholder="Anything to add? (optional)" maxLength={1000} />
          <button className="btn mt-2 text-white" style={{ background: color }} disabled={!stars || busy} onClick={() => post({ action: "rate", satisfaction: stars, note: note || null }, "Thank you for your feedback.")}>Send rating</button>
          <p className="mt-2 text-xs text-slate-500">Not sorted? Write below and we will reopen it.</p>
        </section>
      )}
      {t.satisfaction && <p className="text-sm">You rated this {t.satisfaction}/5. Thank you.</p>}
      {t.status !== "closed" && (
        <form className="space-y-2" onSubmit={async e => { e.preventDefault(); if (await post({ action: "reply", body: reply }, "Sent. The school has been told.")) setReply(""); }}>
          <textarea className="input min-h-24" value={reply} onChange={e => setReply(e.target.value)} placeholder="Write a reply" required maxLength={3000} aria-label="Your reply" />
          <button className="btn text-white" style={{ background: color }} disabled={busy || !reply.trim()}>Send</button>
        </form>
      )}
      {t.status === "closed" && <p className="text-sm text-slate-600">This request is closed. If you need more help, raise a new one from your parent portal{data.school.phone ? ` or call ${data.school.phone}` : ""}.</p>}
    </main>
  );
}
