-- =========================================================================
-- EduClass Fusion: learning management, part 1 (phase 6a).
--  * homework: late penalties, resubmission, file uploads, differentiated
--    groups, curriculum objectives; earlier attempts kept; annotations and
--    voice/video feedback on submissions; originality checks.
--  * learning_groups: support / core / extension groups inside a class.
--  * forums, forum_threads, forum_posts, forum_reports: class and school
--    discussion, moderated by staff.
--  * badges, student_badges, learning_activity: badges, points and streaks.
--  * curriculum_objectives, schemes_of_work, scheme_weeks: schemes of work
--    mapped to curriculum objectives, with approval and coverage.
-- Apply AFTER 20260101003300. Idempotent.
-- =========================================================================

-- ---------- differentiation ----------
create table if not exists public.learning_groups (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  class_group_id  uuid not null references public.class_groups(id) on delete cascade,
  name            text not null check (length(name) between 1 and 60),
  kind            text not null default 'custom' check (kind in ('support','core','extension','custom')),
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (class_group_id, name)
);
create table if not exists public.learning_group_members (
  group_id    uuid not null references public.learning_groups(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  primary key (group_id, student_id)
);

-- ---------- homework ----------
alter table public.homework add column if not exists late_penalty_pct numeric not null default 0;          -- % of the mark lost per day late
alter table public.homework add column if not exists late_penalty_max numeric not null default 100;       -- never lose more than this
alter table public.homework add column if not exists allow_resubmit boolean not null default false;
alter table public.homework add column if not exists max_attempts int not null default 1;
alter table public.homework add column if not exists accept_files boolean not null default true;
alter table public.homework add column if not exists group_ids uuid[] not null default '{}';            -- empty = the whole class
alter table public.homework add column if not exists objective_ids uuid[] not null default '{}';
alter table public.homework add column if not exists check_originality boolean not null default true;
do $$ begin
  alter table public.homework drop constraint if exists homework_late_rules_check;
  alter table public.homework add constraint homework_late_rules_check check (late_penalty_pct between 0 and 100 and late_penalty_max between 0 and 100 and max_attempts between 1 and 10);
end $$;

alter table public.homework_submissions add column if not exists attempt int not null default 1;
alter table public.homework_submissions add column if not exists files jsonb not null default '[]'::jsonb;         -- [{ path, name, type, size }]
alter table public.homework_submissions add column if not exists raw_score numeric;                              -- before any late penalty
alter table public.homework_submissions add column if not exists penalty_pct numeric not null default 0;
alter table public.homework_submissions add column if not exists status text not null default 'submitted';
alter table public.homework_submissions add column if not exists returned_note text;
alter table public.homework_submissions add column if not exists feedback_media jsonb not null default '[]'::jsonb; -- [{ path, type, seconds, created_at }]
alter table public.homework_submissions add column if not exists originality jsonb;                                -- { similarity, matches, style, checked_at }
do $$ begin
  alter table public.homework_submissions drop constraint if exists homework_submissions_status_check;
  alter table public.homework_submissions add constraint homework_submissions_status_check check (status in ('submitted','returned','marked'));
end $$;

-- Earlier attempts, kept when a student resubmits.
create table if not exists public.homework_submission_versions (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  submission_id uuid not null references public.homework_submissions(id) on delete cascade,
  attempt       int not null,
  body          text,
  files         jsonb not null default '[]'::jsonb,
  submitted_at  timestamptz not null,
  late          boolean not null default false,
  score         numeric,
  feedback      text,
  created_at    timestamptz not null default now()
);

create table if not exists public.submission_annotations (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  submission_id  uuid not null references public.homework_submissions(id) on delete cascade,
  author_id      uuid references public.users(id) on delete set null,
  kind           text not null check (kind in ('text','pin')),
  start_offset   int,            -- text: character range in the answer
  end_offset     int,
  quote          text,
  file_index     int,            -- pin: which uploaded image, and where (percent of width / height)
  x              numeric check (x between 0 and 100),
  y              numeric check (y between 0 and 100),
  comment        text not null check (length(comment) between 1 and 2000),
  created_at     timestamptz not null default now()
);
create index if not exists submission_annotations_sub on public.submission_annotations(submission_id);
insert into storage.buckets (id, name, public) values ('homework', 'homework', false) on conflict (id) do nothing;

-- ---------- forums ----------
create table if not exists public.forums (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  kind            text not null default 'class' check (kind in ('class','school','staff')),
  class_group_id  uuid references public.class_groups(id) on delete cascade,
  subject_id      uuid references public.subjects(id) on delete set null,
  title           text not null check (length(title) between 2 and 120),
  description     text,
  locked          boolean not null default false,
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  check (kind <> 'class' or class_group_id is not null)
);
create table if not exists public.forum_threads (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  forum_id       uuid not null references public.forums(id) on delete cascade,
  author_id      uuid references public.users(id) on delete set null,
  title          text not null check (length(title) between 2 and 160),
  body           text not null check (length(body) between 1 and 20000),
  pinned         boolean not null default false,
  locked         boolean not null default false,
  hidden         boolean not null default false,
  post_count     int not null default 0,
  last_post_at   timestamptz not null default now(),
  created_at     timestamptz not null default now()
);
create index if not exists forum_threads_forum on public.forum_threads(forum_id, pinned desc, last_post_at desc);
create table if not exists public.forum_posts (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  thread_id      uuid not null references public.forum_threads(id) on delete cascade,
  author_id      uuid references public.users(id) on delete set null,
  body           text not null check (length(body) between 1 and 20000),
  hidden         boolean not null default false,
  hidden_by      uuid references public.users(id) on delete set null,
  hidden_reason  text,
  edited_at      timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists forum_posts_thread on public.forum_posts(thread_id, created_at);
create table if not exists public.forum_reports (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  post_id      uuid references public.forum_posts(id) on delete cascade,
  thread_id    uuid references public.forum_threads(id) on delete cascade,
  reporter_id  uuid references public.users(id) on delete set null,
  reason       text not null check (length(reason) between 2 and 500),
  resolved_at  timestamptz,
  resolved_by  uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

-- Who may read and write in a forum: staff everywhere except they do not need a class link;
-- students only in school forums and their own class's forums; nobody else.
create or replace function public.can_use_forum(p_forum uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.forums f
    where f.id = p_forum and f.tenant_id = public.my_tenant_id()
      and (
        (public.is_staff())
        or (f.kind = 'school' and public.has_role(array['student']))
        or (f.kind = 'class' and exists (select 1 from public.students s where s.user_id = auth.uid() and s.status = 'active' and s.class_group_id = f.class_group_id))
      )
      and (f.kind <> 'staff' or public.is_staff())
  );
$$;
grant execute on function public.can_use_forum(uuid) to authenticated;

-- Locked forums and threads take no new posts; counts and last activity follow the posts.
create or replace function public.forum_post_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare t public.forum_threads; f public.forums;
begin
  select * into t from public.forum_threads where id = new.thread_id;
  select * into f from public.forums where id = t.forum_id;
  if tg_op = 'INSERT' then
    if (t.locked or f.locked) and not public.is_staff() then raise exception 'this discussion is closed'; end if;
    update public.forum_threads set post_count = post_count + 1, last_post_at = now() where id = t.id;
  end if;
  return new;
end $$;
drop trigger if exists forum_posts_guard on public.forum_posts;
create trigger forum_posts_guard before insert on public.forum_posts for each row execute function public.forum_post_guard();

-- ---------- gamification ----------
create table if not exists public.badges (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  name         text not null check (length(name) between 2 and 60),
  description  text,
  emoji        text not null default '🏅',
  rule         jsonb,            -- automatic: { type: streak|points|homework|practice|forum, threshold }; null = given by staff
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (tenant_id, name)
);
create table if not exists public.student_badges (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  badge_id    uuid not null references public.badges(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  awarded_by  uuid references public.users(id) on delete set null,
  reason      text,
  awarded_at  timestamptz not null default now(),
  unique (badge_id, student_id)
);
create table if not exists public.learning_activity (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  kind        text not null check (kind in ('homework','practice','content','path_step','forum','lesson','exam','tutor')),
  points      int not null default 0 check (points between 0 and 1000),
  ref_id      uuid,
  on_date     date not null default current_date,
  created_at  timestamptz not null default now()
);
create index if not exists learning_activity_student on public.learning_activity(student_id, on_date desc);
create unique index if not exists learning_activity_once on public.learning_activity(student_id, kind, ref_id) where ref_id is not null;

-- ---------- schemes of work ----------
create table if not exists public.curriculum_objectives (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  subject_id  uuid references public.subjects(id) on delete cascade,
  level       text,                 -- e.g. JSS 1, Year 7
  framework   text,                 -- curriculum stage key, e.g. ng_jss
  code        text,                 -- e.g. BSc.1.2
  strand      text,                 -- theme / topic area
  statement   text not null check (length(statement) between 3 and 1000),
  position    int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists curriculum_objectives_subject on public.curriculum_objectives(tenant_id, subject_id, level);

create table if not exists public.schemes_of_work (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  subject_id    uuid not null references public.subjects(id) on delete cascade,
  level         text not null,
  term_id       uuid references public.terms(id) on delete set null,
  title         text not null check (length(title) between 2 and 160),
  owner_id      uuid not null references public.users(id),
  status        text not null default 'draft' check (status in ('draft','submitted','approved','returned')),
  review_note   text,
  reviewed_by   uuid references public.users(id) on delete set null,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create table if not exists public.scheme_weeks (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  scheme_id      uuid not null references public.schemes_of_work(id) on delete cascade,
  week_no        int not null check (week_no between 1 and 52),
  topic          text not null check (length(topic) between 1 and 200),
  objective_ids  uuid[] not null default '{}',
  activities     text,
  resources      text,
  assessment     text,
  status         text not null default 'planned' check (status in ('planned','taught','skipped')),
  taught_on      date,
  note           text,
  updated_at     timestamptz not null default now(),
  unique (scheme_id, week_no)
);
alter table public.lesson_notes add column if not exists scheme_week_id uuid references public.scheme_weeks(id) on delete set null;

-- Approving a scheme: admins, the principal, QA or the head of the subject's department; never the author.
create or replace function public.can_review_scheme(p_subject uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(array['school_admin','principal','qa_officer','platform_admin'])
    or exists (select 1 from public.subjects s join public.departments d on d.id = s.department_id where s.id = p_subject and d.head_user_id = auth.uid());
$$;
grant execute on function public.can_review_scheme(uuid) to authenticated;
create or replace function public.schemes_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if new.status is distinct from old.status and new.status in ('approved','returned') then
    if not public.can_review_scheme(new.subject_id) then raise exception 'only the head of department, QA, the principal or admins can review a scheme of work'; end if;
    if old.owner_id = auth.uid() then raise exception 'you cannot approve your own scheme of work'; end if;
  end if;
  if new.owner_id is distinct from old.owner_id and not public.is_school_admin() then raise exception 'only admins can hand a scheme to someone else'; end if;
  return new;
end $$;
drop trigger if exists schemes_guard on public.schemes_of_work;
create trigger schemes_guard before update on public.schemes_of_work for each row execute function public.schemes_guard();

-- ---------- RLS ----------
alter table public.learning_groups enable row level security;
alter table public.learning_group_members enable row level security;
drop policy if exists learning_groups_staff on public.learning_groups;
create policy learning_groups_staff on public.learning_groups for all using (tenant_id = public.my_tenant_id() and public.is_staff())
  with check (tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists learning_group_members_staff on public.learning_group_members;
create policy learning_group_members_staff on public.learning_group_members for all using (tenant_id = public.my_tenant_id() and public.is_staff())
  with check (tenant_id = public.my_tenant_id() and public.is_staff());

alter table public.homework_submission_versions enable row level security;
drop policy if exists hw_versions_read on public.homework_submission_versions;
create policy hw_versions_read on public.homework_submission_versions for select using (tenant_id = public.my_tenant_id()
  and (public.is_staff() or exists (select 1 from public.homework_submissions s where s.id = submission_id and (public.is_student_self(s.student_id) or public.is_guardian_of(s.student_id)))));

alter table public.submission_annotations enable row level security;
drop policy if exists annotations_staff on public.submission_annotations;
create policy annotations_staff on public.submission_annotations for all using (tenant_id = public.my_tenant_id() and public.is_staff())
  with check (tenant_id = public.my_tenant_id() and public.is_staff() and author_id = auth.uid());
drop policy if exists annotations_family on public.submission_annotations;
create policy annotations_family on public.submission_annotations for select using (tenant_id = public.my_tenant_id()
  and exists (select 1 from public.homework_submissions s where s.id = submission_id and s.status <> 'submitted' and (public.is_student_self(s.student_id) or public.is_guardian_of(s.student_id))));

alter table public.forums enable row level security;
drop policy if exists forums_read on public.forums;
create policy forums_read on public.forums for select using (public.can_use_forum(id));
drop policy if exists forums_staff on public.forums;
create policy forums_staff on public.forums for all using (tenant_id = public.my_tenant_id() and public.is_staff())
  with check (tenant_id = public.my_tenant_id() and public.is_staff());

alter table public.forum_threads enable row level security;
drop policy if exists forum_threads_read on public.forum_threads;
create policy forum_threads_read on public.forum_threads for select using (public.can_use_forum(forum_id) and (not hidden or public.is_staff() or author_id = auth.uid()));
drop policy if exists forum_threads_insert on public.forum_threads;
create policy forum_threads_insert on public.forum_threads for insert with check (tenant_id = public.my_tenant_id() and author_id = auth.uid() and public.can_use_forum(forum_id)
  and not pinned and not locked and not hidden
  and (public.is_staff() or not exists (select 1 from public.forums f where f.id = forum_id and f.locked)));
drop policy if exists forum_threads_staff on public.forum_threads;
create policy forum_threads_staff on public.forum_threads for update using (tenant_id = public.my_tenant_id() and public.is_staff()) with check (tenant_id = public.my_tenant_id());
drop policy if exists forum_threads_delete on public.forum_threads;
create policy forum_threads_delete on public.forum_threads for delete using (tenant_id = public.my_tenant_id() and (public.is_staff() or (author_id = auth.uid() and post_count = 0)));

alter table public.forum_posts enable row level security;
drop policy if exists forum_posts_read on public.forum_posts;
create policy forum_posts_read on public.forum_posts for select using (tenant_id = public.my_tenant_id()
  and exists (select 1 from public.forum_threads t where t.id = thread_id and public.can_use_forum(t.forum_id))
  and (not hidden or public.is_staff() or author_id = auth.uid()));
drop policy if exists forum_posts_insert on public.forum_posts;
create policy forum_posts_insert on public.forum_posts for insert with check (tenant_id = public.my_tenant_id() and author_id = auth.uid() and not hidden
  and exists (select 1 from public.forum_threads t where t.id = thread_id and public.can_use_forum(t.forum_id) and not t.hidden));
-- Authors edit their own words; staff hide posts.
drop policy if exists forum_posts_update on public.forum_posts;
create policy forum_posts_update on public.forum_posts for update using (tenant_id = public.my_tenant_id() and (author_id = auth.uid() or public.is_staff()))
  with check (tenant_id = public.my_tenant_id());
create or replace function public.forum_post_edit_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_staff() then return new; end if;
  if new.hidden is distinct from old.hidden or new.hidden_by is distinct from old.hidden_by or new.thread_id <> old.thread_id or new.author_id is distinct from old.author_id then
    raise exception 'only staff can moderate posts';
  end if;
  new.edited_at := now();
  return new;
end $$;
drop trigger if exists forum_posts_edit_guard on public.forum_posts;
create trigger forum_posts_edit_guard before update on public.forum_posts for each row execute function public.forum_post_edit_guard();
drop policy if exists forum_posts_delete on public.forum_posts;
create policy forum_posts_delete on public.forum_posts for delete using (tenant_id = public.my_tenant_id() and public.is_school_admin());

alter table public.forum_reports enable row level security;
drop policy if exists forum_reports_insert on public.forum_reports;
create policy forum_reports_insert on public.forum_reports for insert with check (tenant_id = public.my_tenant_id() and reporter_id = auth.uid());
drop policy if exists forum_reports_staff on public.forum_reports;
create policy forum_reports_staff on public.forum_reports for all using (tenant_id = public.my_tenant_id() and public.is_staff()) with check (tenant_id = public.my_tenant_id());

alter table public.badges enable row level security;
drop policy if exists badges_read on public.badges;
create policy badges_read on public.badges for select using (tenant_id = public.my_tenant_id());
drop policy if exists badges_staff on public.badges;
create policy badges_staff on public.badges for all using (tenant_id = public.my_tenant_id() and public.is_school_admin()) with check (tenant_id = public.my_tenant_id() and public.is_school_admin());
alter table public.student_badges enable row level security;
drop policy if exists student_badges_read on public.student_badges;
create policy student_badges_read on public.student_badges for select using (tenant_id = public.my_tenant_id()
  and (public.is_staff() or public.is_student_self(student_id) or public.is_guardian_of(student_id)));
drop policy if exists student_badges_award on public.student_badges;
create policy student_badges_award on public.student_badges for insert with check (tenant_id = public.my_tenant_id() and public.is_staff() and awarded_by = auth.uid()
  and exists (select 1 from public.badges b where b.id = badge_id and b.rule is null));
drop policy if exists student_badges_remove on public.student_badges;
create policy student_badges_remove on public.student_badges for delete using (tenant_id = public.my_tenant_id() and (awarded_by = auth.uid() or public.is_school_admin()));
alter table public.learning_activity enable row level security;
drop policy if exists learning_activity_read on public.learning_activity;
create policy learning_activity_read on public.learning_activity for select using (tenant_id = public.my_tenant_id()
  and (public.is_staff() or public.is_student_self(student_id) or public.is_guardian_of(student_id)));

alter table public.curriculum_objectives enable row level security;
drop policy if exists objectives_read on public.curriculum_objectives;
create policy objectives_read on public.curriculum_objectives for select using (tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists objectives_write on public.curriculum_objectives;
create policy objectives_write on public.curriculum_objectives for all using (tenant_id = public.my_tenant_id() and (public.is_school_admin() or public.has_role(array['qa_officer','teacher'])))
  with check (tenant_id = public.my_tenant_id() and (public.is_school_admin() or public.has_role(array['qa_officer','teacher'])));

alter table public.schemes_of_work enable row level security;
drop policy if exists schemes_read on public.schemes_of_work;
create policy schemes_read on public.schemes_of_work for select using (tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists schemes_insert on public.schemes_of_work;
create policy schemes_insert on public.schemes_of_work for insert with check (tenant_id = public.my_tenant_id() and public.is_staff() and owner_id = auth.uid() and status in ('draft','submitted'));
drop policy if exists schemes_update on public.schemes_of_work;
create policy schemes_update on public.schemes_of_work for update using (tenant_id = public.my_tenant_id() and (owner_id = auth.uid() or public.can_review_scheme(subject_id)))
  with check (tenant_id = public.my_tenant_id());
drop policy if exists schemes_delete on public.schemes_of_work;
create policy schemes_delete on public.schemes_of_work for delete using (tenant_id = public.my_tenant_id() and ((owner_id = auth.uid() and status in ('draft','returned')) or public.is_school_admin()));

alter table public.scheme_weeks enable row level security;
drop policy if exists scheme_weeks_read on public.scheme_weeks;
create policy scheme_weeks_read on public.scheme_weeks for select using (tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists scheme_weeks_write on public.scheme_weeks;
create policy scheme_weeks_write on public.scheme_weeks for all using (tenant_id = public.my_tenant_id()
  and exists (select 1 from public.schemes_of_work s where s.id = scheme_id and (s.owner_id = auth.uid() or public.can_review_scheme(s.subject_id))))
  with check (tenant_id = public.my_tenant_id()
  and exists (select 1 from public.schemes_of_work s where s.id = scheme_id and (s.owner_id = auth.uid() or public.can_review_scheme(s.subject_id))));

grant all on public.learning_groups, public.learning_group_members, public.homework_submission_versions, public.submission_annotations, public.forums,
  public.forum_threads, public.forum_posts, public.forum_reports, public.badges, public.student_badges, public.learning_activity, public.curriculum_objectives,
  public.schemes_of_work, public.scheme_weeks to service_role;
