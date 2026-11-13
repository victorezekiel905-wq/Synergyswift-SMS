"use client";
import { useEffect, useMemo, useState } from "react";
import { needsLibraries, renderWith } from "@/lib/richtext-core";

/**
 * Lesson, homework, notice and forum text with formatting, LaTeX maths and highlighted code.
 * The HTML is built from escaped text only. Shown at once with the light formatter; the maths and
 * code libraries (KaTeX, highlight.js, several hundred KB) load only when the text has maths or code.
 */
export default function RichText({ text, className = "" }: { text: string | null | undefined; className?: string }) {
  const light = useMemo(() => renderWith(text), [text]);
  const [full, setFull] = useState<{ text: string | null | undefined; html: string } | null>(null);
  useEffect(() => {
    if (!needsLibraries(text)) return;
    let live = true;
    Promise.all([import("@/lib/richtext"), import("@/lib/katex-style")])
      .then(([m]) => { if (live) setFull({ text, html: m.renderRichText(text) }); })
      .catch(() => { /* offline or blocked: the light version stays */ });
    return () => { live = false; };
  }, [text]);
  const html = full && full.text === text ? full.html : light;
  return <div className={`rich-text ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
