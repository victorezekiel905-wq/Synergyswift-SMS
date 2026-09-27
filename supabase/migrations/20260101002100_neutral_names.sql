-- =========================================================================
-- EduClass Fusion: neutral names for drafting features.
-- Lesson notes record that a note began as a draft ("drafted"), and audit
-- entries use the same wording. Apply AFTER 20260101002000. Idempotent.
-- =========================================================================

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'lesson_notes' and column_name = 'ai_generated') then
    alter table public.lesson_notes rename column ai_generated to drafted;
  end if;
end $$;
alter table public.lesson_notes add column if not exists drafted boolean not null default false;

update public.audit_logs set action = 'lesson_note.drafted' where action = 'ai.lesson_note_generated';
update public.audit_logs set action = 'report_comments.drafted' where action = 'ai.report_comments';
