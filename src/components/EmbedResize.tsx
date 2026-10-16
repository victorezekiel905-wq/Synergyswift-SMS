"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

/** When the admissions or enquiry form is embedded in a school's website, tells the page how tall it is so the frame fits without scrollbars. */
export default function EmbedResize() {
  const path = usePathname();
  useEffect(() => {
    if (window.self === window.top || !/^\/(apply|enquire)\//.test(path)) return;
    const post = () => window.parent.postMessage({ type: "educlass:height", height: document.documentElement.scrollHeight, path }, "*");
    const ro = new ResizeObserver(post);
    ro.observe(document.body);
    post();
    return () => ro.disconnect();
  }, [path]);
  return null;
}
