/**
 * The formatting part of lesson, notice and forum text, without the maths and code libraries.
 * richtext.ts plugs KaTeX and highlight.js in; RichText shows this light version at once and
 * loads them only when the text has maths or code (they are large, and most notices have neither).
 *
 *   # Heading, ## Subheading      **bold**  _italic_  `code`
 *   - bullet / 1. numbered        [link text](https://…)
 *   $$ display maths $$           \( inline maths \)  or  $inline$ (not "$5")
 *   ```python  …code…  ```
 */

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
}

export type Renderers = {
  /** Maths as HTML (the TeX is the original text, not escaped). */
  math: (tex: string, display: boolean) => string;
  /** A code block as HTML. */
  code: (code: string, lang: string | null) => string;
};

/** Without the libraries: maths and code shown as plain, escaped text until they load. */
export const PLAIN: Renderers = {
  math: (tex, display) => display ? `<pre class="rt-math-plain"><code>${escapeHtml(tex)}</code></pre>` : `<code>${escapeHtml(tex)}</code>`,
  code: (code, lang) => `<pre class="rt-code"><code class="hljs${lang ? ` language-${escapeHtml(lang.toLowerCase())}` : ""}">${escapeHtml(code)}</code></pre>`
};

/** Whether the text has maths or a code block, i.e. needs the libraries to look right. */
export function needsLibraries(src: string | null | undefined): boolean {
  return Boolean(src) && /\$|\\\(|\\\[|```/.test(String(src));
}

// Placeholders keep maths and code out of the formatting passes.
const SLOT = (i: number) => `\u0000${i}\u0000`;

// Maths was escaped with the rest of the text; the renderer needs the original characters back.
function unescape(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

/** Inline formatting on already-escaped text. */
function inline(s: string, slots: string[], r: Renderers): string {
  let out = s;
  out = out.replace(/`([^`\n]+)`/g, (_, x) => { slots.push(`<code class="rt-inline">${x}</code>`); return SLOT(slots.length - 1); });
  out = out.replace(/\\\((.+?)\\\)/g, (_, x) => { slots.push(r.math(unescape(x), false)); return SLOT(slots.length - 1); });
  // $x$ only when it looks like maths, so "$5 and $10" stays money.
  // (No lookbehind: iPhones before iOS 16.4 cannot load a file that has one. "Ends in a non-space" is written out instead.)
  out = out.replace(/(^|[^\\$\w])\$(?![\s\d])([^$\n]*?[^$\s])\$(?![\w\d])/g, (_, pre, x) => { slots.push(r.math(unescape(x), false)); return pre + SLOT(slots.length - 1); });
  out = out.replace(/\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)/g, (_, text, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer nofollow">${text}</a>`);
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[\s(])_([^_\n]+)_(?=[\s.,;:!?)]|$)/g, "$1<em>$2</em>");
  return out;
}

/** Safe HTML for a block of lesson, homework or forum text, with the given maths and code renderers. */
export function renderWith(src: string | null | undefined, r: Renderers = PLAIN): string {
  if (!src) return "";
  const slots: string[] = [];
  // 1. Code blocks and display maths are lifted out before anything else.
  let s = String(src).replace(/\r\n/g, "\n").replace(/\u0000/g, "").slice(0, 100_000);
  s = s.replace(/```([\w+#-]*)\n([\s\S]*?)```/g, (_, lang, code) => { slots.push(r.code(code.replace(/\n$/, ""), lang || null)); return `\n\n${SLOT(slots.length - 1)}\n\n`; });
  s = s.replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g, (_, a, b) => { slots.push(r.math(a ?? b, true)); return `\n\n${SLOT(slots.length - 1)}\n\n`; });
  // 2. Everything else is escaped, then formatted line by line.
  s = escapeHtml(s);
  const blocks = s.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  const html = blocks.map(b => {
    if (/^\u0000\d+\u0000$/.test(b)) return b;
    const lines = b.split("\n");
    if (lines.every(l => /^\s*[-*] /.test(l))) return `<ul>${lines.map(l => `<li>${inline(l.replace(/^\s*[-*] /, ""), slots, r)}</li>`).join("")}</ul>`;
    if (lines.every(l => /^\s*\d+[.)] /.test(l))) return `<ol>${lines.map(l => `<li>${inline(l.replace(/^\s*\d+[.)] /, ""), slots, r)}</li>`).join("")}</ol>`;
    const h = b.match(/^(#{1,3}) (.+)$/);
    if (h && lines.length === 1) return `<h${h[1].length + 2}>${inline(h[2], slots, r)}</h${h[1].length + 2}>`;
    return `<p>${lines.map(l => inline(l, slots, r)).join("<br>")}</p>`;
  }).join("");
  // 3. Put maths and code back.
  return html.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)] ?? "");
}
