/**
 * Turns lesson and forum text into safe HTML: simple formatting, LaTeX maths
 * and highlighted code. Every piece of text is escaped first; only the tags
 * produced here (and KaTeX's and highlight.js's own escaped output) appear.
 *
 *   # Heading, ## Subheading      **bold**  _italic_  `code`
 *   - bullet / 1. numbered        [link text](https://…)
 *   $$ display maths $$           \( inline maths \)  or  $inline$ (not "$5")
 *   ```python  …code…  ```
 */
import katex from "katex";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import java from "highlight.js/lib/languages/java";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import sql from "highlight.js/lib/languages/sql";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import bash from "highlight.js/lib/languages/bash";
import php from "highlight.js/lib/languages/php";

const LANGS: Record<string, unknown> = { javascript, typescript, python, java, c, cpp, csharp, sql, xml, css, bash, php };
for (const [name, lang] of Object.entries(LANGS)) if (!hljs.getLanguage(name)) hljs.registerLanguage(name, lang as never);
const ALIAS: Record<string, string> = { js: "javascript", ts: "typescript", py: "python", "c++": "cpp", "c#": "csharp", cs: "csharp", html: "xml", sh: "bash", shell: "bash" };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
}

export function renderMath(tex: string, display: boolean): string {
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: false, trust: false, strict: "ignore", maxSize: 20, maxExpand: 500, output: "html" });
  } catch {
    return `<code>${escapeHtml(tex)}</code>`;
  }
}

export function renderCode(code: string, lang: string | null): string {
  const l = lang ? ALIAS[lang.toLowerCase()] ?? lang.toLowerCase() : null;
  const body = l && hljs.getLanguage(l) ? hljs.highlight(code, { language: l, ignoreIllegals: true }).value : escapeHtml(code);
  return `<pre class="rt-code"><code class="hljs${l ? ` language-${escapeHtml(l)}` : ""}">${body}</code></pre>`;
}

// Placeholders keep maths and code out of the formatting passes.
const SLOT = (i: number) => `\u0000${i}\u0000`;

/** Inline formatting on already-escaped text. */
function inline(s: string, slots: string[]): string {
  let out = s;
  out = out.replace(/`([^`\n]+)`/g, (_, x) => { slots.push(`<code class="rt-inline">${x}</code>`); return SLOT(slots.length - 1); });
  out = out.replace(/\\\((.+?)\\\)/g, (_, x) => { slots.push(renderMath(unescape(x), false)); return SLOT(slots.length - 1); });
  // $x$ only when it looks like maths, so "$5 and $10" stays money.
  out = out.replace(/(^|[^\\$\w])\$(?![\s\d])([^$\n]+?)(?<!\s)\$(?![\w\d])/g, (_, pre, x) => { slots.push(renderMath(unescape(x), false)); return pre + SLOT(slots.length - 1); });
  out = out.replace(/\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)/g, (_, text, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer nofollow">${text}</a>`);
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[\s(])_([^_\n]+)_(?=[\s.,;:!?)]|$)/g, "$1<em>$2</em>");
  return out;
}
// Maths was escaped with the rest of the text; KaTeX needs the original characters back.
function unescape(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

/** Safe HTML for a block of lesson, homework or forum text. */
export function renderRichText(src: string | null | undefined): string {
  if (!src) return "";
  const slots: string[] = [];
  // 1. Code blocks and display maths are lifted out before anything else.
  let s = String(src).replace(/\r\n/g, "\n").replace(/\u0000/g, "").slice(0, 100_000);
  s = s.replace(/```([\w+#-]*)\n([\s\S]*?)```/g, (_, lang, code) => { slots.push(renderCode(code.replace(/\n$/, ""), lang || null)); return `\n\n${SLOT(slots.length - 1)}\n\n`; });
  s = s.replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g, (_, a, b) => { slots.push(renderMath(a ?? b, true)); return `\n\n${SLOT(slots.length - 1)}\n\n`; });
  // 2. Everything else is escaped, then formatted line by line.
  s = escapeHtml(s);
  const blocks = s.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  const html = blocks.map(b => {
    if (/^\u0000\d+\u0000$/.test(b)) return b;
    const lines = b.split("\n");
    if (lines.every(l => /^\s*[-*] /.test(l))) return `<ul>${lines.map(l => `<li>${inline(l.replace(/^\s*[-*] /, ""), slots)}</li>`).join("")}</ul>`;
    if (lines.every(l => /^\s*\d+[.)] /.test(l))) return `<ol>${lines.map(l => `<li>${inline(l.replace(/^\s*\d+[.)] /, ""), slots)}</li>`).join("")}</ol>`;
    const h = b.match(/^(#{1,3}) (.+)$/);
    if (h && lines.length === 1) return `<h${h[1].length + 2}>${inline(h[2], slots)}</h${h[1].length + 2}>`;
    return `<p>${lines.map(l => inline(l, slots)).join("<br>")}</p>`;
  }).join("");
  // 3. Put maths and code back.
  return html.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)] ?? "");
}
