"use client";
import GuardianPortal, { postTo } from "@/components/parent/GuardianPortal";

/** Logged-in parent portal: children, live sign-in status, results and pickup codes. */
export default function ParentPage() {
  return <GuardianPortal mode="session" api="/api/parent/overview" act={(b) => postTo("/api/pickup", b)} />;
}
