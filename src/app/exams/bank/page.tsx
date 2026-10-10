"use client";
import Link from "next/link";
import { useApi, Page, PageHeader } from "@/components/ui";
import BankBrowser from "@/components/exams/BankBrowser";

export default function QuestionBankPage() {
  const { data: structure } = useApi<{ subjects: { id: string; name: string }[] }>("/api/school/structure");
  return (
    <Page wide>
      <Link href="/exams" className="text-sm text-brand-700 hover:underline">← Exams</Link>
      <PageHeader eyebrow="Assessment" title="Question bank"
        subtitle="Reusable questions for every exam, tagged by subject, topic, difficulty and Bloom's level. Import past WAEC, NECO, JAMB, BECE or IGCSE questions from a spreadsheet and open them for student practice." />
      <BankBrowser mode="manage" subjects={structure?.subjects ?? []} />
    </Page>
  );
}
