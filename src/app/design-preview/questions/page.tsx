"use client";
import { useState } from "react";
import { ToastProvider, Card } from "@/live/components/ui";
import { QuestionInput, Prompt, type Answer } from "@/live/components/activities/QuestionInput";
import type { PublicQuestion } from "@/live/lib/types";

/**
 * Every live-lesson question type as a student or guest answers it, for checking
 * how each one looks on a phone and a projector. Only in builds made with
 * NEXT_PUBLIC_DESIGN_PREVIEW=1.
 */
const it = (id: string, label: string) => ({ id, label });
const base = { media: {}, points: 1, options: [] as { id: string; label: string }[], config: {} };
const QUESTIONS: PublicQuestion[] = [
  { ...base, id: "mcq", kind: "mcq", prompt: "What is 3/4 of 20?", options: [it("a", "12"), it("b", "15"), it("c", "16"), it("d", "5")] },
  { ...base, id: "multi", kind: "multi_select", prompt: "Which of these are prime numbers? Choose all that apply.", options: [it("a", "2"), it("b", "9"), it("c", "11"), it("d", "15"), it("e", "17")] },
  { ...base, id: "tf", kind: "true_false", prompt: "Water boils at 100 °C at sea level.", options: [it("t", "True"), it("f", "False")] },
  { ...base, id: "poll", kind: "poll", prompt: "How confident do you feel about fractions now?", options: [it("a", "Very confident"), it("b", "Getting there"), it("c", "Still unsure")] },
  { ...base, id: "open", kind: "open", prompt: "In two or three sentences, explain why plants need sunlight." },
  { ...base, id: "short", kind: "short", prompt: "What is the capital of Nigeria?", config: { max_chars: 40 } },
  { ...base, id: "gap", kind: "fill_blank", prompt: "Photosynthesis turns ___ and water into glucose and ___.", config: { blanks: 2 } },
  { ...base, id: "match", kind: "matching", prompt: "Match each country to its capital.", config: { left: [it("l1", "Nigeria"), it("l2", "Ghana"), it("l3", "Kenya")], right: [it("r1", "Nairobi"), it("r2", "Abuja"), it("r3", "Accra")] } },
  { ...base, id: "order", kind: "ordering", prompt: "Put these in order, from smallest to largest.", config: { items: [it("x", "3/4"), it("y", "1/2"), it("z", "2/3"), it("w", "1/4")] } },
  { ...base, id: "cat", kind: "categorize", prompt: "Sort each animal into the right group.", config: { categories: [it("c1", "Mammals"), it("c2", "Birds")], items: [it("i1", "Goat"), it("i2", "Eagle"), it("i3", "Bat"), it("i4", "Parrot")] } },
  { ...base, id: "cloud", kind: "word_cloud", prompt: "One word: what makes a good friend?", config: { max_chars: 20 } },
  { ...base, id: "draw", kind: "draw", prompt: "Draw a right-angled triangle and mark the right angle." },
  { ...base, id: "label", kind: "label_diagram", prompt: "Label the parts of the plant.", config: {
    image_url: "data:image/svg+xml;utf8," + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 200'><rect width='300' height='200' fill='#f1f5f9'/><path d='M150 190V80' stroke='#166534' stroke-width='6'/><ellipse cx='120' cy='110' rx='26' ry='12' fill='#22c55e'/><ellipse cx='180' cy='95' rx='26' ry='12' fill='#22c55e'/><circle cx='150' cy='62' r='20' fill='#facc15'/><path d='M150 190l-25 8M150 190l25 8' stroke='#92400e' stroke-width='4'/></svg>"),
    spots: [{ id: "s1", x: 50, y: 31 }, { id: "s2", x: 40, y: 55 }, { id: "s3", x: 50, y: 96 }], labels: [it("f", "Flower"), it("lf", "Leaf"), it("rt", "Roots")] } },
  { ...base, id: "file", kind: "file", prompt: "Upload a photo of your working." },
  { ...base, id: "code", kind: "code", prompt: "Write a function that returns the sum of two numbers.", config: { language: "python", starter: "def add(a, b):\n    return 0\n", tests: [{ name: "adds 2 and 3", input: "2 3", expected: "5" }] } }
];

export default function QuestionsPreview() {
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  if (process.env.NEXT_PUBLIC_DESIGN_PREVIEW !== "1") return <p className="p-8">Not available.</p>;
  return (
    <ToastProvider>
      <main className="mx-auto max-w-3xl space-y-5 px-4 py-6">
        <h1 className="font-display text-2xl font-extrabold">Every question type, as students see it</h1>
        {QUESTIONS.map((q, i) => (
          <section key={q.id} data-kind={q.kind}><Card className="p-4 sm:p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{i + 1}. {q.kind.replace(/_/g, " ")}</p>
            <div className="mt-1"><Prompt q={q} /></div>
            <div className="mt-3"><QuestionInput q={q} value={answers[q.id]} onChange={v => setAnswers({ ...answers, [q.id]: v })} uploadPrefix="preview" /></div>
          </Card></section>
        ))}
      </main>
    </ToastProvider>
  );
}
