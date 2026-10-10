"use client";
import { useApi, send, Empty, Loading, fmtDate } from "@/components/ui";
import type { LeadsData } from "./Pipeline";

/** Follow-up tasks: overdue first, then today and later; "mine" or the whole team. */
export default function Tasks({ onOpenLead, mineOnly }: { onOpenLead: (id: string) => void; mineOnly: boolean }) {
  const { data, reload } = useApi<LeadsData>("/api/crm/leads");
  if (!data) return <Loading />;
  const name = new Map(data.leads.map(l => [l.id, l.parent_name]));
  const staff = new Map(data.staff.map(s => [s.id, s.full_name]));
  const tasks = data.tasks.filter(t => !mineOnly || t.assigned_to === data.me);
  const now = Date.now(), endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
  const groups = [
    { label: "Overdue", items: tasks.filter(t => new Date(t.due_at).getTime() < now), tone: "text-rose-600" },
    { label: "Today", items: tasks.filter(t => { const d = new Date(t.due_at).getTime(); return d >= now && d <= endOfDay.getTime(); }), tone: "text-amber-700" },
    { label: "Later", items: tasks.filter(t => new Date(t.due_at).getTime() > endOfDay.getTime()), tone: "text-slate-600" }
  ];
  // Enquiries nobody has contacted yet: first response time matters most.
  const untouched = data.leads.filter(l => l.stage === "enquiry" && !l.last_contact_at && (!mineOnly || l.owner_id === data.me));
  if (!tasks.length && !untouched.length) return <Empty>No open tasks. Follow-up sequences and the team add tasks here.</Empty>;
  return (
    <div className="space-y-4">
      {untouched.length > 0 && (
        <section className="card border-amber-300 p-3">
          <h3 className="mb-1 font-semibold text-amber-800">Not contacted yet ({untouched.length})</h3>
          <ul className="text-sm">{untouched.slice(0, 30).map(l => <li key={l.id}><button className="text-brand-700 hover:underline" onClick={() => onOpenLead(l.id)}>{l.parent_name}</button> <span className="text-xs text-slate-500">enquired {fmtDate(l.created_at, true)}</span></li>)}</ul>
        </section>
      )}
      {groups.filter(g => g.items.length).map(g => (
        <section key={g.label}>
          <h3 className={"mb-1 font-semibold " + g.tone}>{g.label} ({g.items.length})</h3>
          <ul className="card divide-y divide-slate-100 text-sm">{g.items.map(t => (
            <li key={t.id} className="flex flex-wrap items-center gap-2 p-2">
              <input type="checkbox" aria-label="Done" onChange={async () => { await send("/api/crm/leads", { action: "task_done", task_id: t.id, done: true }); reload(); }} />
              <span className="flex-1">{t.body}</span>
              <button className="text-xs text-brand-700 hover:underline" onClick={() => onOpenLead(t.lead_id)}>{name.get(t.lead_id) ?? "Open family"}</button>
              <span className="text-xs text-slate-500">{fmtDate(t.due_at, true)}{!mineOnly && t.assigned_to ? ` · ${staff.get(t.assigned_to) ?? ""}` : ""}</span>
            </li>
          ))}</ul>
        </section>
      ))}
    </div>
  );
}
