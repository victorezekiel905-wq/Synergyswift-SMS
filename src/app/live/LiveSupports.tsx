"use client";
import { useEffect } from "react";
import { useSupports } from "@/live/lib/supports";

/** Turns on the student's "easy-to-read font" support on live screens (see html.readable in globals.css). */
export function LiveSupports() {
  const { readable_font } = useSupports();
  useEffect(() => {
    document.documentElement.classList.toggle("readable", readable_font);
    return () => document.documentElement.classList.remove("readable");
  }, [readable_font]);
  return null;
}
