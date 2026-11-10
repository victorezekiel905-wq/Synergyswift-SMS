/**
 * A school's own colours across the system (School setup → School colours). Two colours,
 * used sparingly the way the Synergy Swift home page uses its navy and brass:
 *
 * - The main colour becomes the light-to-dark shades the interface uses (brand-50 …
 *   brand-950): buttons, links, the active menu item, page titles in its deepest shade.
 *   Shade 600 is darkened when needed so white text on it stays readable (WCAG AA, 4.5:1).
 * - The second colour is for small details only (tint-100 … tint-700): the short rule and
 *   label above a page title, small markers. Shade 700 stays readable as small text.
 *
 * Everything else stays white and grey, so a school's colours look calm, not loud.
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

// ---------- The second colour: small details only ----------

/** Synergy Swift's own second colour (the brass of its logo). */
export const DEFAULT_TINT = "#b08d4f";
export const TINT_SHADES = [100, 300, 500, 700] as const;
export type TintShade = (typeof TINT_SHADES)[number];

/** Four shades of the second colour: a wash (100), a soft line (300), the colour (500), and small text (700, readable on white). */
export function tintPalette(hex: unknown): Record<TintShade, RGB> {
  const c = parseHex(hex) ?? parseHex(DEFAULT_TINT)!;
  const round = (x: RGB) => x.map(Math.round) as RGB;
  return { 100: round(mix(c, WHITE, 0.86)), 300: round(mix(c, WHITE, 0.45)), 500: c, 700: round(readableBase(c)) };
}

export function tintVars(hex: unknown): Record<string, string> {
  const p = tintPalette(hex);
  return Object.fromEntries(TINT_SHADES.map(s => [`--tint-${s}`, p[s].join(" ")]));
}

/** The school's second colour, or null when it hasn't chosen one. */
export function chosenTint(hex: unknown): string | null {
  const c = parseHex(hex);
  if (!c) return null;
  const h = toHex(c);
  return h === DEFAULT_TINT ? null : h;
}

/**
 * The main colours of a logo, from its pixels (RGBA, as a canvas gives them): the most used
 * colours that are not white, black, grey or see-through, most used first, each clearly
 * different from the ones before. Up to `max`.
 */
export function logoColours(px: ArrayLike<number>, max = 4): string[] {
  const buckets = new Map<string, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < px.length; i += 4) {
    const r = px[i]!, g = px[i + 1]!, b = px[i + 2]!, a = px[i + 3]!;
    if (a < 200) continue;
    const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
    if (hi > 240 && lo > 225) continue;              // white / paper
    if (hi < 28) continue;                           // black
    if (hi - lo < 28) continue;                      // grey
    const key = `${r >> 4},${g >> 4},${b >> 4}`;
    const k = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    k.n++; k.r += r; k.g += g; k.b += b;
    buckets.set(key, k);
  }
  const ranked = [...buckets.values()].sort((x, y) => y.n - x.n).map(k => [k.r / k.n, k.g / k.n, k.b / k.n] as RGB);
  const out: RGB[] = [];
  for (const c of ranked) {
    if (out.every(o => Math.hypot(o[0] - c[0], o[1] - c[1], o[2] - c[2]) > 70)) out.push(c);
    if (out.length >= max) break;
  }
  return out.map(toHex);
}

export const BRAND_KEY = "ecf-brand";

/** Puts a school's colours on the page (and remembers them, so the next page load starts in them). */
export function applyBrand(hex: string | null | undefined, tint?: string | null) {
  if (typeof document === "undefined") return;
  const chosen = chosenBrand(hex), second = chosenTint(tint);
  const root = document.documentElement.style;
  const vars = { ...(chosen ? brandVars(chosen) : {}), ...(second ? tintVars(second) : {}) };
  if (!chosen) for (const s of SHADES) root.removeProperty(`--brand-${s}`);       // back to the defaults in globals.css
  if (!second) for (const s of TINT_SHADES) root.removeProperty(`--tint-${s}`);
  for (const [k, v] of Object.entries(vars)) root.setProperty(k, v);
  try { if (Object.keys(vars).length) localStorage.setItem(BRAND_KEY, JSON.stringify(vars)); else localStorage.removeItem(BRAND_KEY); } catch { /* storage blocked */ }
}

/** Back to Synergy Swift's colours on this page, without forgetting the school's for next time. */
export function clearBrandOnPage() {
  if (typeof document === "undefined") return;
  for (const s of SHADES) document.documentElement.style.removeProperty(`--brand-${s}`);
  for (const s of TINT_SHADES) document.documentElement.style.removeProperty(`--tint-${s}`);
}

/** Synergy Swift's own public pages, which always keep Synergy Swift's colours. */
export const PUBLIC_PAGES = /^\/(how-it-works|tour|features|company|guide|demo|login|signup|onboard)?\/?$/;

/** Runs in <head> before the page paints: the last school colour seen on this device, so pages don't flash navy first. */
export const BRAND_BOOT_SCRIPT = `try{if(!${PUBLIC_PAGES}.test(location.pathname)){var v=JSON.parse(localStorage.getItem("${BRAND_KEY}")||"null");if(v&&typeof v==="object")for(var k in v)if(/^--(brand|tint)-\\d+$/.test(k)&&/^\\d{1,3} \\d{1,3} \\d{1,3}$/.test(v[k]))document.documentElement.style.setProperty(k,v[k])}}catch(e){}`;
