-- =========================================================================
-- Phase 14a: more question types for exams and the question bank.
--   matrix, highlight, label_image, graph_plot, chem_equation, rating,
--   passage (no marks), drawing, audio_response (recorded answer).
-- Exam tools (calculators, tables, periodic table, mathematical set …) live
-- in exams.settings.tools and need no schema change.
-- Apply AFTER 20260101005600. Idempotent.
-- =========================================================================

alter table public.exam_questions drop constraint if exists exam_questions_type_check;
alter table public.exam_questions add constraint exam_questions_type_check check (type in (
  'mcq_single','mcq_multi','true_false','short_answer','numeric','fill_blanks',
  'matching','ordering','hotspot','essay','code','file_upload','math','drag_drop',
  'matrix','highlight','label_image','graph_plot','chem_equation','rating','passage','drawing','audio_response'));

alter table public.question_bank drop constraint if exists question_bank_type_check;
alter table public.question_bank add constraint question_bank_type_check check (type in (
  'mcq_single','mcq_multi','true_false','short_answer','numeric','fill_blanks',
  'matching','ordering','hotspot','essay','code','file_upload','math','drag_drop',
  'matrix','highlight','label_image','graph_plot','chem_equation','rating','passage','drawing','audio_response'));

-- A reading passage never carries marks.
alter table public.exam_questions drop constraint if exists exam_questions_passage_points;
alter table public.exam_questions add constraint exam_questions_passage_points check (type <> 'passage' or points = 0);
