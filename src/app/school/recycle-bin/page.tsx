"use client";
import { useEffect, useMemo, useState } from "react";
import { Page, PageHeader, Alert, Badge, Empty, Loading, Modal, fmtDate } from "@/components/ui";
import type { BinEntry } from "@/lib/recycle-bin";

type Confirm = { kind: "restore" | "delete"; entries: BinEntry[] } | { kind: "empty" } | null;

const title = (e: BinEntry) => e.items.length === 1 ? e.items[0]!.label : `${e.items.length + e.more} items`;
const daysLeft = (iso: string) => Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000));

/**
 * Recycle bin: everything deleted in the school in the last 30 days. Restore puts a deletion
 * back with everything that went with it; Delete for good removes it (and its files) for ever.
 */
export default function RecycleBinPage() {
  const [entries, setEntries] = useState<BinEntry[] | null>(null);
  const [keepDays, setKeepDays] = useState(30);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const r = await fetch("/api/school/recycle-bin");
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.error ?? "Could not open the recycle bin."); setEntries([]); return; }
    setEntries(j.entries); setKeepDays(j.keep_days ?? 30); setErr(null);
    setPicked(p => new Set([...p].filter(b => j.entries.some((e: BinEntry) => e.batch === b))));
  };
  useEffect(() => { void load(); }, []);

  const kinds = useMemo(() => [...new Set((entries ?? []).flatMap(e => e.items.map(i => i.kind)))].sort(), [entries]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (entries ?? []).filter(e => (!kind || e.items.some(i => i.kind === kind)) &&
      (!t || e.items.some(i => `${i.kind} ${i.label}`.toLowerCase().includes(t)) || e.who.toLowerCase().includes(t)));
  }, [entries, q, kind]);
  const pickedEntries = (entries ?? []).filter(e => picked.has(e.batch));
  const toggle = (b: string) => setPicked(p => { const n = new Set(p); if (n.has(b)) n.delete(b); else n.add(b); return n; });

  async function run() {
    if (!confirm) return;
    setBusy(true); setErr(null); setNote(null);
    try {
      if (confirm.kind === "restore") {
        let ok = 0; const problems: string[] = [];
        for (const e of confirm.entries) {
          const r = await fetch("/api/school/recycle-bin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restore", batch: e.batch }) });
          const j = await r.json().catch(() => ({}));
          if (r.ok) ok++; else problems.push(j.error ?? `Could not restore ${title(e)}.`);
        }
        if (ok) setNote(confirm.entries.length === 1 ? `"${title(confirm.entries[0]!)}" is back where it was.` : `${ok} of ${confirm.entries.length} deletions are back where they were.`);
        if (problems.length) setErr(problems.join(" "));
      } else {
        const body = confirm.kind === "empty" ? { action: "empty" } : { action: "delete", batches: confirm.entries.map(e => e.batch) };
        const r = await fetch("/api/school/recycle-bin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) setErr(j.error ?? "Could not delete."); else setNote(j.deleted === 1 ? "Deleted for good." : `${j.deleted} deletions removed for good.`);
      }
    } finally {
      setBusy(false); setConfirm(null); setPicked(new Set()); await load();
    }
  }

  const describe = (c: Exclude<Confirm, null>) => c.kind === "empty" ? "everything in the recycle bin"
    : c.entries.length === 1 ? `"${title(c.entries[0]!)}"` : `${c.entries.length} deletions`;

  return (
    <Page wide>
      <PageHeader eyebrow="Administration" title="Recycle bin"
        subtitle={`Everything deleted in the school is kept here for ${keepDays} days, with what was removed along with it. Restore puts it back as it was; Delete for good removes it, and its files, for ever.`}
        actions={entries?.length ? <button className="btn btn-danger" onClick={() => setConfirm({ kind: "empty" })}>Empty recycle bin</button> : undefined} />

      {note && <div className="mb-4"><Alert tone="green">{note}</Alert></div>}
      {err && <div className="mb-4"><Alert>{err}</Alert></div>}

      {entries === null ? <Loading /> : !entries.length ? (
        <Empty>The recycle bin is empty. Anything deleted from now on shows here for {keepDays} days.</Empty>
      ) : (
        <>
          <div className="card mb-4 flex flex-wrap items-end gap-3 p-4">
            <label className="block min-w-[14rem] flex-1"><span className="label">Search</span>
              <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="A name, a title, who deleted it…" /></label>
            <label className="block w-full sm:w-56"><span className="label">What</span>
              <select className="input" value={kind} onChange={e => setKind(e.target.value)}><option value="">Everything</option>{kinds.map(k => <option key={k}>{k}</option>)}</select></label>
            {pickedEntries.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-primary" onClick={() => setConfirm({ kind: "restore", entries: pickedEntries })}>Restore {pickedEntries.length}</button>
                <button className="btn btn-outline" onClick={() => setConfirm({ kind: "delete", entries: pickedEntries })}>Delete {pickedEntries.length} for good</button>
              </div>
            )}
          </div>

          {!shown.length ? <Empty>Nothing in the bin matches.</Empty> : (
            <ul className="card divide-y divide-slate-100">
              {shown.map(e => {
                const left = daysLeft(e.expires_at);
                return (
                  <li key={e.batch} className="flex flex-wrap items-start gap-3 p-4">
                    <input type="checkbox" className="mt-1 h-4 w-4" checked={picked.has(e.batch)} onChange={() => toggle(e.batch)} aria-label={`Select ${title(e)}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="slate">{e.items.length === 1 ? e.items[0]!.kind : [...new Set(e.items.map(i => i.kind))].join(", ")}</Badge>
                        <span className="font-medium text-slate-900">{title(e)}</span>
                      </div>
                      {e.items.length > 1 && <p className="mt-1 truncate text-sm text-slate-600">{e.items.map(i => i.label).join(", ")}{e.more ? ` and ${e.more} more` : ""}</p>}
                      <p className="mt-1 text-xs text-slate-500">
                        Deleted {fmtDate(e.deleted_at, true)} by {e.who}
                        {e.linked > 0 && <> · {e.linked} linked record{e.linked === 1 ? "" : "s"} went with it</>}
                        {e.unlinked > 0 && <> · {e.unlinked} record{e.unlinked === 1 ? " was" : "s were"} unlinked</>}
                      </p>
                      <p className={`mt-0.5 text-xs ${left <= 3 ? "text-rose-700" : "text-slate-500"}`}>
                        {left === 0 ? "Deleted for good today" : `Deleted for good in ${left} day${left === 1 ? "" : "s"}`}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button className="btn btn-outline btn-sm" onClick={() => setConfirm({ kind: "restore", entries: [e] })}>Restore</button>
                      <button className="btn btn-ghost btn-sm text-rose-700" onClick={() => setConfirm({ kind: "delete", entries: [e] })}>Delete for good</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      <Modal open={confirm !== null} onClose={() => !busy && setConfirm(null)}
        title={confirm?.kind === "restore" ? "Restore?" : confirm?.kind === "empty" ? "Empty the recycle bin?" : "Delete for good?"}>
        {confirm && (
          <div className="space-y-4 text-sm">
            {confirm.kind === "restore" ? (
              <p>Put {describe(confirm)} back where {confirm.entries.length === 1 ? "it was" : "they were"}, with everything that was removed or unlinked along with {confirm.entries.length === 1 ? "it" : "them"}.</p>
            ) : (
              <p>This removes {describe(confirm)} for ever, with any uploaded files. <strong>It cannot be undone.</strong></p>
            )}
            <div className="flex justify-end gap-2">
              <button className="btn btn-outline" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
              <button className={confirm.kind === "restore" ? "btn btn-primary" : "btn btn-danger"} disabled={busy} onClick={run}>
                {busy ? "Working…" : confirm.kind === "restore" ? "Restore" : "Delete for good"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </Page>
  );
}
