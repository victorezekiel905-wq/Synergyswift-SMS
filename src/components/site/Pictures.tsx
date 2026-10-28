import { Monogram } from "@/components/AppShell";
import { Icon } from "@/components/ui";

/* ---------- pictures, drawn with the app's own parts (no stock art) ---------- */

export function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-pop">
      <div className="flex h-9 items-center gap-2 border-b border-slate-200 bg-slate-50 px-3.5">
        <Monogram size="h-4 w-4" solid /><span className="text-[11px] font-medium text-slate-600">{title}</span>
      </div>
      {children}
    </div>
  );
}

export function HeroPicture() {
  const tiles = [["Attendance today", "96.4%", "12 absent"], ["Fees collected", "78%", "₦41.2m of ₦52.8m"], ["Registers taken", "38 / 38", "by 8:10"], ["Applications", "64", "9 this week"]];
  const rows = [["JSS1 Gold", "Mrs Adeyemi", "7:58"], ["JSS2 Blue", "Mr Okafor", "8:02"], ["SS1 Science", "Ms Bello", "8:05"], ["SS2 Arts", "Mr Danjuma", "due"]];
  return (
    <div className="lg:pl-4" aria-label="The school overview" role="img">
      <Frame title="Greenfield College · School overview">
        <div className="p-5">
          <p className="text-[11px] text-slate-500">First Term 2026/2027</p>
          <p className="font-serif text-lg font-semibold">Good morning, Mrs Okonkwo</p>
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            {tiles.map(([l, v, h]) => (
              <div key={l} className="rounded-md border border-slate-200 px-3 py-2.5">
                <p className="text-[10px] text-slate-500">{l}</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums tracking-tight">{v}</p>
                <p className="text-[10px] text-slate-500">{h}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 overflow-hidden rounded-md border border-slate-200">
            <div className="grid grid-cols-3 bg-slate-50 px-3 py-1.5 text-[10px] text-slate-500"><span>Class</span><span>Form tutor</span><span className="text-right">Register</span></div>
            {rows.map(([c, t, s]) => (
              <div key={c} className="grid grid-cols-3 border-t border-slate-100 px-3 py-1.5 text-[11px]">
                <span className="font-medium">{c}</span><span className="text-slate-600">{t}</span>
                <span className={`text-right tabular-nums ${s === "due" ? "font-medium text-amber-700" : "text-slate-500"}`}>{s}</span>
              </div>
            ))}
          </div>
        </div>
      </Frame>
    </div>
  );
}

export function ExamPicture() {
  return (
    <Frame title="Mathematics · JSS2 · Second test">
      <div className="p-6">
        <div className="flex items-center justify-between text-[11px]">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">Question 7 of 30</span>
          <span className="flex items-center gap-1.5 text-slate-600"><Icon name="lock" className="h-3.5 w-3.5 text-brand-700" />Locked to the exam browser</span>
          <span className="font-medium tabular-nums">24:18</span>
        </div>
        <p className="mt-5 text-[15px] font-medium leading-relaxed">A trader buys 12 crates of eggs at ₦4,500 each and sells them for ₦63,000. What is the profit as a percentage of the cost?</p>
        <div className="mt-4 space-y-2">
          {["12.5%", "16.7%", "14.3%", "20%"].map((o, i) => (
            <div key={o} className={`flex items-center gap-3 rounded-lg border px-3.5 py-2.5 text-sm ${i === 1 ? "border-brand-700 bg-brand-50/60" : "border-slate-200"}`}>
              <span className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] ${i === 1 ? "border-brand-700 bg-brand-700 text-white" : "border-slate-300 text-slate-500"}`}>{"ABCD"[i]}</span>{o}
            </div>
          ))}
        </div>
        <div className="mt-5 flex items-center gap-1">
          {Array.from({ length: 30 }, (_, i) => <span key={i} className={`h-1.5 flex-1 rounded-full ${i < 6 ? "bg-brand-600" : i === 6 ? "bg-brand-300" : "bg-slate-200"}`} />)}
        </div>
      </div>
    </Frame>
  );
}

export function LessonPicture() {
  const teams = [["Blue House", 86], ["Gold House", 72], ["Green House", 64], ["Red House", 51]] as const;
  return (
    <Frame title="Live lesson · Photosynthesis · SS1">
      <div className="grid gap-0 sm:grid-cols-[1.3fr_1fr]">
        <div className="border-b border-slate-200 p-6 sm:border-b-0 sm:border-r">
          <p className="text-[11px] text-slate-500">Slide 6 of 14 · 31 students joined</p>
          <p className="mt-3 font-serif text-xl font-semibold leading-snug">Which gas do plants take in for photosynthesis?</p>
          <div className="mt-5 space-y-2.5">
            {[["Carbon dioxide", 74], ["Oxygen", 16], ["Nitrogen", 10]].map(([l, v]) => (
              <div key={l as string}>
                <div className="flex justify-between text-[12px]"><span>{l}</span><span className="tabular-nums text-slate-500">{v}%</span></div>
                <div className="mt-1 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-brand-600" style={{ width: `${v}%` }} /></div>
              </div>
            ))}
          </div>
        </div>
        <div className="p-6">
          <p className="text-[11px] text-slate-500">Team battle</p>
          <ol className="mt-3 space-y-2.5">
            {teams.map(([t, v], i) => (
              <li key={t} className="flex items-center gap-3 text-[13px]">
                <span className="w-4 text-right tabular-nums text-slate-400">{i + 1}</span>
                <span className="flex-1"><span className="font-medium">{t}</span><span className="mt-1 block h-1.5 rounded-full bg-slate-100"><span className="block h-1.5 rounded-full bg-slate-700" style={{ width: `${v}%` }} /></span></span>
                <span className="w-8 text-right tabular-nums text-slate-600">{v}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Frame>
  );
}

export function PhonePicture() {
  const items: [string, string, string][] = [
    ["7:52", "Arrived at school", "Main gate"],
    ["10:15", "Mathematics homework set", "Due Thursday"],
    ["13:40", "Second test result", "Mathematics 84 / 100"],
    ["15:05", "Boarded the school bus", "Route 3, Lekki"]
  ];
  return (
    <div className="mx-auto w-full max-w-[320px] rounded-[34px] border border-slate-300 bg-white p-3 shadow-pop" role="img" aria-label="The parent app on a phone">
      <div className="rounded-[26px] bg-canvas px-4 pb-5 pt-6">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-700 text-sm font-semibold text-white">AO</span>
          <div><p className="text-sm font-semibold">Ada Okonkwo</p><p className="text-[11px] text-slate-500">JSS2 Blue · Greenfield College</p></div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          {[["98%", "attendance"], ["78.4", "average"], ["₦0", "owing"]].map(([v, l]) => (
            <div key={l} className="rounded-lg bg-white py-2"><p className="text-sm font-semibold tabular-nums">{v}</p><p className="text-[10px] text-slate-500">{l}</p></div>
          ))}
        </div>
        <p className="mt-5 text-[11px] font-medium text-slate-500">Today</p>
        <ol className="mt-2 space-y-2">
          {items.map(([t, a, b]) => (
            <li key={t} className="flex gap-3 rounded-lg bg-white p-2.5">
              <span className="w-9 shrink-0 text-[10px] tabular-nums text-slate-500">{t}</span>
              <span><span className="block text-[12px] font-medium">{a}</span><span className="block text-[10px] text-slate-500">{b}</span></span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
