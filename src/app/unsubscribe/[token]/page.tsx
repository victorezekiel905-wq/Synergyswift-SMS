"use client";
import { use, useState } from "react";
import { useApi, send } from "@/components/ui";

/** One-click unsubscribe from campaigns and newsletters, with a way back. */
export default function UnsubscribePage(props: { params: Promise<{ token: string }> }) {
  const { token } = use(props.params);
  const { data, error, reload } = useApi<{ name: string; kind: "guardian" | "alumni"; unsubscribed: boolean; school: { name: string; brand_color: string | null } }>(`/api/unsubscribe/${token}`);
  const [busy, setBusy] = useState(false);
  if (error) return <main className="mx-auto max-w-md p-6"><p className="rounded-lg bg-slate-100 p-4">{error}</p></main>;
  if (!data) return <main className="p-10 text-center text-sm text-slate-500">Loading…</main>;
  const color = data.school.brand_color ?? "#1d5ddb";
  const toggle = async (subscribe: boolean) => { setBusy(true); await send(`/api/unsubscribe/${token}`, { subscribe }); setBusy(false); reload(); };
  return (
    <main className="mx-auto max-w-md space-y-3 p-6 text-center">
      <p className="font-semibold" style={{ color }}>{data.school.name}</p>
      {data.unsubscribed ? <>
        <h1 className="text-xl font-bold">You are unsubscribed</h1>
        <p className="text-slate-600">{data.name}, you will no longer receive newsletters and campaigns from {data.school.name}.{data.kind === "guardian" ? " You will still get essential messages about your children, such as results, attendance, fees and safety." : ""}</p>
        <button className="btn btn-outline" disabled={busy} onClick={() => toggle(true)}>Subscribe again</button>
      </> : <>
        <h1 className="text-xl font-bold">Unsubscribe?</h1>
        <p className="text-slate-600">{data.name}, stop receiving newsletters and campaigns from {data.school.name}?{data.kind === "guardian" ? " Essential messages about your children will continue." : ""}</p>
        <button className="btn text-white" style={{ background: color }} disabled={busy} onClick={() => toggle(false)}>Unsubscribe</button>
      </>}
    </main>
  );
}
