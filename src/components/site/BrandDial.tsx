/**
 * The welcome page's drawing: the Synergy Swift wings at the centre of a dial,
 * like an instrument face. Six offices sit on the rim, each joined to the one
 * record in the middle. Lines draw in once, labels settle, and a brass hand
 * sweeps once a minute. Everything stops for reduced motion (globals.css).
 */
const WINGS = [
  "M256 256A64.7 64.7 0 0 1 330 150A65.3 65.3 0 1 0 256 256Z",
  "M256 256A64.7 64.7 0 0 1 182 362A65.3 65.3 0 1 0 256 256Z",
  "M256 256A66.7 66.7 0 1 1 330 150A72.2 72.2 0 1 0 256 256Z",
  "M256 256A66.7 66.7 0 1 1 182 362A72.2 72.2 0 1 0 256 256Z",
  "M256 256A74.7 74.7 0 1 1 330 150A84.8 84.8 0 1 0 256 256Z",
  "M256 256A74.7 74.7 0 1 1 182 362A84.8 84.8 0 1 0 256 256Z",
  "M256 256A86.9 86.9 0 1 1 330 150A100.9 100.9 0 1 0 256 256Z",
  "M256 256A86.9 86.9 0 1 1 182 362A100.9 100.9 0 1 0 256 256Z"
];
const OFFICES = ["Admissions", "Teaching", "Exams", "Fees", "Families", "Leadership"];
const at = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return { x: +(256 + r * Math.sin(a)).toFixed(2), y: +(256 - r * Math.cos(a)).toFixed(2) };
};

export function BrandDial({ className = "" }: { className?: string }) {
  return (
    <figure className={className}>
      <svg viewBox="0 0 512 512" className="h-auto w-full" role="img" aria-labelledby="dial-title">
        <title id="dial-title">The Synergy Swift mark at the centre of a dial, joined to admissions, teaching, exams, fees, families and leadership</title>
        {/* Rim and minute ticks */}
        <circle cx="256" cy="256" r="236" fill="none" stroke="#cbd5e1" strokeWidth="0.75" pathLength={1} className="ss-draw" />
        <circle cx="256" cy="256" r="222" fill="none" stroke="#e2e8f0" strokeWidth="0.75" pathLength={1} className="ss-draw" style={{ ["--d" as string]: ".15s" }} />
        <g className="ss-fade" style={{ ["--d" as string]: ".4s" }} stroke="#1b2d55">
          {Array.from({ length: 60 }, (_, i) => {
            const long = i % 5 === 0;
            const a = at(i * 6, 236), b = at(i * 6, long ? 224 : 230);
            return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={long ? 1.2 : 0.6} opacity={long ? 0.9 : 0.45} />;
          })}
        </g>
        {/* Construction lines */}
        <g fill="none" stroke="#cbd5e1" strokeWidth="0.6">
          <circle cx="256" cy="256" r="150" strokeDasharray="2 5" className="ss-fade" style={{ ["--d" as string]: ".6s" }} />
          <line x1="40" y1="256" x2="472" y2="256" pathLength={1} className="ss-draw" style={{ ["--d" as string]: ".3s" }} />
          <line x1="256" y1="40" x2="256" y2="472" pathLength={1} className="ss-draw" style={{ ["--d" as string]: ".45s" }} />
        </g>
        {/* Each office joined to the record at the centre */}
        {OFFICES.map((o, i) => {
          const deg = i * 60, p = at(deg, 168), q = at(deg, 30), label = at(deg, 192);
          const anchor = deg === 0 || deg === 180 ? "middle" : deg < 180 ? "start" : "end";
          const d = `${1 + i * 0.18}s`;
          return (
            <g key={o}>
              <line x1={q.x} y1={q.y} x2={p.x} y2={p.y} stroke="#94a3b8" strokeWidth="0.7" pathLength={1} className="ss-draw" style={{ ["--d" as string]: d }} />
              <circle cx={p.x} cy={p.y} r="3.2" fill="#ffffff" stroke="#1b2d55" strokeWidth="1.2" className="ss-fade" style={{ ["--d" as string]: d }} />
              <text x={label.x} y={label.y + 4.5} textAnchor={anchor} fontSize="13" fill="#334155" className="ss-fade" style={{ ["--d" as string]: d, fontFamily: "var(--font-sans)" }}>{o}</text>
            </g>
          );
        })}
        {/* The mark */}
        <g transform="translate(256 256) scale(0.66) translate(-256 -256)" fill="#1b2d55">
          {WINGS.map((w, i) => <path key={w} d={w} className="ss-fade" style={{ ["--d" as string]: `${0.7 + (i >> 1) * 0.12}s` }} />)}
        </g>
        <circle cx="256" cy="256" r="12" fill="#ffffff" />
        <circle cx="256" cy="256" r="7.4" fill="#b08d4f" className="ss-fade" style={{ ["--d" as string]: "1.2s" }} />
        {/* The sweeping hand */}
        <g className="ss-sweep">
          <line x1="256" y1="276" x2="256" y2="30" stroke="#b08d4f" strokeWidth="1" />
          <circle cx="256" cy="30" r="2" fill="#b08d4f" />
        </g>
      </svg>
      <figcaption className="mt-2 flex items-center justify-center gap-3 text-[12.5px] text-slate-500">
        <span aria-hidden className="h-px w-6 bg-brass-500" />One record at the centre. Every office around it.<span aria-hidden className="h-px w-6 bg-brass-500" />
      </figcaption>
    </figure>
  );
}
