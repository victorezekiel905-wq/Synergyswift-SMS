"use client";
import { Page, PageHeader } from "@/components/ui";
import SignupsTable from "@/components/auth/SignupsTable";

/** Accounts joining this school that are waiting to be confirmed. */
export default function SchoolSignupsPage() {
  return (
    <Page>
      <PageHeader eyebrow="School office" title="Sign-ups to confirm" subtitle="Students who signed up with one of your class codes and have not confirmed their email yet. Confirm the ones you recognise; remove any you don't." />
      <SignupsTable api="/api/school/signups" />
    </Page>
  );
}
