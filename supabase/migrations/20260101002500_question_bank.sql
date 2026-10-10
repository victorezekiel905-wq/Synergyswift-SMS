-- =========================================================================
-- EduClass Fusion: question bank, past questions and practice.
--  * Two more exam question types: maths input and drag-and-drop.
--  * question_bank: reusable questions tagged by subject, level, topic,
--    difficulty, Bloom's level and (for past questions) exam body and year.
--    Answer keys stay staff-only, like exam_questions.
--  * Exams copy questions from the bank (bank_question_id keeps the link, and
--    topic / difficulty / Bloom's are copied for item analysis).
--  * practice_sessions: students drill bank questions marked for practice and
--    get instant feedback. Written only by the API (service role).
-- Apply AFTER 20260101002400. Idempotent.
-- =========================================================================

alter table public.exam_questions drop constraint if exists exam_questions_type_check;
alter table public.exam_questions add constraint exam_questions_type_check check (type in (
  'mcq_single','mcq_multi','true_false','short_answer','numeric','fill_blanks',
  'matching','ordering','hotspot','essay','code','file_upload','math','drag_drop'));

create table if not exists public.question_bank (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  created_by    uuid references public.users(id) on delete set null,
  subject_id    uuid references public.subjects(id) on delete set null,
  level         text,                                   -- JSS1, SS2, Year 9, Grade 10 …
  topic         text,
  difficulty    text check (difficulty in ('easy','medium','hard')),
  bloom         text check (bloom in ('remember','understand','apply','analyse','evaluate','create')),
  exam_body     text,                                   -- WAEC, NECO, JAMB, BECE, IGCSE, A Level, NCEE, SAT …
  exam_year     int check (exam_year between 1950 and 2100),
  type          text not null check (type in (
                  'mcq_single','mcq_multi','true_false','short_answer','numeric','fill_blanks',
                  'matching','ordering','hotspot','essay','code','file_upload','math','drag_drop')),
  prompt        text not null,
  media_url     text,
  points        numeric not null default 1 check (points >= 0),
  data          jsonb not null default '{}'::jsonb,
  answer        jsonb not null default '{}'::jsonb,
  explanation   text,                                   -- shown after a practice answer
  practice      boolean not null default false,         -- students may drill it (they will see the answer)
  times_used    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists question_bank_lookup on public.question_bank(tenant_id, subject_id, topic);
create index if not exists question_bank_past on public.question_bank(tenant_id, exam_body, exam_year);

alter table public.exam_questions add column if not exists bank_question_id uuid references public.question_bank(id) on delete set null;
alter table public.exam_questions add column if not exists topic text;
alter table public.exam_questions add column if not exists difficulty text;
alter table public.exam_questions add column if not exists bloom text;

alter table public.question_bank enable row level security;
drop policy if exists question_bank_read on public.question_bank;
create policy question_bank_read on public.question_bank for select using (
  tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists question_bank_insert on public.question_bank;
create policy question_bank_insert on public.question_bank for insert with check (
  tenant_id = public.my_tenant_id() and public.is_staff() and created_by = auth.uid());
drop policy if exists question_bank_change on public.question_bank;
create policy question_bank_change on public.question_bank for update using (
  tenant_id = public.my_tenant_id() and (created_by = auth.uid() or public.is_school_admin())
) with check (tenant_id = public.my_tenant_id());
drop policy if exists question_bank_delete on public.question_bank;
create policy question_bank_delete on public.question_bank for delete using (
  tenant_id = public.my_tenant_id() and (created_by = auth.uid() or public.is_school_admin()));

create table if not exists public.practice_sessions (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  student_user_id  uuid not null references public.users(id) on delete cascade,
  filters          jsonb not null default '{}'::jsonb,   -- subject, exam body, year, topic, difficulty
  question_ids     jsonb not null default '[]'::jsonb,
  option_orders    jsonb not null default '{}'::jsonb,
  answers          jsonb not null default '{}'::jsonb,
  marks            jsonb not null default '{}'::jsonb,
  score            numeric not null default 0,
  max_score        numeric not null default 0,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz
);
create index if not exists practice_sessions_student on public.practice_sessions(student_user_id, started_at desc);

alter table public.practice_sessions enable row level security;
drop policy if exists practice_sessions_read on public.practice_sessions;
create policy practice_sessions_read on public.practice_sessions for select using (
  tenant_id = public.my_tenant_id() and (student_user_id = auth.uid() or public.is_staff()));
