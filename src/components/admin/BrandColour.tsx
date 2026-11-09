"use client";
import { brandPalette, chosenBrand, parseHex, toHex, DEFAULT_BRAND, DB_DEFAULT_BRAND } from "@/lib/theme";

/** Ready-made colours that work well as a school's colour (all readable with white text). */
const SWATCHES = [
  ["Navy (standard)", DEFAULT_BRAND], ["Royal blue", "#1d4ed8"], ["Teal", "#0f766e"], ["Green", "#15803d"],
  ["Maroon", "#9f1239"], ["Red", "#b91c1c"], ["Purple", "#6d28d9"], ["Orange", "#c2410c"], ["Gold", "#a16207"], ["Charcoal", "#374151"]
] as const;

const rgb = (c: [number, number, number]) => `rgb(${c.join(" ")})`;

/**
 * The school's colour for the whole system: menus, buttons, links, charts and the dashboards.
 * Saved as tenant_settings.brand_color; "standard" saves the database default, which means "not chosen".
 */
export default function BrandColour({ value, onChange }: { value: string | null; onChange: (v: string) => void }) {
  const chosen = chosenBrand(value);
  const shown = chosen ?? DEFAULT_BRAND;
  const p = brandPalette(shown);
  const darkened = toHex(p[600]) !== toHex(parseHex(shown)!);
  return (
    <div className="space-y-3">
      <div>
        <p className="label">School colour</p>
        <p className="text-xs text-slate-500">Used across your school&apos;s system: the menu, buttons, links, charts and your dashboards. Everyone in the school sees it.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="School colour">
        {SWATCHES.map(([name, hex]) => {
          const on = (chosen ?? DEFAULT_BRAND) === hex;
          return (
            <button key={hex} type="button" role="radio" aria-checked={on} title={name} aria-label={name}
              onClick={() => onChange(hex === DEFAULT_BRAND ? DB_DEFAULT_BRAND : hex)}
              className={"h-8 w-8 rounded-full border-2 " + (on ? "border-slate-900 ring-2 ring-slate-300" : "border-white shadow-lift")}
              style={{ background: hex }} />
          );
        })}
        <label className="ml-1 flex items-center gap-2 text-xs text-slate-600">
          Any colour
          <input type="color" className="h-8 w-10 cursor-pointer rounded border border-slate-300" value={shown}
            onChange={e => onChange(chosenBrand(e.target.value) ?? DB_DEFAULT_BRAND)} aria-label="Pick any colour" />
        </label>
      </div>
      {/* A preview of the colour as it will look. */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 p-3">
        <span className="rounded-md px-3 py-1.5 text-sm font-medium text-white" style={{ background: rgb(p[600]) }}>Button</span>
        <span className="rounded-md px-3 py-1.5 text-sm font-medium" style={{ background: rgb(p[50]), color: rgb(p[800]) }}>Menu item</span>
        <span className="text-sm font-medium underline" style={{ color: rgb(p[700]) }}>A link</span>
        <span className="flex h-6 items-end gap-0.5" aria-hidden>{[400, 500, 600, 700].map((s, i) => <span key={s} className="w-2 rounded-sm" style={{ height: `${8 + i * 5}px`, background: rgb(p[s as 400]) }} />)}</span>
        {darkened && <span className="text-xs text-slate-500">Buttons use a slightly darker shade so their text stays easy to read.</span>}
      </div>
    </div>
  );
}
