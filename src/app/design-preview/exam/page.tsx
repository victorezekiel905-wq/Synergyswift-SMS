"use client";
import { useState } from "react";
import QuestionView, { type PublicQuestion } from "@/components/exams/QuestionView";
import ExamTools from "@/components/exams/tools/ExamTools";
import { TOOL_IDS } from "@/lib/exams/tools";

/**
 * Sample exam room with every new question type and every tool, for reviewing
 * the design. Only available in builds made with NEXT_PUBLIC_DESIGN_PREVIEW=1.
 */
const SAMPLES: PublicQuestion[] = [
  { id: "p", type: "passage", prompt: "Read the passage.\n\nThe harmattan is a dry, dusty wind that blows from the Sahara over West Africa between November and March.", points: 0, media_url: null, section: "Section A", data: {} },
  { id: "m", type: "matrix", prompt: "Decide whether each statement is true or false.", points: 3, media_url: null, section: null, data: { rows: [{ id: "a", text: "Iron is a metal." }, { id: "b", text: "Oxygen is a noble gas." }, { id: "c", text: "Water boils at 100 °C at sea level." }], cols: [{ id: "t", text: "True" }, { id: "f", text: "False" }] } },
  { id: "h", type: "highlight", prompt: "Select all the verbs.", points: 3, media_url: null, section: null, data: { text: "The girls ran to the market and bought fresh tomatoes before the rain came.", instruction: null } },
  { id: "g", type: "graph_plot", prompt: "Plot y = 2x + 1 for x = -2, -1, 0, 1 and 2.", points: 5, media_url: null, section: null, data: { x_min: -3, x_max: 3, y_min: -4, y_max: 6, step: 1, snap: true, join: true, x_label: "x", y_label: "y", count: 5 } },
  { id: "c", type: "chem_equation", prompt: "Write a balanced equation for magnesium burning in oxygen.", points: 2, media_url: null, section: null, data: { hint: null } },
  { id: "n", type: "numeric", prompt: "Calculate the acceleration due to gravity. Give your answer to 3 significant figures.", points: 2, media_url: null, section: null, data: { unit: "m/s²" } },
  { id: "r", type: "rating", prompt: "How confident do you feel about this topic?", points: 0, media_url: null, section: null, data: { min: 1, max: 5, min_label: "Not at all", max_label: "Very" } },
  { id: "d", type: "drawing", prompt: "Construct triangle ABC with AB = 6 cm, angle A = 60° and AC = 5 cm.", points: 6, media_url: null, section: null, data: { grid: "square" } },
  { id: "a", type: "audio_response", prompt: "Présentez-vous en français (one minute).", points: 5, media_url: null, section: null, data: { max_seconds: 60 } }
];

export default function ExamPreview() {
  const [answers, setAnswers] = useState<Record<string, any>>({});
  if (process.env.NEXT_PUBLIC_DESIGN_PREVIEW !== "1") return <p className="p-8">Not available.</p>;
  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-20 flex items-center gap-4 border-b border-slate-200 bg-white px-4 py-2">
        <p className="font-semibold">Sample paper: all question types</p>
        <div className="ml-auto flex items-center gap-3">
          <ExamTools tools={[...TOOL_IDS]} referenceText={"Use g = 10 m/s² unless told otherwise.\nRelative atomic masses: H = 1, O = 16, Mg = 24."} storageKey="preview-rough" getQuestionText={() => SAMPLES[0].prompt} />
          <span className="rounded-lg bg-slate-900 px-3 py-1 font-mono text-lg font-bold text-white">58:12</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-4 p-4 sm:p-8">
        {SAMPLES.map((q, i) => (
          <div key={q.id} className="card p-5 sm:p-6" id={`q-${q.id}`}>
            <p className="mb-3 text-sm text-slate-500"><span className="font-semibold text-slate-800">Question {i + 1}</span> · {q.points} marks</p>
            <QuestionView q={q} value={answers[q.id]} onChange={v => setAnswers(a => ({ ...a, [q.id]: v }))} onUpload={async () => {}} />
          </div>
        ))}
      </main>
    </div>
  );
}
