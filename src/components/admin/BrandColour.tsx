"use client";
import { useEffect, useState } from "react";
import { brandPalette, tintPalette, chosenBrand, chosenTint, logoColours, parseHex, toHex, DEFAULT_BRAND, DB_DEFAULT_BRAND, DEFAULT_TINT } from "@/lib/theme";

/** Ready-made main colours (all readable with white text). */
const MAIN = [
  ["Navy (standard)", DEFAULT_BRAND], ["Royal blue", "#1d4ed8"], ["Teal", "#0f766e"], ["Green", "#15803d"],
  ["Maroon", "#9f1239"], ["Red", "#b91c1c"], ["Purple", "#6d28d9"], ["Orange", "#c2410c"], ["Gold", "#a16207"], ["Charcoal", "#374151"]
] as const;
/** Ready-made second colours: quiet tones that sit well beside most main colours. */
const SECOND = [
  ["Brass (standard)", DEFAULT_TINT], ["Gold", "#ca8a04"], ["Bronze", "#9a5b2e"], ["Sage", "#5f7a61"],
  ["Sky", "#0284c7"], ["Crimson", "#be123c"], ["Teal", "#0d9488"], ["Slate", "#64748b"]
] as const;

const rgb = (c: [number, number, number]) => `rgb(${c.join(" ")})`;

/** The main colours in the school's logo (read in the browser from the uploaded image). */
function useLogoColours(src?: string | null): string[] {
  const [found, setFound] = useState<string[]>([]);
  useEffect(() => {
    setFound([]);
    if (!src) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        const w = 80, h = Math.max(1, Math.round((img.naturalHeight / Math.max(1, img.naturalWidth)) * 80));
        c.width = w; c.height = h;
        const ctx = c.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, w, h);
        setFound(logoColours(ctx.getImageData(0, 0, w, h).data, 4));
      } catch { /* the image can't be read here: no suggestions */ }
    };
    img.src = src;
  }, [src]);
  return found;
}

function Swatches({ label, list, extra, selected, onPick, picker, pickerValue, onPicker }: {
  label: string; list: readonly (readonly [string, string])[]; extra: string[]; selected: string; onPick: (hex: string) => void;
  picker: string; pickerValue: string; onPicker: (hex: string) => void;
}) {
  const dot = (name: string, hex: string) => {
    const on = selected === hex;
    return (
      <button key={name + hex} type="button" role="radio" aria-checked={on} title={name} aria-label={name} onClick={() => onPick(hex)}
        className={"h-8 w-8 rounded-full border-2 " + (on ? "border-slate-900 ring-2 ring-slate-300" : "border-white shadow-lift")} style={{ background: hex }} />
    );
  };
  return (
    <div className="space-y-2">
      {extra.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={`${label}: from your logo`}>
          <span className="w-full text-xs text-slate-500 sm:w-auto">From your logo:</span>
          {extra.map(hex => dot(`From your logo ${hex}`, hex))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={label}>
        {list.map(([name, hex]) => dot(name, hex))}
        <label className="ml-1 flex items-center gap-2 text-xs text-slate-600">
          Any colour
          <input type="color" className="h-8 w-10 cursor-pointer rounded border border-slate-300" value={pickerValue} onChange={e => onPicker(e.target.value)} aria-label={picker} />
        </label>
      </div>
    </div>
  );
}

/**
 * The school's two colours. The main colour: buttons, links, the active menu item, the line
 * across the top and page titles (in its deepest shade). The second colour: small details only.
 * Saved as tenant_settings.brand_color and brand_color_2 ("standard" saves "not chosen").
 */
export default function BrandColour({ value, value2, logoUrl, schoolName, onChange, onChange2 }: {
  value: string | null; value2: string | null; logoUrl?: string | null; schoolName?: string | null;
  onChange: (v: string) => void; onChange2: (v: string) => void;
}) {
  const main = chosenBrand(value) ?? DEFAULT_BRAND;
  const second = chosenTint(value2) ?? DEFAULT_TINT;
  const p = brandPalette(main), t = tintPalette(second);
  const fromLogo = useLogoColours(logoUrl);
  const darkened = toHex(p[600]) !== toHex(parseHex(main)!);
  const pickMain = (hex: string) => onChange(chosenBrand(hex) ?? DB_DEFAULT_BRAND);
  const pickSecond = (hex: string) => onChange2(chosenTint(hex) ?? "");
  return (
    <div className="space-y-4">
      <div>
        <p className="label">School colours</p>
        <p className="text-xs text-slate-500">Two colours, used with restraint: the main colour for buttons, links, the menu and a thin line across the top; the second for small details. Everything else stays white and grey, so pages look calm and professional.{logoUrl ? " Tap a colour from your logo to match it exactly." : " Upload your logo above to choose from its colours."}</p>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <p className="mb-1.5 text-sm font-medium">Main colour</p>
          <Swatches label="Main colour" list={MAIN} extra={fromLogo} selected={main} onPick={pickMain} picker="Pick any main colour" pickerValue={main} onPicker={pickMain} />
          {darkened && <p className="mt-1.5 text-xs text-slate-500">Buttons use a slightly darker shade so their text stays easy to read.</p>}
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium">Second colour <span className="font-normal text-slate-500">(small details)</span></p>
          <Swatches label="Second colour" list={SECOND} extra={fromLogo.filter(h => h !== main)} selected={second} onPick={pickSecond} picker="Pick any second colour" pickerValue={second} onPicker={pickSecond} />
        </div>
      </div>

      {/* How the dashboard will look. */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50" aria-label="Preview">
        <div className="flex h-11 items-center gap-2 border-b border-slate-200 bg-white px-3" style={{ boxShadow: `inset 0 3px 0 0 ${rgb(p[600])}` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {logoUrl ? <img src={logoUrl} alt="" className="h-6 w-auto max-w-[90px] object-contain" /> : <span className="h-6 w-6 rounded" style={{ background: rgb(p[600]) }} />}
          <span className="text-sm font-semibold" style={{ color: rgb(p[950]) }}>{schoolName || "Your school"}</span>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-[150px_1fr]">
          <div className="hidden space-y-1 text-[13px] sm:block">
            <span className="relative block rounded-md bg-slate-100 px-3 py-1.5 font-medium text-slate-900"><span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full" style={{ background: rgb(p[600]) }} />Dashboard</span>
            <span className="block px-3 py-1.5 text-slate-600">Students</span>
            <span className="block px-3 py-1.5 text-slate-600">Results</span>
          </div>
          <div>
            <p className="mb-1 flex items-center gap-2 text-[12px] font-medium" style={{ color: rgb(t[700]) }}><span className="h-px w-5" style={{ background: rgb(t[500]) }} />School at a glance</p>
            <p className="font-serif text-lg font-semibold" style={{ color: rgb(p[950]) }}>Good morning</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {[["Students", "1,204"], ["Present today", "96%"], ["Fees paid", "71%"]].map(([l, v]) => (
                <div key={l} className="rounded-md border border-slate-200 bg-white px-2.5 py-2"><p className="text-[11px] text-slate-500">{l}</p><p className="text-base font-semibold tabular-nums text-slate-900">{v}</p></div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="rounded-md px-3 py-1.5 text-xs font-medium text-white" style={{ background: rgb(p[600]) }}>Enter scores</span>
              <span className="text-xs font-medium underline" style={{ color: rgb(p[700]) }}>See all results</span>
              <span className="flex h-5 items-end gap-0.5" aria-hidden>{[400, 500, 600, 700].map((s, i) => <span key={s} className="w-1.5 rounded-sm" style={{ height: `${6 + i * 4}px`, background: rgb(p[s as 400]) }} />)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
