-- =========================================================================
-- EduClass Fusion: fuller report cards.
--  * Mid-term progress reports next to end-of-term cards (report_cards.kind;
--    grading_components.midterm marks which assessments count).
--  * Report templates per grading scheme: Nigerian, British, American.
--  * Cumulative (session) results shown on later terms' cards (the scheme's
--    existing cumulative_mode: 'none' turns them off).
--  * Per-subject teacher comments, effort, target and predicted grades.
--  * Comment bank for quick, consistent comments.
--  * Principal's signature and school stamp; every published card carries a
--    signature (HMAC) that the verification page checks.
-- Apply AFTER 20260101002700. Idempotent.
-- =========================================================================

alter table public.report_cards add column if not exists kind text not null default 'term';
alter table public.report_cards drop constraint if exists report_cards_kind_check;
alter table public.report_cards add constraint report_cards_kind_check check (kind in ('term','midterm'));
alter table public.report_cards drop constraint if exists report_cards_term_id_student_id_key;
drop index if exists public.report_cards_term_student_kind;
create unique index if not exists report_cards_term_student_kind on public.report_cards(term_id, student_id, kind);
alter table public.report_cards add column if not exists signature text;
alter table public.report_cards add column if not exists signed_at timestamptz;

alter table public.grading_components add column if not exists midterm boolean not null default false;
alter table public.grading_schemes add column if not exists template text not null default 'nigerian';
alter table public.grading_schemes drop constraint if exists grading_schemes_template_check;
alter table public.grading_schemes add constraint grading_schemes_template_check check (template in ('nigerian','british','american'));

alter table public.tenant_settings add column if not exists principal_signature_url text;
alter table public.tenant_settings add column if not exists stamp_url text;
alter table public.tenant_settings add column if not exists report_footer text;

create table if not exists public.report_subject_comments (
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  term_id          uuid not null references public.terms(id) on delete cascade,
  student_id       uuid not null references public.students(id) on delete cascade,
  subject_id       uuid not null references public.subjects(id) on delete cascade,
  comment          text check (char_length(comment) <= 600),
  effort           text check (char_length(effort) <= 20),
  target_grade     text check (char_length(target_grade) <= 10),
  predicted_grade  text check (char_length(predicted_grade) <= 10),
  updated_by       uuid references public.users(id) on delete set null,
  updated_at       timestamptz not null default now(),
  primary key (term_id, student_id, subject_id)
);
alter table public.report_subject_comments enable row level security;
drop policy if exists report_subject_comments_read on public.report_subject_comments;
create policy report_subject_comments_read on public.report_subject_comments for select using (
  tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists report_subject_comments_write on public.report_subject_comments;
create policy report_subject_comments_write on public.report_subject_comments for all using (
  tenant_id = public.my_tenant_id() and public.can_enter_scores(student_id, subject_id)
) with check (tenant_id = public.my_tenant_id() and public.can_enter_scores(student_id, subject_id));

create table if not exists public.comment_bank (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  role         text not null default 'form_teacher' check (role in ('form_teacher','principal','subject')),
  min_average  numeric check (min_average between 0 and 100),
  max_average  numeric check (max_average between 0 and 100),
  text         text not null check (char_length(text) between 2 and 600),
  shared       boolean not null default true,       -- visible to all staff, or only its author
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
alter table public.comment_bank enable row level security;
drop policy if exists comment_bank_read on public.comment_bank;
create policy comment_bank_read on public.comment_bank for select using (
  tenant_id = public.my_tenant_id() and public.is_staff() and (shared or created_by = auth.uid()));
drop policy if exists comment_bank_insert on public.comment_bank;
create policy comment_bank_insert on public.comment_bank for insert with check (
  tenant_id = public.my_tenant_id() and public.is_staff() and created_by = auth.uid());
drop policy if exists comment_bank_change on public.comment_bank;
create policy comment_bank_change on public.comment_bank for update using (
  tenant_id = public.my_tenant_id() and (created_by = auth.uid() or public.is_school_admin())) with check (tenant_id = public.my_tenant_id());
drop policy if exists comment_bank_delete on public.comment_bank;
create policy comment_bank_delete on public.comment_bank for delete using (
  tenant_id = public.my_tenant_id() and (created_by = auth.uid() or public.is_school_admin()));
