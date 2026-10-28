"use client";
import { Page, PageHeader } from "@/components/ui";
import PlatformNav from "@/components/platform/PlatformNav";
import SignupsTable from "@/components/auth/SignupsTable";

/** New accounts across Synergy Swift, confirmed here instead of in Supabase. */
export default function PlatformSignupsPage() {
  return (
    <Page wide>
      <PlatformNav />
      <PageHeader eyebrow="Synergy Swift platform" title="Sign-ups" subtitle="Everyone who has signed up and not confirmed their email yet: people setting up a new school with a school code, and students joining a class. Confirm an account here and it can sign in straight away." />
      <SignupsTable api="/api/platform/signups" platform />
    </Page>
  );
}
