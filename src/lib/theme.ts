/**
 * A school's own colour across the system. The school picks one colour (School setup →
 * Brand colour); this turns it into the light-to-dark shades the interface uses
 * (brand-50 … brand-950), written as CSS variables that Tailwind's `brand` colours read.
 *
 * Shade 600 is the main colour (buttons, links, the active menu item). It is darkened
 * when needed so white text on it stays readable (WCAG AA, 4.5:1); a very light pick
 * such as yellow still gives usable buttons.
 */
export const DEFAULT_BRAND = "#2f4f8f";
export const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
export type Shade = (typeof SHADES)[number];
type RGB = [number, number, number];

/** "#1D5DDB", "1d5ddb" or "#15d" → [29, 93, 219]; null if it isn't a colour. */
export function parseHex(input: unknown): RGB | null {
  let h = String(input ?? "").trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split("").map(c => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) as RGB;
}

export const toHex = (c: RGB) => "#" + c.map(v => Math.round(v).toString(16).padStart(2, "0")).join("");

/** Relative luminance (WCAG). */
export function luminance([r, g, b]: RGB): number {
  const lin = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Contrast ratio between two colours (1 to 21). */
export function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map(i => a[i]! + (b[i]! - a[i]!) * t) as RGB;
const WHITE: RGB = [255, 255, 255], BLACK: RGB = [0, 0, 0];

/** The main shade: the school's colour, darkened only as far as white text needs. */
export function readableBase(c: RGB): RGB {
  let base = c;
  for (let t = 0.05; contrast(base, WHITE) < 4.5 && t <= 0.9; t += 0.05) base = mix(c, BLACK, t);
  return base;
}

/** All eleven shades, from the school's colour. Unknown input gives the default palette. */
export function brandPalette(hex: unknown): Record<Shade, RGB> {
  const base = readableBase(parseHex(hex) ?? parseHex(DEFAULT_BRAND)!);
  // Lighter shades mix towards white, darker ones towards black (600 is the base itself).
  const towardWhite: Partial<Record<Shade, number>> = { 50: 0.95, 100: 0.88, 200: 0.75, 300: 0.58, 400: 0.38, 500: 0.18 };
  const towardBlack: Partial<Record<Shade, number>> = { 700: 0.18, 800: 0.34, 900: 0.48, 950: 0.64 };
  const out = {} as Record<Shade, RGB>;
  for (const s of SHADES) {
    out[s] = s === 600 ? base : towardWhite[s] !== undefined ? mix(base, WHITE, towardWhite[s]!) : mix(base, BLACK, towardBlack[s]!);
    out[s] = out[s].map(Math.round) as RGB;
  }
  return out;
}

/** CSS variables for a palette: { "--brand-600": "47 79 143", … } (space-separated, as Tailwind's alpha syntax needs). */
export function brandVars(hex: unknown): Record<string, string> {
  const p = brandPalette(hex);
  return Object.fromEntries(SHADES.map(s => [`--brand-${s}`, p[s].join(" ")]));
}

/**
 * The colour every school starts with in the database (tenant_settings.brand_color default).
 * Until a school picks another, the app keeps its own calm navy.
 */
export const DB_DEFAULT_BRAND = "#1d5ddb";

/** The school's chosen colour, or null when it hasn't chosen one. */
export function chosenBrand(hex: unknown): string | null {
  const c = parseHex(hex);
  if (!c) return null;
  const h = toHex(c);
  return h === DB_DEFAULT_BRAND || h === DEFAULT_BRAND ? null : h;
}

export const BRAND_KEY = "ecf-brand";

/** Puts a school's colour on the page (and remembers it, so the next page load starts in it). */
export function applyBrand(hex: string | null | undefined) {
  if (typeof document === "undefined") return;
  const chosen = chosenBrand(hex);
  const root = document.documentElement.style;
  if (chosen) for (const [k, v] of Object.entries(brandVars(chosen))) root.setProperty(k, v);
  else for (const s of SHADES) root.removeProperty(`--brand-${s}`);   // back to the defaults in globals.css
  try { if (chosen) localStorage.setItem(BRAND_KEY, JSON.stringify(brandVars(chosen))); else localStorage.removeItem(BRAND_KEY); } catch { /* storage blocked */ }
}

/** Back to Synergy Swift's colours on this page, without forgetting the school's for next time. */
export function clearBrandOnPage() {
  if (typeof document === "undefined") return;
  for (const s of SHADES) document.documentElement.style.removeProperty(`--brand-${s}`);
}

/** Synergy Swift's own public pages, which always keep Synergy Swift's colours. */
export const PUBLIC_PAGES = /^\/(how-it-works|tour|features|company|guide|demo|login|signup|onboard)?\/?$/;

/** Runs in <head> before the page paints: the last school colour seen on this device, so pages don't flash navy first. */
export const BRAND_BOOT_SCRIPT = `try{if(!${PUBLIC_PAGES}.test(location.pathname)){var v=JSON.parse(localStorage.getItem("${BRAND_KEY}")||"null");if(v&&typeof v==="object")for(var k in v)if(/^--brand-\\d+$/.test(k)&&/^\\d{1,3} \\d{1,3} \\d{1,3}$/.test(v[k]))document.documentElement.style.setProperty(k,v[k])}}catch(e){}`;
