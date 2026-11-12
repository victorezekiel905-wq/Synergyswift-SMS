"use client";
import { useEffect } from "react";
import { Page, Loading } from "@/components/ui";

/** Staff onboarding moved into School office → Onboarding; old links (and ?focus=) still work. */
export default function StaffOnboardingMoved() {
  useEffect(() => {
    const focus = new URLSearchParams(window.location.search).get("focus");
    window.location.replace(`/school/onboarding?tab=staff${focus ? `&focus=${encodeURIComponent(focus)}` : ""}`);
  }, []);
  return <Page><Loading /></Page>;
}
