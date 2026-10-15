"use client";
import { useMemo } from "react";
import "katex/dist/katex.min.css";
import { renderRichText } from "@/lib/richtext";

/** Lesson, homework and forum text with formatting, LaTeX maths and highlighted code. The HTML is built from escaped text only. */
export default function RichText({ text, className = "" }: { text: string | null | undefined; className?: string }) {
  const html = useMemo(() => renderRichText(text), [text]);
  return <div className={`rich-text ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
