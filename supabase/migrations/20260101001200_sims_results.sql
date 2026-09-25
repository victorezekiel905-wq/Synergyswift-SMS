-- =========================================================================
-- EduClass Fusion — SIMS + tenant-defined grading + result portal (v45)
-- Apply AFTER 20260101001100_platform_isolation.sql. Idempotent.
-- =========================================================================

-- ---------- School profile / branding / operational settings ----------
create table if not exists public.tenant_settings (
  tenant_id            uuid primary key references public.tenants(id) on delete cascade,
  school_name          text,
  motto                text,
  address              text,
  phone                text,
  email                text,
  logo_url             text,
  principal_name       text,
  brand_color          text not null default '#1d5ddb',
  sender_name          text,                         -- "From" name on emails / WhatsApp copy
  reply_to_email       text,
  notify_gate_events   boolean not null default true,  -- parents told on child sign-in/out
  notify_results       boolean not null default true,
  staff_start_time     time not null default '08:00', -- later = "late"
  student_start_time   time not null default '07:45',
  geofence_lat         double precision,             -- optional self check-in fence for staff
  geofence_lng         double precision,
  geofence_radius_m    int,
  library_loan_days    int not null default 14,
  library_fine_per_day numeric not null default 0,
  currency             text not null default 'NGN',
  pickup_code_ttl_min  int not null default 240,
  exam_violation_limit int not null default 3,
  updated_at           timestamptz not null default now()
);

-- ---------- Academic structure ----------
create table if not exists public.academic_sessions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,                 -- e.g. 2025/2026
  starts_on   date,
  ends_on     date,
  is_current  boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (tenant_id, name)
);

create table if not exists public.terms (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  session_id      uuid not null references public.academic_sessions(id) on delete cascade,
  name            text not null,             -- First Term / Semester 1 …
  position        int not null default 1,
  starts_on       date,
  ends_on         date,
  next_term_begins date,
  is_current      boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (session_id, name)
);

-- ---------- Grading (each tenant defines its own) ----------
create table if not exists public.grading_schemes (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  name               text not null,
  is_default         boolean not null default false,
  pass_mark          numeric not null default 40,
  show_position      boolean not null default true,
  show_class_average boolean not null default true,
  -- how the session/cumulative figure is derived from term totals
  cumulative_mode    text not null default 'average' check (cumulative_mode in ('average','weighted','none')),
  decimals           int not null default 1 check (decimals between 0 and 3),
  created_at         timestamptz not null default now()
);

create table if not exists public.grade_bands (
  id           uuid primary key default gen_random_uuid(),
  scheme_id    uuid not null references public.grading_schemes(id) on delete cascade,
  grade        text not null,                -- A1, B2, A+, Distinction …
  min_score    numeric not null,
  max_score    numeric not null,
  remark       text,
  grade_point  numeric,
  check (max_score >= min_score)
);

create table if not exists public.grading_components (
  id          uuid primary key default gen_random_uuid(),
  scheme_id   uuid not null references public.grading_schemes(id) on delete cascade,
  name        text not null,                 -- CA1, CA2, Project, Exam …
  max_score   numeric not null check (max_score > 0),
  weight      numeric not null check (weight >= 0),   -- % contribution to the 100-point total
  position    int not null default 1
);

-- ---------- Class groups (arms / homerooms) + subjects ----------
create table if not exists public.class_groups (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  name            text not null,             -- JSS1 Gold, Grade 5B …
  level           text,                      -- JSS1, Grade 5 …
  form_teacher_id uuid references public.users(id) on delete set null,
  scheme_id       uuid references public.grading_schemes(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (tenant_id, name)
);

create table if not exists public.subjects (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  code        text,
  created_at  timestamptz not null default now(),
  unique (tenant_id, name)
);

create table if not exists public.subject_offerings (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  class_group_id  uuid not null references public.class_groups(id) on delete cascade,
  subject_id      uuid not null references public.subjects(id) on delete cascade,
  teacher_id      uuid references public.users(id) on delete set null,
  unique (class_group_id, subject_id)
);

-- ---------- People ----------
create table if not exists public.students (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  user_id         uuid unique references public.users(id) on delete set null,
  admission_no    text not null,
  first_name      text not null,
  last_name       text not null,
  other_names     text,
  gender          text check (gender in ('male','female','other')),
  date_of_birth   date,
  class_group_id  uuid references public.class_groups(id) on delete set null,
  photo_url       text,
  address         text,
  medical_notes   text,
  status          text not null default 'active' check (status in ('active','graduated','withdrawn','suspended')),
  card_code       text not null default encode(gen_random_bytes(9), 'hex'),  -- QR on ID card
  created_at      timestamptz not null default now(),
  unique (tenant_id, admission_no),
  unique (tenant_id, card_code)
);
create index if not exists students_class_idx on public.students(class_group_id);

create table if not exists public.guardians (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  user_id          uuid unique references public.users(id) on delete set null,
  full_name        text not null,
  email            text,
  phone            text,                      -- E.164, e.g. +2348012345678
  whatsapp_phone   text,                      -- defaults to phone when null
  notify_email     boolean not null default true,
  notify_whatsapp  boolean not null default true,
  -- Bearer token for the passwordless guardian portal link sent on WhatsApp.
  portal_token     text not null default encode(gen_random_bytes(24), 'hex'),
  created_at       timestamptz not null default now(),
  unique (portal_token)
);

create table if not exists public.student_guardians (
  student_id   uuid not null references public.students(id) on delete cascade,
  guardian_id  uuid not null references public.guardians(id) on delete cascade,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  relation     text not null default 'parent',
  is_primary   boolean not null default false,
  can_pickup   boolean not null default true,
  primary key (student_id, guardian_id)
);

create table if not exists public.staff (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  user_id          uuid unique references public.users(id) on delete set null,
  staff_no         text not null,
  full_name        text not null,
  email            text,
  phone            text,
  department       text,
  position         text,
  employment_type  text not null default 'full_time' check (employment_type in ('full_time','part_time','contract','volunteer')),
  hire_date        date,
  status           text not null default 'active' check (status in ('active','on_leave','exited')),
  leave_allowance  int not null default 20,
  card_code        text not null default encode(gen_random_bytes(9), 'hex'),
  created_at       timestamptz not null default now(),
  unique (tenant_id, staff_no),
  unique (tenant_id, card_code)
);

-- ---------- Scores + report cards ----------
create table if not exists public.score_entries (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  term_id         uuid not null references public.terms(id) on delete cascade,
  student_id      uuid not null references public.students(id) on delete cascade,
  subject_id      uuid not null references public.subjects(id) on delete cascade,
  component_id    uuid not null references public.grading_components(id) on delete cascade,
  score           numeric,
  source          text not null default 'manual',  -- manual | exam:<id> | import
  entered_by      uuid references public.users(id),
  updated_at      timestamptz not null default now(),
  unique (term_id, student_id, subject_id, component_id)
);
create index if not exists score_entries_lookup on public.score_entries(term_id, subject_id);

create table if not exists public.report_cards (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  term_id             uuid not null references public.terms(id) on delete cascade,
  student_id          uuid not null references public.students(id) on delete cascade,
  class_group_id      uuid references public.class_groups(id) on delete set null,
  data                jsonb not null default '{}'::jsonb,  -- computed subject rows, bands, attendance
  total               numeric,
  average             numeric,
  position            int,
  class_size          int,
  teacher_comment     text,
  principal_comment   text,
  status              text not null default 'draft' check (status in ('draft','approved','published','withheld')),
  access_token        text not null default encode(gen_random_bytes(24), 'hex'),
  computed_at         timestamptz not null default now(),
  published_at        timestamptz,
  published_by        uuid references public.users(id),
  unique (term_id, student_id),
  unique (access_token)
);

-- ---------- RLS ----------
alter table public.tenant_settings    enable row level security;
alter table public.academic_sessions  enable row level security;
alter table public.terms              enable row level security;
alter table public.grading_schemes    enable row level security;
alter table public.grade_bands        enable row level security;
alter table public.grading_components enable row level security;
alter table public.class_groups       enable row level security;
alter table public.subjects           enable row level security;
alter table public.subject_offerings  enable row level security;
alter table public.students           enable row level security;
alter table public.guardians          enable row level security;
alter table public.student_guardians  enable row level security;
alter table public.staff              enable row level security;
alter table public.score_entries      enable row level security;
alter table public.report_cards       enable row level security;

-- Reference data readable by everyone in the tenant, written by admins.
do $$
declare t text;
begin
  foreach t in array array['tenant_settings','academic_sessions','terms','grading_schemes','class_groups','subjects','subject_offerings'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select using (tenant_id = public.my_tenant_id())', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for all using (tenant_id = public.my_tenant_id() and public.is_school_admin()) with check (tenant_id = public.my_tenant_id() and public.is_school_admin())', t || '_write', t);
  end loop;
end $$;

drop policy if exists grade_bands_read on public.grade_bands;
create policy grade_bands_read on public.grade_bands for select using (
  exists (select 1 from public.grading_schemes s where s.id = grade_bands.scheme_id and s.tenant_id = public.my_tenant_id()));
drop policy if exists grade_bands_write on public.grade_bands;
create policy grade_bands_write on public.grade_bands for all using (
  public.is_school_admin() and exists (select 1 from public.grading_schemes s where s.id = grade_bands.scheme_id and s.tenant_id = public.my_tenant_id())
) with check (
  public.is_school_admin() and exists (select 1 from public.grading_schemes s where s.id = grade_bands.scheme_id and s.tenant_id = public.my_tenant_id()));

drop policy if exists grading_components_read on public.grading_components;
create policy grading_components_read on public.grading_components for select using (
  exists (select 1 from public.grading_schemes s where s.id = grading_components.scheme_id and s.tenant_id = public.my_tenant_id()));
drop policy if exists grading_components_write on public.grading_components;
create policy grading_components_write on public.grading_components for all using (
  public.is_school_admin() and exists (select 1 from public.grading_schemes s where s.id = grading_components.scheme_id and s.tenant_id = public.my_tenant_id())
) with check (
  public.is_school_admin() and exists (select 1 from public.grading_schemes s where s.id = grading_components.scheme_id and s.tenant_id = public.my_tenant_id()));

-- Is the caller a guardian of this student (via their portal login)?
create or replace function public.is_guardian_of(p_student uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.student_guardians sg join public.guardians g on g.id = sg.guardian_id
    where sg.student_id = p_student and g.user_id = auth.uid());
$$;
grant execute on function public.is_guardian_of(uuid) to authenticated;

-- students: staff read all in tenant; admins write; a student reads self; guardians read their wards.
drop policy if exists students_read on public.students;
create policy students_read on public.students for select using (
  tenant_id = public.my_tenant_id() and (public.is_staff() or user_id = auth.uid() or public.is_guardian_of(id)));
drop policy if exists students_write on public.students;
create policy students_write on public.students for all using (
  tenant_id = public.my_tenant_id() and public.has_role(array['school_admin','principal','platform_admin','it_admin'])
) with check (tenant_id = public.my_tenant_id());

drop policy if exists guardians_read on public.guardians;
create policy guardians_read on public.guardians for select using (
  tenant_id = public.my_tenant_id() and (public.is_staff() or user_id = auth.uid()));
drop policy if exists guardians_write on public.guardians;
create policy guardians_write on public.guardians for all using (
  tenant_id = public.my_tenant_id() and public.has_role(array['school_admin','principal','platform_admin','it_admin'])
) with check (tenant_id = public.my_tenant_id());
drop policy if exists guardians_self_update on public.guardians;
create policy guardians_self_update on public.guardians for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists student_guardians_read on public.student_guardians;
create policy student_guardians_read on public.student_guardians for select using (
  tenant_id = public.my_tenant_id() and (public.is_staff() or public.is_guardian_of(student_id)));
drop policy if exists student_guardians_write on public.student_guardians;
create policy student_guardians_write on public.student_guardians for all using (
  tenant_id = public.my_tenant_id() and public.has_role(array['school_admin','principal','platform_admin','it_admin'])
) with check (tenant_id = public.my_tenant_id());

drop policy if exists staff_read on public.staff;
create policy staff_read on public.staff for select using (
  tenant_id = public.my_tenant_id() and (public.is_staff()));
drop policy if exists staff_write on public.staff;
create policy staff_write on public.staff for all using (
  tenant_id = public.my_tenant_id() and public.has_role(array['school_admin','principal','platform_admin','hr_manager'])
) with check (tenant_id = public.my_tenant_id());

-- Scores: admins any subject; teachers only subjects they teach (or form class).
create or replace function public.can_enter_scores(p_student uuid, p_subject uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_school_admin() or exists (
    select 1 from public.students s
    join public.subject_offerings o on o.class_group_id = s.class_group_id and o.subject_id = p_subject
    where s.id = p_student and o.teacher_id = auth.uid()
  ) or exists (
    select 1 from public.students s join public.class_groups g on g.id = s.class_group_id
    where s.id = p_student and g.form_teacher_id = auth.uid()
  );
$$;
grant execute on function public.can_enter_scores(uuid, uuid) to authenticated;

drop policy if exists score_entries_read on public.score_entries;
create policy score_entries_read on public.score_entries for select using (
  tenant_id = public.my_tenant_id() and public.is_staff());
drop policy if exists score_entries_write on public.score_entries;
create policy score_entries_write on public.score_entries for all using (
  tenant_id = public.my_tenant_id() and public.can_enter_scores(student_id, subject_id)
) with check (
  tenant_id = public.my_tenant_id() and public.can_enter_scores(student_id, subject_id));

-- Report cards: staff see all; students / guardians see only PUBLISHED ones.
drop policy if exists report_cards_read on public.report_cards;
create policy report_cards_read on public.report_cards for select using (
  tenant_id = public.my_tenant_id() and (
    public.is_staff()
    or (status = 'published' and (
         exists (select 1 from public.students s where s.id = report_cards.student_id and s.user_id = auth.uid())
         or public.is_guardian_of(student_id)))));
drop policy if exists report_cards_write on public.report_cards;
create policy report_cards_write on public.report_cards for all using (
  tenant_id = public.my_tenant_id() and public.is_staff()
) with check (tenant_id = public.my_tenant_id() and public.is_staff());

-- Only admins can publish / approve / withhold.
create or replace function public.report_cards_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if (tg_op = 'INSERT' and new.status <> 'draft') or
     (tg_op = 'UPDATE' and new.status is distinct from old.status) then
    if not public.is_school_admin() then
      raise exception 'only school admins can approve or publish results';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists report_cards_guard on public.report_cards;
create trigger report_cards_guard before insert or update on public.report_cards
  for each row execute function public.report_cards_guard();
