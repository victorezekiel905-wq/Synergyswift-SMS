"use client";
import GradingSystems from "@/components/results/GradingSystems";
import EarlyYearsSettings from "@/components/results/EarlyYearsSettings";
import EarlyYearsAssess from "@/components/results/EarlyYearsAssess";
import ReportCardView, { type ReportCard } from "@/components/results/ReportCardView";
import { EY_SCALE_PRESETS } from "@/lib/early-years";

const sample: ReportCard = {
  status: "published", total: null, average: null, position: null, class_size: 18, published_at: "2026-12-12T10:00:00Z",
  teacher_comment: "Tobi has settled happily and joins in with every story. He is starting to blend sounds and is proud to write his name.",
  principal_comment: "A lovely first term, Tobi. Keep practising your counting at home.",
  data: {
    template: "early_years", student_name: "Tobi Adeyemi", admission_no: "2026/0101", class_name: "Nursery 1 Red", form_teacher: "Mrs Funke Ade",
    term_label: "First Term 2026-2027", next_term_begins: "2027-01-06", days_present: 58, days_opened: 60, subjects: [],
    ey_scale: EY_SCALE_PRESETS[0].scale, ey_options: { show_key: true },
    areas: [
      { id: "a1", name: "Communication and language", typical: "Secure", comment: "Listens well at carpet time and asks lots of questions.", items: [
        { text: "Listens attentively and responds in a group", rating: 3 }, { text: "Talks about their ideas in full sentences", rating: 3 }] },
      { id: "a2", name: "Literacy", typical: "Developing", comment: "Knows most letter sounds; blending is coming along.", items: [
        { text: "Recognises letter sounds (phonics)", rating: 3 }, { text: "Blends sounds to read simple words", rating: 2 }, { text: "Writes recognisable letters and their own name", rating: 2 }] },
      { id: "a3", name: "Mathematics", typical: "Developing", comment: null, items: [
        { text: "Counts objects reliably to 10", rating: 2 }, { text: "Recognises numerals 0 to 10", rating: 1 }] },
      { id: "a4", name: "Physical development", typical: "Secure", comment: null, items: [
        { text: "Moves safely with control and coordination", rating: 3 }, { text: "Holds a pencil with a comfortable grip", rating: null }] }
    ]
  }
};

/**
 * The results portal screens for reviewing the design (the screenshot script supplies sample
 * data for their APIs). Only available in builds made with NEXT_PUBLIC_DESIGN_PREVIEW=1.
 */
export default function ResultsPreview() {
  if (process.env.NEXT_PUBLIC_DESIGN_PREVIEW !== "1") return <p className="p-8">Not available.</p>;
  return (
    <div className="min-h-screen space-y-10 bg-canvas p-4 sm:p-6">
      <section id="grading"><GradingSystems /></section>
      <section id="settings"><EarlyYearsSettings /></section>
      <section id="assess"><EarlyYearsAssess /></section>
      <section id="card" className="bg-white"><ReportCardView card={sample} school={{ school_name: "Corona Day Nursery", motto: "Learning through play", brand_color: "#263f73" }} /></section>
    </div>
  );
}
