"use client";
import Link from "next/link";
import { useState } from "react";
import { useApi, Page, PageHeader, Modal } from "@/components/ui";
import BankBrowser from "@/components/exams/BankBrowser";
import QuizGenerator from "@/components/exams/QuizGenerator";

export default function QuestionBankPage() {
  const { data: structure } = useApi<{ subjects: { id: string; name: string }[] }>("/api/school/structure");
  const [drafting, setDrafting] = useState(false);
  const [version, setVersion] = useState(0);
  return (
    <Page wide>
      <Link href="/exams" className="text-sm text-brand-700 hover:underline">← Exams</Link>
      <PageHeader eyebrow="Assessment" title="Question bank"
        subtitle="Reusable questions for every exam, tagged by subject, topic, difficulty and Bloom's level. Import past WAEC, NECO, JAMB, BECE or IGCSE questions from a spreadsheet and open them for student practice."
        actions={<button className="btn btn-outline" onClick={() => setDrafting(true)}>Draft questions on a topic</button>} />
      <BankBrowser key={version} mode="manage" subjects={structure?.subjects ?? []} />
      <Modal open={drafting} onClose={() => setDrafting(false)} title="Draft questions on a topic" wide>
        {drafting && <QuizGenerator subjects={structure?.subjects ?? []} onSaved={() => setVersion(v => v + 1)} />}
      </Modal>
    </Page>
  );
}
