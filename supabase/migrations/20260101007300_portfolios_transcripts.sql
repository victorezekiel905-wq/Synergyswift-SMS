-- =========================================================================
-- Synergy Swift: portfolios, share links, transcripts and targets (Phase 14o).
--  * Students add their own achievements with a photo; a teacher verifies
--    them before they count (shown as "verified" on the portfolio).
--  * Teachers keep an achievement portfolio too (awards, qualifications,
--    training, publications…), with photos.
--  * portfolio_shares: a private link to a student's or teacher's portfolio
--    dashboard (or one achievement), revocable, with an expiry.
--  * students.transcript_allowed: the transcript can be seen in the portal,
--    but downloaded or printed only once the school allows it for that child
--    (often held back while fees are outstanding).
--  * student_targets / class_targets: targets for a term, with progress.
-- Idempotent.
-- =========================================================================

alter table public.student_achievements add column if not exists photo_path text;
alter table public.student_achievements add column if not exists source text not null default 'staff';
alter table public.student_achievements add column if not exists status text not null default 'verified';
alter table public.student_achievements add column if not exists verified_by uuid references public.users(id) on delete set null;
do $$ begin
  alter table public.student_achievements drop constraint if exists student_achievements_source_status_check;
  alter table public.student_achievements add constraint student_achievements_source_status_check
    check (source in ('staff','student') and status in ('verified','pending','rejected'));
end $$;

create table if not exists public.staff_achievements (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  staff_id     uuid not null references public.staff(id) on delete cascade,
  kind         text not null default 'award' check (kind in ('award','qualification','training','certification','publication','competition','leadership','service','other')),
  title        text not null check (length(btrim(title)) between 2 and 160),
  description  text check (length(description) <= 1000),
  issuer       text check (length(issuer) <= 120),
  achieved_on  date not null default current_date,
  photo_path   text,
  link_url     text check (link_url is null or link_url ~ '^https://'),
  created_at   timestamptz not null default now()
);
create index if not exists staff_achievements_staff on public.staff_achievements(staff_id, achieved_on desc);
alter table public.staff_achievements enable row level security;
drop policy if exists staff_achievements_read on public.staff_achievements;
create policy staff_achievements_read on public.staff_achievements for select using (tenant_id = public.my_tenant_id() and public.is_staff());
grant select on public.staff_achievements to authenticated;

create table if not exists public.portfolio_shares (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  token           text not null unique default encode(gen_random_bytes(20), 'hex'),
  student_id      uuid references public.students(id) on delete cascade,
  staff_id        uuid references public.staff(id) on delete cascade,
  achievement_id  uuid,                    -- one achievement only; null = the whole portfolio
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '90 days',
  revoked_at      timestamptz,
  views           int not null default 0,
  check ((student_id is null) <> (staff_id is null))
);
create index if not exists portfolio_shares_owner on public.portfolio_shares(tenant_id, student_id, staff_id);
alter table public.portfolio_shares enable row level security;
revoke all on public.portfolio_shares from anon, authenticated;

alter table public.students add column if not exists transcript_allowed boolean not null default false;
alter table public.students add column if not exists transcript_allowed_by uuid references public.users(id) on delete set null;
alter table public.students add column if not exists transcript_allowed_at timestamptz;

create table if not exists public.student_targets (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  term_id      uuid references public.terms(id) on delete set null,
  subject_id   uuid references public.subjects(id) on delete set null,
  kind         text not null check (kind in ('average','subject_score','attendance','personal')),
  target       numeric check (target is null or target between 0 and 100),
  description  text check (length(description) <= 300),
  set_by       uuid references public.users(id) on delete set null,
  set_by_kind  text not null default 'staff' check (set_by_kind in ('staff','student','parent')),
  status       text not null default 'active' check (status in ('active','met','missed','dropped')),
  created_at   timestamptz not null default now(),
  check (kind <> 'subject_score' or subject_id is not null),
  check (kind = 'personal' or target is not null)
);
create index if not exists student_targets_student on public.student_targets(student_id, created_at desc);

create table if not exists public.class_targets (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  class_group_id  uuid not null references public.class_groups(id) on delete cascade,
  term_id         uuid references public.terms(id) on delete set null,
  kind            text not null check (kind in ('average','attendance','pass_rate','other')),
  target          numeric check (target is null or target between 0 and 100),
  description     text check (length(description) <= 300),
  set_by          uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists class_targets_class on public.class_targets(class_group_id, created_at desc);

alter table public.student_targets enable row level security;
alter table public.class_targets enable row level security;
drop policy if exists student_targets_read on public.student_targets;
create policy student_targets_read on public.student_targets for select using (
  tenant_id = public.my_tenant_id() and (public.is_staff() or public.is_student_self(student_id) or public.is_guardian_of(student_id)));
drop policy if exists class_targets_read on public.class_targets;
create policy class_targets_read on public.class_targets for select using (
  tenant_id = public.my_tenant_id() and (public.is_staff() or exists (
    select 1 from public.students s where s.class_group_id = class_targets.class_group_id and (s.user_id = auth.uid() or public.is_guardian_of(s.id)))));
grant select on public.student_targets, public.class_targets to authenticated;
