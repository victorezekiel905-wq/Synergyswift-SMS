-- =========================================================================
-- EduClass Fusion — Secure exams (exam.net-style + Safe Exam Browser) (v45)
-- Apply AFTER 20260101001300_operations.sql. Idempotent.
--
-- Answer keys live in exam_questions.answer and are NEVER readable by
-- students: students load questions through the API, which strips keys, and
-- RLS only grants exam_questions to staff.
-- =========================================================================

create table if not exists public.exams (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  created_by        uuid not null references public.users(id),
  title             text not null,
  instructions      text,
  subject_id        uuid references public.subjects(id) on delete set null,
  class_group_id    uuid references public.class_groups(id) on delete set null,
  term_id           uuid references public.terms(id) on delete set null,
  component_id      uuid references public.grading_components(id) on delete set null,  -- push score into results
  duration_minutes  int not null default 60 check (duration_minutes between 1 and 600),
  opens_at          timestamptz,
  closes_at         timestamptz,
  status            text not null default 'draft' check (status in ('draft','published','closed')),
  access_code       text not null default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 6)),
  -- settings: shuffle_questions, shuffle_options, require_seb, seb_browser_keys[], seb_config_keys[],
  -- require_fullscreen, block_copy_paste, violation_limit, show_score_after_submit, allow_review,
  -- allow_calculator, allow_spellcheck, quit_password
  settings          jsonb not null default '{}'::jsonb,
  results_released  boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists exams_tenant on public.exams(tenant_id, created_at desc);

create table if not exists public.exam_questions (
  id          uuid primary key default gen_random_uuid(),
  exam_id     uuid not null references public.exams(id) on delete cascade,
  position    int not null default 1,
  section     text,
  type        text not null check (type in (
                'mcq_single','mcq_multi','true_false','short_answer','numeric','fill_blanks',
                'matching','ordering','hotspot','essay','code','file_upload')),
  prompt      text not null,
  media_url   text,
  points      numeric not null default 1 check (points >= 0),
  -- Public shape (options, pairs, blanks count, image, limits…) shown to students.
  data        jsonb not null default '{}'::jsonb,
  -- Private key (correct option ids, accepted answers, tolerance, regions…).
  answer      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists exam_questions_exam on public.exam_questions(exam_id, position);

create table if not exists public.exam_attempts (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  exam_id          uuid not null references public.exams(id) on delete cascade,
  student_user_id  uuid not null references public.users(id) on delete cascade,
  status           text not null default 'in_progress' check (status in ('in_progress','locked','submitted','graded')),
  started_at       timestamptz not null default now(),
  deadline_at      timestamptz not null,
  submitted_at     timestamptz,
  question_order   jsonb not null default '[]'::jsonb,
  option_orders    jsonb not null default '{}'::jsonb,
  answers          jsonb not null default '{}'::jsonb,
  -- per-question awarded points & teacher feedback: { qid: { points, auto, feedback } }
  marks            jsonb not null default '{}'::jsonb,
  auto_score       numeric,
  total_score      numeric,
  max_score        numeric,
  violations       int not null default 0,
  seb_verified     boolean not null default false,
  client_ip        text,
  user_agent       text,
  extra_minutes    int not null default 0,
  last_seen_at     timestamptz not null default now(),
  unique (exam_id, student_user_id)
);

create table if not exists public.exam_events (
  id          uuid primary key default gen_random_uuid(),
  attempt_id  uuid not null references public.exam_attempts(id) on delete cascade,
  kind        text not null,       -- blur | visibility_hidden | fullscreen_exit | copy | paste | context_menu | print | devtools | locked | unlocked | seb_failed | resumed | time_extended
  meta        jsonb not null default '{}'::jsonb,
  at          timestamptz not null default now()
);
create index if not exists exam_events_attempt on public.exam_events(attempt_id, at);

alter table public.exams          enable row level security;
alter table public.exam_questions enable row level security;
alter table public.exam_attempts  enable row level security;
alter table public.exam_events    enable row level security;

-- Staff manage exams in their tenant; students read published exams for their class group.
drop policy if exists exams_staff on public.exams;
create policy exams_staff on public.exams for all using (
  tenant_id = public.my_tenant_id() and public.is_staff()
) with check (tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists exams_student_read on public.exams;
create policy exams_student_read on public.exams for select using (
  tenant_id = public.my_tenant_id() and status in ('published','closed') and (
    class_group_id is null or exists (
      select 1 from public.students s where s.user_id = auth.uid() and s.class_group_id = exams.class_group_id)));

drop policy if exists exam_questions_staff on public.exam_questions;
create policy exam_questions_staff on public.exam_questions for all using (
  exists (select 1 from public.exams e where e.id = exam_questions.exam_id and e.tenant_id = public.my_tenant_id() and public.is_staff())
) with check (
  exists (select 1 from public.exams e where e.id = exam_questions.exam_id and e.tenant_id = public.my_tenant_id() and public.is_staff()));

-- Attempts are written only by the API (service role) so the clock, answer
-- keys and lock state cannot be tampered with from the browser.
drop policy if exists exam_attempts_read on public.exam_attempts;
create policy exam_attempts_read on public.exam_attempts for select using (
  tenant_id = public.my_tenant_id() and (public.is_staff() or student_user_id = auth.uid()));
drop policy if exists exam_attempts_staff_update on public.exam_attempts;
create policy exam_attempts_staff_update on public.exam_attempts for update using (
  tenant_id = public.my_tenant_id() and public.is_staff()
) with check (tenant_id = public.my_tenant_id());

drop policy if exists exam_events_read on public.exam_events;
create policy exam_events_read on public.exam_events for select using (
  exists (select 1 from public.exam_attempts a where a.id = exam_events.attempt_id
          and a.tenant_id = public.my_tenant_id() and public.is_staff()));

insert into storage.buckets (id, name, public) values ('exam-uploads','exam-uploads', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('school-assets','school-assets', false) on conflict (id) do nothing;

do $$
begin
  begin alter publication supabase_realtime add table public.exam_attempts; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.exam_events; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.gate_events; exception when duplicate_object then null; end;
end $$;
