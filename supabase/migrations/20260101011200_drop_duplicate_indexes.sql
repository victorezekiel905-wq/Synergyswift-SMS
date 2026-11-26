-- =========================================================================
-- Drop three indexes that exactly copy a unique index on the same columns.
-- Supabase's performance advisor flags them as duplicates: every insert and
-- update paid to maintain both copies, and reads gain nothing from the second.
--   students(user_id)                 kept: students_user_id_key (unique)
--   guardians(user_id)                kept: guardians_user_id_key (unique)
--   class_attendance(student_id,date) kept: class_attendance_student_id_date_key (unique)
-- Migration 7400 no longer creates them. Idempotent.
-- =========================================================================
drop index if exists public.students_user;
drop index if exists public.guardians_user;
drop index if exists public.class_attendance_student_date;
