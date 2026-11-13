/**
 * Turns lesson and forum text into safe HTML: simple formatting (richtext-core.ts), LaTeX maths
 * and highlighted code. Every piece of text is escaped first; only the tags produced there (and
 * KaTeX's and highlight.js's own escaped output) appear.
 *
 * KaTeX and highlight.js are large: pages load this file only when a text has maths or code
 * (components/content/RichText.tsx). Everything else uses richtext-core.ts alone.
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
import { escapeHtml, renderWith } from "./richtext-core";

export { escapeHtml };

const LANGS: Record<string, unknown> = { javascript, typescript, python, java, c, cpp, csharp, sql, xml, css, bash, php };
for (const [name, lang] of Object.entries(LANGS)) if (!hljs.getLanguage(name)) hljs.registerLanguage(name, lang as never);
const ALIAS: Record<string, string> = { js: "javascript", ts: "typescript", py: "python", "c++": "cpp", "c#": "csharp", cs: "csharp", html: "xml", sh: "bash", shell: "bash" };

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

/** Safe HTML for a block of lesson, homework or forum text, with maths and highlighted code. */
export function renderRichText(src: string | null | undefined): string {
  return renderWith(src, { math: renderMath, code: renderCode });
}
